#!/usr/bin/env node
/**
 * fix-ios-package-swift.js
 *
 * Runs automatically as the `capacitor:sync:after` hook after every `cap sync ios`.
 * `cap sync ios` overwrites CapApp-SPM/Package.swift with raw pnpm virtual-store
 * paths and a remote capacitor-swift-pm URL. This script fixes both problems:
 *
 * 1. Extracts Capacitor.xcframework + Cordova.xcframework from the committed ZIPs
 *    in vendor/ so Xcode never needs to download binary XCFrameworks from GitHub.
 * 2. (Re)creates stable relative symlinks in CapApp-SPM/symlinks/ pointing to the
 *    artifact-local node_modules/@capacitor/... entries.
 * 3. Patches CapApp-SPM/Package.swift to:
 *    a) reference symlinks/<Name> instead of the long pnpm virtual-store path.
 *    b) reference vendor/capacitor-swift-pm (local) instead of the remote GitHub URL.
 * 4. Patches each plugin's own Package.swift to replace the remote
 *    capacitor-swift-pm URL with a local relative path so Xcode's SPM resolver
 *    never needs to fetch that remote binary package either.
 */

import {
  existsSync, mkdirSync, symlinkSync, unlinkSync,
  readFileSync, writeFileSync, realpathSync
} from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const artifactDir   = resolve(__dirname, '..');
const capAppSpmDir  = resolve(artifactDir, 'ios/App/CapApp-SPM');
const symlinksDir   = resolve(capAppSpmDir, 'symlinks');
const vendorDir     = resolve(capAppSpmDir, 'vendor');
const vendorPkgDir  = resolve(vendorDir, 'capacitor-swift-pm');
const packageSwiftPath = resolve(capAppSpmDir, 'Package.swift');

// ---------------------------------------------------------------------------
// Step 1 — Extract XCFrameworks from committed ZIPs
// ---------------------------------------------------------------------------
const frameworks = [
  { zip: resolve(vendorDir, 'Capacitor.xcframework.zip'),  xcfw: resolve(vendorPkgDir, 'Capacitor.xcframework') },
  { zip: resolve(vendorDir, 'Cordova.xcframework.zip'),    xcfw: resolve(vendorPkgDir, 'Cordova.xcframework')   },
];

mkdirSync(vendorPkgDir, { recursive: true });

for (const { zip, xcfw } of frameworks) {
  if (!existsSync(xcfw)) {
    if (!existsSync(zip)) {
      console.error(`[fix-ios] Missing ZIP: ${zip} — re-run from the monorepo root.`);
      process.exit(1);
    }
    console.log(`[fix-ios] Extracting ${zip} → ${vendorPkgDir}`);
    execSync(`unzip -q "${zip}" -d "${vendorPkgDir}"`, { stdio: 'inherit' });
  } else {
    console.log(`[fix-ios] ${xcfw.split('/').pop()} already extracted — skipping.`);
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Recreate stable symlinks for plugin packages
// ---------------------------------------------------------------------------
const plugins = [
  { name: 'CapacitorCamera',                relativeTarget: '../../../../node_modules/@capacitor/camera' },
  { name: 'CapacitorGeolocation',           relativeTarget: '../../../../node_modules/@capacitor/geolocation' },
  { name: 'CapacitorCommunityCameraPreview', relativeTarget: '../../../../node_modules/@capacitor-community/camera-preview' },
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

// ---------------------------------------------------------------------------
// Step 3 — Patch CapApp-SPM/Package.swift
//   a) Replace pnpm virtual-store plugin paths with symlinks/<Name>
//   b) Replace remote capacitor-swift-pm URL with local vendor/ path
// ---------------------------------------------------------------------------
if (!existsSync(packageSwiftPath)) {
  console.warn('[fix-ios] Package.swift not found — skipping patch.');
  process.exit(0);
}

let content = readFileSync(packageSwiftPath, 'utf8');
let patched = content;

// a) Plugin paths → symlinks/
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

// b) Remote capacitor-swift-pm → local vendor/
patched = patched.replace(
  /\.package\(\s*url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git"[^)]*\)/g,
  `.package(name: "capacitor-swift-pm", path: "vendor/capacitor-swift-pm")`
);

if (patched !== content) {
  writeFileSync(packageSwiftPath, patched, 'utf8');
  console.log('[fix-ios] CapApp-SPM/Package.swift patched (symlink paths + local vendor).');
} else {
  console.log('[fix-ios] CapApp-SPM/Package.swift already correct.');
}

// ---------------------------------------------------------------------------
// Step 4 — Patch each plugin's own Package.swift
//   Replace the remote capacitor-swift-pm URL with a local relative path.
//   From inside symlinks/<Name>/ the vendor package is at ../../vendor/capacitor-swift-pm.
// ---------------------------------------------------------------------------
for (const plugin of plugins) {
  const linkPath = resolve(symlinksDir, plugin.name);
  let realPkgSwift;
  try {
    // Follow symlink to real file in node_modules
    const realDir = realpathSync(linkPath);
    realPkgSwift  = resolve(realDir, 'Package.swift');
  } catch {
    console.warn(`[fix-ios] Could not resolve symlink for ${plugin.name} — skipping plugin patch.`);
    continue;
  }

  if (!existsSync(realPkgSwift)) {
    console.warn(`[fix-ios] ${plugin.name}/Package.swift not found — skipping.`);
    continue;
  }

  const pluginContent = readFileSync(realPkgSwift, 'utf8');

  // Replace any remote capacitor-swift-pm reference with our local vendor path.
  //
  // We MUST use an ABSOLUTE path here because SPM resolves local package paths
  // relative to the Package.swift's CANONICAL (real, symlink-resolved) location,
  // which is deep inside node_modules/.pnpm/... — not relative to the symlink at
  // CapApp-SPM/symlinks/<Name>/. A relative path would resolve to the wrong place.
  //
  // Using the absolute path to vendorPkgDir (computed on this machine by the fix
  // script) gives SPM a path it can always find. SPM deduplicates local packages by
  // their resolved absolute path, so CapApp-SPM's relative "vendor/capacitor-swift-pm"
  // and these absolute paths all collapse to the same identity. ✓
  const absoluteVendorPath = vendorPkgDir;
  const patchedPlugin = pluginContent.replace(
    /\.package\(\s*url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git"[^)]*\)/g,
    `.package(name: "capacitor-swift-pm", path: "${absoluteVendorPath}")`
  );

  if (patchedPlugin !== pluginContent) {
    writeFileSync(realPkgSwift, patchedPlugin, 'utf8');
    console.log(`[fix-ios] ${plugin.name}/Package.swift patched (local vendor/capacitor-swift-pm).`);
  } else {
    console.log(`[fix-ios] ${plugin.name}/Package.swift already correct or no match.`);
  }
}

console.log('[fix-ios] Done.');
