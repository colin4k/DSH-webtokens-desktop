import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup } from '../bin/dsh-web-bridge.mjs';

test('setup pairs a real profile, preserves unrelated settings, and remains idempotent', async () => {
 const dir=await mkdtemp(join(tmpdir(),'dsh-package-'));
 try {
  await writeFile(join(dir,'package.json'),JSON.stringify({dsh:{profile:{bundles:[]}}}));
  const original='- id: agent-default-model\n  config:\n    provider: existing\n    model: keep-me\n';
  await writeFile(join(dir,'cordis.patch.yml'),original);
  const result=await setup(['--profile-dir',dir]);
  const patch=await readFile(join(dir,'cordis.patch.yml'),'utf8');
  assert.ok(patch.startsWith(original));assert.equal(result.chromeVersion,'0.2.19');
  const config=JSON.parse(await readFile(join(result.chromeDir,'local-config.json'),'utf8'));
  assert.match(config.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(patch,original);assert.ok(!patch.includes(config.token));
  assert.equal(JSON.parse(await readFile(join(result.chromeDir,'manifest.json'),'utf8')).version,'0.2.19');
  await setup(['--profile-dir',dir]);
  assert.equal(await readFile(join(dir,'cordis.patch.yml'),'utf8'),patch);
  assert.equal(JSON.parse(await readFile(join(result.chromeDir,'local-config.json'),'utf8')).token,config.token);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('CLI setup works through a symlink and creates a usable pairing directory', async () => {
 const dir=await mkdtemp(join(tmpdir(),'dsh-symlink-'));
 try {
  await writeFile(join(dir,'package.json'),JSON.stringify({dsh:{profile:{bundles:[]}}}));
  const entry=join(dir,'bridge-link.mjs');
  await symlink(fileURLToPath(new URL('../bin/dsh-web-bridge.mjs',import.meta.url)),entry);
  const result=spawnSync(process.execPath,[entry,'setup','--profile-dir',dir],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/配对文件已准备/);
  assert.ok((await readdir(join(dir,'web-bridge','chrome'))).includes('local-config.json'));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('setup backs up and removes only its legacy managed patch block', async () => {
 const dir=await mkdtemp(join(tmpdir(),'dsh-migrate-'));
 try {
  await writeFile(join(dir,'package.json'),JSON.stringify({dsh:{profile:{bundles:[]}}}));
  const unrelated='- id: unrelated\n  config:\n    enabled: true\n';
  const legacy=unrelated+'\n# BEGIN DSH WEB BRIDGE (managed)\n- id: deepseek-web-bridge\n  config:\n    token: old-inline-secret\n# END DSH WEB BRIDGE (managed)\n';
  await writeFile(join(dir,'cordis.patch.yml'),legacy);
  await setup(['--profile-dir',dir]);
  assert.equal(await readFile(join(dir,'cordis.patch.yml'),'utf8'),unrelated+'\n\n');
  const backup=(await readdir(dir)).find(name=>name.startsWith('cordis.patch.yml.web-bridge-backup-'));
  assert.equal(await readFile(join(dir,backup),'utf8'),legacy);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('setup handles empty YAML and rejects an existing manual bridge or a non-profile',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-empty-'));
 try{
  await writeFile(join(dir,'package.json'),'{}');
  await assert.rejects(setup(['--profile-dir',dir]),/profile|指定/);
  await writeFile(join(dir,'package.json'),JSON.stringify({dsh:{profile:{}}}));
  await writeFile(join(dir,'cordis.patch.yml'),'# empty\n[]\n');
  await setup(['--profile-dir',dir]);
  assert.equal(await readFile(join(dir,'cordis.patch.yml'),'utf8'),'# empty\n[]\n');
  const manual='- insert:\n    - id: deepseek-web-bridge\n      name: dsh-web-bridge\n';
  await writeFile(join(dir,'cordis.patch.yml'),manual);
  await assert.rejects(setup(['--profile-dir',dir]),/手工配置/);
  assert.equal(await readFile(join(dir,'cordis.patch.yml'),'utf8'),manual);
 }finally{await rm(dir,{recursive:true,force:true});}
});
