// Development-only: pass a pnpm-installed production profile directory.
// Proves that a package with missing local peers actually uses the 0.2.2
// runtime interception, rather than accidentally using our development tree.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, loadProfileDirectory, readProfilePatches, createRuntimeResolution, PluginPackages } from '@deepseek-ai/dsh-app-boot';
import Settings from '@deepseek-ai/dsh-settings';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import { SettingsController } from '@deepseek-ai/dsh-api-settings-controller';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';

const dir = resolve(process.argv[2]);
const root = resolve(import.meta.dirname, '..');
const install = await mkdtemp(join(root, '.packed-host-'));
let ctx;
try {
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  manifest.dsh.profile.bundles = ['test-runtime-bundle', 'dsh-web-bridge'];
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
  for (const name of ['dsh-llm', 'dsh-typert-protocol', 'schemastery', 'cordis']) {
    await assert.rejects(access(join(dir, 'node_modules', '@deepseek-ai', name)), { code: 'ENOENT' });
  }
  await writeFile(join(install, 'package.json'), JSON.stringify({ name: 'desktop-test-installation', version: '0.2.2-rc.1', dependencies: {
    '@deepseek-ai/cordis': '4.1.0', '@deepseek-ai/schemastery': '3.19.0', '@deepseek-ai/dsh-llm': '0.2.2-rc.1', '@deepseek-ai/dsh-app-boot': '0.2.2-rc.1', '@deepseek-ai/dsh-settings': '0.2.2-rc.1', '@deepseek-ai/dsh-config-editor': '0.2.2-rc.1', '@deepseek-ai/dsh-api-settings-controller': '0.2.2-rc.1',
  } }));
  const bundle = join(dir, 'node_modules', 'test-runtime-bundle');
  await mkdir(bundle, { recursive: true });
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-runtime-bundle', version: '1.0.0', dsh: { bundle: { patch: 'patch.yml' } } }));
  await writeFile(join(bundle, 'patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'controller', name: 'cordis:controller' }, { id: 'llm', name: 'cordis:llm' },
    { id: 'locale', name: 'cordis:locale' },
  ] }]));
  const installAnchor = join(install, 'package.json');
  const home = install;
  const profile = loadProfileDirectory('packed-test', dir, installAnchor);
  const resolution = await createRuntimeResolution({ installAnchor, profile, home });
  const profileContext = { name: 'desktop', dir, home, installAnchor, patchPath: join(dir, 'cordis.patch.yml'), startedBundles: manifest.dsh.profile.bundles, cwd: home, overlays: [] };
  const { setup } = await import(pathToFileURL(join(dir, 'node_modules', 'dsh-web-bridge', 'bin', 'dsh-web-bridge.mjs')).href);
  await setup(['--profile-dir', dir]);
  await writeFile(join(dir, 'cordis.yml'), '[]');
  ctx = await boot('packed-desktop-test', join(dir, 'cordis.yml'), readProfilePatches('packed-desktop-test', profileContext), async ctx => {
    ctx.provide('profileContext', profileContext);
    await ctx.plugin(PluginPackages, { resolution });
    Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, controller: SettingsController, llm: LlmRuntime,
      locale: { Config: z.object({ preference: z.string().default('zh-CN').volatile() }), apply() {} } });
  });
  assert.ok(ctx.settingsController.describe().namespaces.some(n => n.ns === 'locale'));
  assert.ok(ctx.llm.listProviders().some(p => p.id === 'deepseek-web'));
  assert.equal((await ctx.llm.listModels('deepseek-web'))[0].id, 'deepseek-web');
  console.log('PASS: production tgz has no local core packages; actual runtime interception loads the bridge, reads settings and lists the model.');
} finally {
  if (ctx) await ctx.fiber.dispose();
  await rm(install, { recursive: true, force: true });
}
