import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('installer restores the full profile, including relative symlinks, if Desktop package installation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-install-'));
  try {
    const dir = join(root, 'profiles', 'desktop');
    await mkdir(dir, { recursive: true });
    const original = JSON.stringify({ name: 'test-profile', dependencies: {}, dsh: { profile: { bundles: ['keep'] } } });
    await writeFile(join(dir, 'package.json'), original);
    await writeFile(join(dir, 'cordis.patch.yml'), '# keep exact\n[]\n');
    await writeFile(join(dir, 'state.txt'), 'keep state');
    await symlink('state.txt', join(dir, 'state-link'));
    const carrier = join(root, 'fake-dsh');
    await writeFile(carrier, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2), dir = process.env.TEST_DESKTOP_DIR;
if (args[0] === '--version') { console.log('0.2.2-rc.1'); }
else if (args.includes('-p')) { console.log(JSON.stringify({profileDir:dir})); }
else { fs.writeFileSync(path.join(dir,'package.json'),'broken during install'); process.exitCode=19; }
`, { mode: 0o755 });
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'dsh-web-bridge-test.tgz'), 'unused: fake carrier rejects add');
    const install = join(root, 'scripts', 'install-desktop.mjs');
    await writeFile(install, await readFile(fileURLToPath(new URL('../scripts/install-desktop.mjs', import.meta.url))));
    const result = spawnSync(process.execPath, [install, carrier], { encoding: 'utf8', env: { ...process.env, TEST_DESKTOP_DIR: dir } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /已恢复安装前 profile/);
    assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), original);
    assert.equal(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'), '# keep exact\n[]\n');
    assert.equal(await readlink(join(dir, 'state-link')), 'state.txt');
    assert.equal(await readFile(join(dir, 'state-link'), 'utf8'), 'keep state');
    assert.ok((await readdir(join(root, 'profiles'))).some(name => name.startsWith('desktop.before-web-bridge-')));
    assert.ok((await readdir(join(root, 'profiles'))).some(name => name.startsWith('desktop.failed-web-bridge-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
