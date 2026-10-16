#!/usr/bin/env node
// Copy the napplet build into a soyLI project for publishing on napplet.soy.
//
//   npm run build:napplet
//   node tools/napplet-sync.mjs [soyli-project-dir] [--check]
//
// npm run napplet:release does the build, the sync and `soyli check` in one go.
// The project defaults to $HOF_NAPPLET_PROJECT, then ../hang-on-fren-napplet.
//
// The project is a separate Git repository made with `soyli new`: soyLI
// publishes the project's whole Git tree, which must stay small, so it holds
// only the built index.html and the external assets. This script copies the
// HTML, registers each file in dist-napplet-assets/ as an external soyLI asset
// (replacing ones whose bytes changed and removing ones no longer built) and
// points napplet.json at the single-file entry, then with --check runs
// `soyli check` there. It never commits or publishes; review, then
// `soyli checkpoint` and `soyli publish` in the project.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD_HTML = join(ROOT, 'dist-napplet/index.html');
const ASSETS_DIR = join(ROOT, 'dist-napplet-assets');
const SOYLI = process.env.SOYLI ?? 'soyli';

const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args.find(arg => !arg.startsWith('--')) ?? process.env.HOF_NAPPLET_PROJECT ?? join(ROOT, '../hang-on-fren-napplet');
const project = resolve(target);
const configPath = join(project, 'napplet.json');
if (!existsSync(configPath)) throw new Error(`${project} is not a soyLI project (no napplet.json)`);
if (!existsSync(BUILD_HTML) || !existsSync(join(ASSETS_DIR, 'assets.json'))) {
  throw new Error('Run `npm run build:napplet` first');
}

const soyli = (...args) => execFileSync(SOYLI, args, { cwd: project, stdio: ['ignore', 'inherit', 'inherit'] });

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.entry = 'index.html';
config.requires = [...new Set([...(config.requires ?? []), 'resource'])];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
copyFileSync(BUILD_HTML, join(project, 'index.html'));

const built = JSON.parse(readFileSync(join(ASSETS_DIR, 'assets.json'), 'utf8'));
const registryPath = join(project, 'napplet.assets.json');
const registered = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')).assets : [];
const wanted = new Map(built.map(asset => [asset.id, asset]));

for (const asset of registered) {
  const next = wanted.get(asset.id);
  if (!next || next.sha256 !== asset.hash) soyli('assets', 'remove', asset.id);
}
const current = new Map(registered.map(asset => [asset.id, asset.hash]));
for (const asset of built) {
  if (current.get(asset.id) === asset.sha256) continue;
  soyli('assets', 'add', join(ASSETS_DIR, asset.file), asset.id, '--storage', 'external', '--license', config.license ?? 'MIT');
}

const total = built.reduce((sum, asset) => sum + asset.bytes, 0);
console.log(`Synced index.html and ${built.length} external assets (${(total / 1048576).toFixed(1)} MiB) into ${project}.`);
if (check) soyli('check');
console.log(`Next, in ${project}: ${check ? '' : 'soyli check, '}soyli dev to try it, then soyli checkpoint "…" and soyli publish.`);
