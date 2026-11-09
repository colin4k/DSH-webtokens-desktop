import z from '@deepseek-ai/schemastery';
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Broker } from './broker.js';
import { parseReply, replyChunks, replyMetadata, OFFICIAL_CONTEXT_TOKENS } from './protocol.js';
import { ContextContinuation } from './context.js';
import { submitRemote } from './remote.js';
import { streamProgress } from './progress.js';
import { registerPanel } from './panel.js';
import { restoreLastPanel } from './history.js';

export const name = 'deepseek-web-bridge';
export const inject = ['llm'];
export const Config = z.object({ token: z.string().role('secret').default(''), port: z.number().min(1).max(65535).default(3081), timeoutMs: z.number().default(600000), auditPath: z.string().default(''), remote: z.boolean().default(false), maxPromptChars: z.number().default(100000) });
export class WebAdapter extends LlmAdapter {
  constructor(broker, config = {}) { super(); this.broker = broker; this.context = new ContextContinuation(config); }
  providerInfo(provider) { return { id: provider, name: 'DeepSeek 网页 · 无 API' }; }
  providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'deepseek-web'); }
  async listModels(provider) { return [{ provider, id: 'deepseek-web', name: 'DeepSeek 网页', inputModalities: ['text'] }]; }
  async resolveModel(provider, model) { return { provider, id: model, name: 'DeepSeek 网页', inputModalities: ['text'], context: { contextWindow: OFFICIAL_CONTEXT_TOKENS } }; }
  async *stream(options) {
    let nextIndex = 0, request, lastResponse;
    try {
      if (options.purpose === 'session-title') {
        const text = options.messages.filter(m => m.role === 'user').flatMap(m => m.content).filter(b => b.type === 'text').map(b => b.text).join(' ').replace(/\s+/g, ' ').slice(0, 24) || 'DeepSeek 网页会话';
        yield* replyChunks({ kind: 'final', text }); return;
      }
      const broker = this.broker;
      const prepared = yield* this.context.prepare(options, async function* (part) {
        request = part;
        const result = yield* streamProgress(broker, part, options.signal, nextIndex);
        nextIndex = result.nextIndex;
        if (result.failure) throw result.failure;
        const parsed = parseReply(result.response, part);
        broker.event?.(part, 'summary-received', { chars: parsed.text.length });
        return parsed.text;
      });
      if (prepared.summary !== undefined) { yield* replyChunks({ kind: 'final', text: prepared.summary }, nextIndex); return; }
      request = prepared.request;
      const result = yield* streamProgress(this.broker, request, options.signal, nextIndex);
      nextIndex = result.nextIndex;
      if (result.failure) throw result.failure;
      lastResponse = result.response;
      const parsed = parseReply(result.response, request);
      this.broker.setPanelOutcome?.(request.id, null, parsed.kind);
      this.broker.event?.(request, 'validated', { kind: parsed.kind, tools: parsed.calls?.map(c => c.name) ?? [] });
      yield* replyChunks(parsed, nextIndex);
    } catch (error) {
      if (lastResponse !== undefined) this.broker.event?.(request, 'adapter-validation-failed', { ...replyMetadata(lastResponse), code: error.code, ...error.details });
      this.broker.setPanelOutcome?.(request?.id, error.message);
      // Preserve a visible terminal message even when the host only retains streamed
      // content on failure. Still throw the real error: this is not a successful answer.
      const text = '网页桥接已停止：' + error.message + '\n\n本次网页回复未作为工具指令执行。';
      yield { type: 'block-start', index: nextIndex, blockType: 'text' };
      yield { type: 'text-delta', index: nextIndex, text };
      yield { type: 'block-end', index: nextIndex, block: { type: 'text', text } };
      throw new LlmError(error.message, error.code ?? 'WEB_BRIDGE_ERROR');
    }
  }
}
export async function apply(ctx, config) {
  // Desktop and Web both own a profileContext. Read pairing state from that
  // profile, never the application's current working directory or ASAR tree.
  const stateDir = ctx.get('profileContext')?.dir;
  config = { ...config };
  if (!config.token && stateDir) {
    try { config.token = (await readFile(join(stateDir, 'web-bridge', 'token'), 'utf8')).trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') { ctx.logger.warn('网页桥接无法读取配对文件（%s），请重新 setup。', error.code ?? 'IO_ERROR'); return; }
    }
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.token)) {
    ctx.logger.warn('网页桥接尚未配对：退出应用后执行 dsh-web-bridge setup，再重启。');
    return;
  }
  config.auditPath ||= stateDir ? join(stateDir, 'web-bridge', 'logs', 'events.jsonl') : '';
  if (config.remote) {
    const remote = { submit: (request, signal, onProgress) => submitRemote(config, request, signal, onProgress) };
    ctx.llm.registerAdapter(['deepseek-web'], new WebAdapter(remote, config));
    return;
  }
  if (config.auditPath) await mkdir(dirname(config.auditPath), { recursive: true });
  const broker = new Broker({ ...config, onEvent: event => { if (config.auditPath) appendFile(config.auditPath, JSON.stringify(event) + '\n').catch(() => {}); } });
  broker.lastPanel = await restoreLastPanel(config.auditPath);
  // A missing pair or an occupied bridge port must not take Desktop down.
  try { await broker.start(); }
  catch (error) {
    await broker.close();
    ctx.logger.warn('网页桥接未启动（%s），请检查本机端口 %s。', error.code ?? 'START_FAILED', config.port);
    return;
  }
  ctx.effect(() => () => broker.close(), 'deepseek-web: local broker');
  ctx.inject(['connection', 'webServer'], scope => registerPanel(scope, broker));
  ctx.llm.registerAdapter(['deepseek-web'], new WebAdapter(broker, config));
}
