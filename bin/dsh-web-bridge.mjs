#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, readdir, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const begin = '# BEGIN DSH WEB BRIDGE (managed)';
const end = '# END DSH WEB BRIDGE (managed)';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

async function optional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function context(args) {
  let profileDir = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--profile-dir' || !args[i + 1]) throw new Error('未知参数：' + args[i]);
    profileDir = resolve(args[++i]);
  }
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'));
  if (!manifest.dsh?.profile) throw new Error('请通过 dsh plugin --profile desktop exec dsh-web-bridge setup 运行，或指定 --profile-dir。');
  return { profileDir, state: join(profileDir, 'web-bridge'), patch: join(profileDir, 'cordis.patch.yml') };
}

export async function setup(args = []) {
  const ctx = await context(args);
  const previous = await optional(ctx.patch) ?? '';
  const hasBegin = previous.includes(begin), hasEnd = previous.includes(end);
  if (hasBegin !== hasEnd || (hasBegin && previous.indexOf(end) < previous.indexOf(begin))) throw new Error('托管配置标记不完整，请先检查 cordis.patch.yml。');
  const outside = hasBegin ? previous.slice(0, previous.indexOf(begin)) + previous.slice(previous.indexOf(end) + end.length) : previous;
  if (/^\s*-\s*id:\s*['"]?deepseek-web-bridge\b/m.test(outside)) throw new Error('发现手工配置的 deepseek-web-bridge。请先备份并移除旧条目，再执行 setup，避免重复注册。');
  await mkdir(ctx.state, { recursive: true });
  const tokenFile = join(ctx.state, 'token');
  let token = (await optional(tokenFile))?.trim();
  if (token && !tokenPattern.test(token)) throw new Error('已存在的配对密钥格式异常，未覆盖。');
  if (!token) {
    token = randomBytes(32).toString('base64url');
    await writeFile(tokenFile, token + '\n', { flag: 'wx', mode: 0o600 });
  }
  const chromeDir = join(ctx.state, 'chrome');
  await mkdir(chromeDir, { recursive: true });
  for (const name of await readdir(join(packageRoot, 'extension'))) {
    if (name === 'manifest.json' || name === 'package.json' || name === 'popup.html' || name.endsWith('.js')) {
      await copyFile(join(packageRoot, 'extension', name), join(chromeDir, name));
    }
  }
  await writeFile(join(chromeDir, 'local-config.json'), JSON.stringify({ token }, null, 2) + '\n', { mode: 0o600 });
  // Pairing is read through profileContext at runtime. Do not append inline
  // secrets or config overrides to Desktop's user patch. Migrate only the
  // legacy setup block, leaving every unrelated patch byte unchanged.
  if (hasBegin) {
    const next = outside.trim() ? outside : '[]\n';
    await writeFile(ctx.patch + '.web-bridge-backup-' + Date.now(), previous, { flag: 'wx', mode: 0o600 });
    const temporary = ctx.patch + '.web-bridge-tmp-' + process.pid;
    await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
    await rename(temporary, ctx.patch);
  }
  return { profileDir: ctx.profileDir, chromeDir, coreVersion: '0.2.16-desktop.1', chromeVersion: '0.2.19' };
}

export async function doctor(args = []) {
  const ctx = await context(args);
  const token = (await readFile(join(ctx.state, 'token'), 'utf8')).trim();
  const config = JSON.parse(await readFile(join(ctx.state, 'chrome', 'local-config.json'), 'utf8'));
  if (!tokenPattern.test(token) || config.token !== token) throw new Error('本地 Chrome 配对文件与服务端密钥不一致，请重新 setup。');
  const pairing = await fetch('http://127.0.0.1:3081/pairing-check', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(4000) });
  if (pairing.status !== 405) throw new Error('3081 端口不是此配置的桥接服务（配对未通过）。请检查是否运行了另一个 DSH 实例。');
  const status = await (await fetch('http://127.0.0.1:3081/status', { signal: AbortSignal.timeout(4000) })).json();
  return { server: true, paired: true, connected: status.connected, workerVersion: status.workerVersion ?? null, queued: status.queued, active: Boolean(status.active), chromeDir: join(ctx.state, 'chrome') };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log('DSH Desktop 网页桥接 0.2.16-desktop.1 / Chrome 0.2.19\n\ndsh plugin --profile desktop exec dsh-web-bridge setup\ndsh plugin --profile desktop exec dsh-web-bridge doctor\n\n高级选项：--profile-dir <DSH profile 的绝对路径>\nsetup 不会更改默认模型；启动 DSH 后请选择“DeepSeek 网页”。');
  } else if (command === 'setup') {
    const r = await setup(args);
    console.log('配对文件已准备。Chrome：chrome://extensions → 开发者模式 → 加载已解压的扩展程序\n选择目录：' + r.chromeDir + '\n扩展版本：' + r.chromeVersion + '\n然后启动／重启对应 DSH 配置，在模型菜单选择“DeepSeek 网页”。');
  } else if (command === 'doctor') {
    const r = await doctor(args);
    console.log(JSON.stringify(r, null, 2));
    if (!r.connected) process.exitCode = 2;
  } else throw new Error('未知命令：' + command);
}
// pnpm may enter through a symlink; compare canonical paths, not spelling.
function isMain() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isMain()) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
