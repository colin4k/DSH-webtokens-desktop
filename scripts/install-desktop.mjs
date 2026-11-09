#!/usr/bin/env node
// Run with a system Node >=24.9.0. All profile package operations use Desktop's
// own carrier, with its transaction lock, bundled pnpm and compatibility gate.
import { spawnSync } from 'node:child_process';
import { readFile, readdir, cp, rename, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dsh = process.argv[2] ?? '/usr/local/bin/dsh';
const target = '0.2.2-rc.1';
function run(args, capture = false) {
  const result = spawnSync(dsh, args, { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Desktop 命令失败（退出码 ${result.status}）。${capture ? result.stderr : ''}`);
  return result.stdout?.trim();
}
let dir, backup, mutated = false;
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 9)) throw new Error('需要 Node.js >=24.9.0。');
  const version = run(['--version'], true);
  if (!new RegExp(`(?:^|\\s)${target.replaceAll('.', '\\.')}($|\\s)`).test(version)) throw new Error(`本适配包仅支持 Desktop ${target}；命令报告：${version}`);
  if (process.platform === 'darwin') {
    const running = spawnSync('/usr/bin/pgrep', ['-f', '/DeepSeek Harness.app/Contents/MacOS/'], { encoding: 'utf8' });
    if (running.status === 0) throw new Error('请先用 ⌘Q 完全退出 DeepSeek Harness，再运行安装脚本。');
  }
  const archives = (await readdir(join(root, 'dist'))).filter(name => /^dsh-web-bridge-.*\.tgz$/.test(name));
  if (archives.length !== 1) throw new Error('dist 下必须有且只有一个适配版 tgz 安装包。');
  const archive = join(root, 'dist', archives[0]);
  // Ask the installed carrier for the actual path (honors custom DSH_HOME).
  const output = run(['plugin', '--profile', 'desktop', 'exec', 'node', '-p', 'JSON.stringify({profileDir:process.cwd()})'], true);
  const line = output.split(/\r?\n/).findLast(line => line.startsWith('{"profileDir":'));
  dir = JSON.parse(line).profileDir;
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  if (!manifest.dsh?.profile || !dir.endsWith('/profiles/desktop')) throw new Error('无法确认 Desktop profile，未修改任何文件。');
  backup = dir + '.before-web-bridge-' + Date.now();
  await cp(dir, backup, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  console.log('已备份完整 profile：' + backup);
  mutated = true;
  if (manifest.dependencies?.['dsh-web-bridge']) run(['plugin', '--profile', 'desktop', 'remove', 'dsh-web-bridge']);
  run(['plugin', '--profile', 'desktop', 'add', archive]);
  // These packages should be provided by the installation, not the plugin.
  const scopes = await readdir(join(dir, 'node_modules', '@deepseek-ai')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const name of scopes.filter(name => name.startsWith('dsh-') || name === 'schemastery' || name === 'cordis')) {
    let local;
    try { local = JSON.parse(await readFile(join(dir, 'node_modules', '@deepseek-ai', name, 'package.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const valid = name === 'schemastery' ? /^3\.19\./.test(local?.version) : name === 'cordis' ? /^4\.1\./.test(local?.version) : local?.version === target;
    if (local && !valid) throw new Error(`其他插件仍在 profile 安装了 ${name}@${local.version}；需要先处理版本冲突。`);
  }
  run(['plugin', '--profile', 'desktop', 'exec', 'dsh-web-bridge', 'setup']);
  await access(join(dir, 'web-bridge', 'chrome', 'local-config.json'));
  console.log('\n安装及配对文件生成完成。');
  console.log('Chrome 加载目录：' + join(dir, 'web-bridge', 'chrome'));
  console.log('重新打开 Desktop，在模型菜单选择“DeepSeek 网页”。');
  console.log('若应用启动失败，完全退出后可运行：');
  console.log('node ' + JSON.stringify(join(root, 'scripts', 'rollback-desktop.mjs')) + ' ' + JSON.stringify(backup));
} catch (error) {
  console.error(error.message);
  if (mutated && backup) {
    try {
      const failed = dir + '.failed-web-bridge-' + Date.now();
      await rename(dir, failed);
      await cp(backup, dir, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      console.error('已恢复安装前 profile；失败现场保留在：' + failed);
    } catch (rollback) { console.error('自动恢复未完成：' + rollback.message + '\n完整备份：' + backup); }
  }
  process.exitCode = 1;
}
