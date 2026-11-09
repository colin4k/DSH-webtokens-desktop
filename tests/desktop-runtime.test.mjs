import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import z from '@deepseek-ai/schemastery';
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import Settings from '@deepseek-ai/dsh-settings';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import { SettingsController } from '@deepseek-ai/dsh-api-settings-controller';
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm';
import * as Bridge from '../plugins/dsh-web-bridge/index.js';
import { setup } from '../bin/dsh-web-bridge.mjs';

// Use the actual 0.2.2-rc.1 Loader, configuration composition, settings reader,
// RPC controller and LLM runtime. No replacement settings or LLM implementation.
async function fixture({ paired = false, port = 3081, patch = [] } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'bridge-desktop-'));
  const dir = join(home, 'profiles', 'desktop');
  initProfile(dir, ['test-bundle']);
  const bundle = join(dir, 'node_modules', 'test-bundle');
  await mkdir(bundle, { recursive: true });
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}');
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'settings-controller', name: 'cordis:controller' },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'locale', name: 'cordis:locale' },
    { id: 'deepseek-web-bridge', name: 'cordis:bridge', config: { port } },
  ] }]));
  await writeFile(join(dir, 'cordis.patch.yml'), JSON.stringify(patch));
  await writeFile(join(dir, 'cordis.yml'), '[]');
  if (paired) await setup(['--profile-dir', dir]);
  const profile = { name: 'desktop', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined };
  let ctx;
  try {
    ctx = await boot('desktop-test', join(dir, 'cordis.yml'), readProfilePatches('desktop-test', profile), ctx => {
      ctx.provide('profileContext', profile);
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, controller: SettingsController, llm: LlmRuntime, bridge: Bridge,
        locale: { Config: z.object({ preference: z.string().default('zh-CN').volatile() }), apply() {} } });
    });
  } catch (error) { await rm(home, { recursive: true, force: true }); throw error; }
  return { ctx, dir, close: async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); } };
}

test('Desktop startup settings RPC survives an installed but unpaired bridge', async () => {
  const f = await fixture();
  try {
    const value = f.ctx.settingsController.describe();
    assert.ok(value.namespaces.some(n => n.ns === 'locale'));
    assert.deepEqual(f.ctx.llm.listProviders(), []);
  } finally { await f.close(); }
});

test('paired bridge boots beside real Desktop settings and streams through 0.2.2 LLM prepareCall', async () => {
  const f = await fixture({ paired: true });
  try {
    assert.ok(f.ctx.settingsController.describe().namespaces.some(n => n.ns === 'locale'));
    assert.ok(f.ctx.llm.listProviders().some(p => p.id === 'deepseek-web'));
    assert.equal((await f.ctx.llm.listModels('deepseek-web'))[0].id, 'deepseek-web');
    const key = (await readFile(join(f.dir, 'web-bridge', 'token'), 'utf8')).trim();
    assert.ok(!JSON.stringify(f.ctx.settingsController.describe()).includes(key));
    const call = await f.ctx.llm.prepareCall({ provider: 'deepseek-web', model: 'deepseek-web' });
    const chunks = [];
    for await (const chunk of call.stream({ ...call.config, purpose: 'session-title', messages: [createUserMessage({ content: [{ type: 'text', text: 'Desktop runtime smoke test' }], source: { kind: 'user' } })] })) chunks.push(chunk);
    assert.ok(chunks.some(c => c.type === 'text-delta' && c.text.includes('Desktop runtime')));
  } finally { await f.close(); }
});

test('bridge port collision does not break Desktop settings RPC or register a dead adapter', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const f = await fixture({ paired: true, port: server.address().port });
  try {
    assert.ok(f.ctx.settingsController.describe().namespaces.some(n => n.ns === 'locale'));
    assert.deepEqual(f.ctx.llm.listProviders(), []);
  } finally { await f.close(); await new Promise(resolve => server.close(resolve)); }
});

test('0.2.2 prepared conversation receives authenticated worker tool calls and final text', async () => {
  const f = await fixture({ paired: true });
  const signal = AbortSignal.timeout(5000);
  try {
    const token = (await readFile(join(f.dir, 'web-bridge', 'token'), 'utf8')).trim();
    const post = async (path, body) => {
      const response = await fetch('http://127.0.0.1:3081' + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, origin: 'chrome-extension://' + 'a'.repeat(32) }, body: JSON.stringify({ clientId: 'desktop-test', version: '0.2.19', ...body }), signal });
      assert.equal(response.status, 200); return response.json();
    };
    for (const kind of ['tool_calls', 'final']) {
      const call = await f.ctx.llm.prepareCall({ provider: 'deepseek-web', model: 'deepseek-web' }, signal);
      const receive = (async () => {
        const chunks = [];
        for await (const chunk of call.stream({ ...call.config, signal, sessionId: 'desktop-smoke', messages: [createUserMessage({ content: [{ type: 'text', text: 'Read a file' }], source: { kind: 'user' } })], tools: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] })) chunks.push(chunk);
        return chunks;
      })();
      receive.catch(() => {});
      let job;
      for (let i = 0; i < 100 && !job; i++) { job = (await post('/worker/poll', {})).job; if (!job) await delay(10); }
      assert.ok(job);
      const text = JSON.stringify({ request_id: job.id, kind, text: 'Desktop round trip', ...(kind === 'tool_calls' ? { calls: [{ name: 'read', arguments: { path: 'test.txt' } }] } : {}) });
      const result = await post('/job/' + job.id, { lease: job.lease, action: 'result', text });
      assert.equal(result.ok, true);
      const chunks = await receive;
      assert.ok(chunks.some(c => c.type === 'finish' && c.reason.kind === (kind === 'tool_calls' ? 'tool-calls' : 'stop')));
      if (kind === 'tool_calls') assert.ok(chunks.some(c => c.type === 'tool-call-delta' && c.name === 'read'));
      else assert.ok(chunks.some(c => c.type === 'text-delta' && c.text === 'Desktop round trip'));
    }
    assert.ok(f.ctx.settingsController.describe().namespaces.some(n => n.ns === 'locale'));
  } finally { await f.close(); }
});
