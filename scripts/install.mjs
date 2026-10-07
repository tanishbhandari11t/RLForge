// Build RLForge, package it as a .vsix and install it into your editor (Cursor or VS Code).
// After installing, reload any open window and RLForge works inside the project you already have open.
//
//   npm start
//
// Set RLFORGE_EDITOR to a specific editor CLI (e.g. "code" or a full path to cursor.cmd) to override detection.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const vsix = join(root, `${name}-${version}.vsix`);

function onPath(cmd) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  const hits = probe.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return process.platform === 'win32' ? hits.find((h) => /\.(cmd|exe|bat)$/i.test(h)) ?? null : hits[0] ?? null;
}

function findEditor() {
  if (process.env.RLFORGE_EDITOR) return process.env.RLFORGE_EDITOR;
  for (const cmd of ['cursor', 'code']) {
    const found = onPath(cmd);
    if (found) return found;
  }
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
    join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
    join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'bin', 'code.cmd'),
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    join(homedir(), '.local', 'bin', 'cursor'),
    '/usr/bin/code',
    '/snap/bin/code',
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

console.log('[rlforge] packaging extension…');
run(`npx vsce package --out "${vsix}"`);

const editor = findEditor();
if (!editor) {
  console.log(`[rlforge] Packaged ${vsix}`);
  console.log('[rlforge] No editor CLI found. Install it via Extensions view → "..." → Install from VSIX…');
  process.exit(0);
}

console.log(`[rlforge] installing into ${editor}`);
run(`"${editor}" --install-extension "${vsix}" --force`);

console.log('');
console.log('[rlforge] Installed. In your editor run "Developer: Reload Window" once, then:');
console.log('[rlforge]   • Explorer sidebar → RLForge section → "Open Agent Arena"');
console.log('[rlforge]   • or the RLForge icon in the activity bar');
console.log('[rlforge] The Arena opens as a tab in the same window, in whatever project you have open.');
