#!/usr/bin/env node
import { cp, rename, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
try {
  const backup = resolve(process.argv[2] ?? '');
  if (!/\/profiles\/desktop\.before-web-bridge-\d+$/.test(backup)) throw new Error('请指定安装脚本打印的完整备份目录。');
  if (process.platform === 'darwin' && spawnSync('/usr/bin/pgrep', ['-f', '/DeepSeek Harness.app/Contents/MacOS/']).status === 0) throw new Error('请先完全退出 Desktop。');
  const manifest = JSON.parse(await readFile(backup + '/package.json', 'utf8'));
  if (!manifest.dsh?.profile) throw new Error('备份不是有效 profile。');
  const dir = backup.replace(/\.before-web-bridge-\d+$/, '');
  const failed = dir + '.after-web-bridge-' + Date.now();
  try { await rename(dir, failed); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await cp(backup, dir, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
  console.log('已恢复安装前 Desktop profile。原适配配置保留在：' + failed);
} catch (error) { console.error(error.message); process.exitCode = 1; }
