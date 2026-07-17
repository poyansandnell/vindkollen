#!/usr/bin/env node
/**
 * fix-ios-package-swift.js
 *
 * Runs automatically as the `capacitor:sync:after` hook after every `cap sync ios`.
 * `cap sync ios` overwrites CapApp-SPM/Package.swift with raw pnpm virtual-store
 * paths (e.g. node_modules/.pnpm/@capacitor+camera@8.2.1_.../node_modules/...).
 * Xcode 15/16 sometimes fails to resolve those paths.
 *
 * This script:
 *  1. (Re)creates stable relative symlinks in CapApp-SPM/symlinks/ that point to
 *     the artifact-local node_modules/@capacitor/... entries (which are themselves
 *     pnpm symlinks with clean names that work reliably on macOS/Xcode).
 *  2. Patches Package.swift to reference "symlinks/<Name>" instead of the long
 *     pnpm virtual-store path — keeping Package.swift clean and Xcode-friendly.
 *
 * The symlinks use RELATIVE targets so they can be committed to git and work on
 * any machine after `pnpm install`.
 */

import { existsSync, mkdirSync, symlinkSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const artifactDir = resolve(__dirname, '..');
const capAppSpmDir = resolve(artifactDir, 'ios/App/CapApp-SPM');
const symlinksDir = resolve(capAppSpmDir, 'symlinks');
const packageSwiftPath = resolve(capAppSpmDir, 'Package.swift');

const plugins = [
  {
    name: 'CapacitorCamera',
    relativeTarget: '../../../../node_modules/@capacitor/camera',
  },
  {
    name: 'CapacitorGeolocation',
    relativeTarget: '../../../../node_modules/@capacitor/geolocation',
  },
  {
    name: 'CapacitorCommunityCameraPreview',
    relativeTarget: '../../../../node_modules/@capacitor-community/camera-preview',
  },
];

mkdirSync(symlinksDir, { recursive: true });

for (const plugin of plugins) {
  const linkPath = resolve(symlinksDir, plugin.name);
  try {
    if (existsSync(linkPath)) unlinkSync(linkPath);
    symlinkSync(plugin.relativeTarget, linkPath);
    console.log(`[fix-ios] symlinks/${plugin.name} → ${plugin.relativeTarget}`);
  } catch (err) {
    console.error(`[fix-ios] Could not create symlink ${plugin.name}: ${err.message}`);
    process.exit(1);
  }
}

if (!existsSync(packageSwiftPath)) {
  console.warn('[fix-ios] Package.swift not found — skipping patch.');
  process.exit(0);
}

let content = readFileSync(packageSwiftPath, 'utf8');
let patched = content;

for (const plugin of plugins) {
  const regex = new RegExp(
    `\\.package\\(name:\\s*"${plugin.name}",\\s*path:\\s*"[^"]*"\\)`,
    'g'
  );
  patched = patched.replace(
    regex,
    `.package(name: "${plugin.name}", path: "symlinks/${plugin.name}")`
  );
}

if (patched !== content) {
  writeFileSync(packageSwiftPath, patched, 'utf8');
  console.log('[fix-ios] Package.swift patched to use symlink paths.');
} else {
  console.log('[fix-ios] Package.swift already uses symlink paths.');
}
