#!/usr/bin/env node
/**
 * fix-ios-package-swift.js
 *
 * Runs automatically as the `capacitor:sync:after` hook after every `cap sync ios`.
 * `cap sync ios` overwrites CapApp-SPM/Package.swift with a version that uses
 * pnpm virtual-store paths AND a remote capacitor-swift-pm GitHub URL — both
 * of which cause Xcode to fail.
 *
 * This script replaces Package.swift with an inline-target design that:
 *  - Compiles plugin Swift sources directly as CapApp-SPM targets (no separate
 *    plugin Swift packages) via symlinks/… paths.
 *  - Uses the locally vendored capacitor-swift-pm (Capacitor.xcframework and
 *    Cordova.xcframework are committed to git in vendor/capacitor-swift-pm/).
 *  - Only fetches ion-ios-camera + ion-ios-geolocation remotely (Swift source
 *    packages, not binary — small and fast to download).
 *
 * As a result, after `git pull && pnpm install`, opening App.xcodeproj in Xcode
 * requires NO extra setup steps and downloads NO binary XCFrameworks from GitHub.
 */

import {
  existsSync, mkdirSync, symlinkSync, unlinkSync,
  readFileSync, writeFileSync
} from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const artifactDir      = resolve(__dirname, '..');
const capAppSpmDir     = resolve(artifactDir, 'ios/App/CapApp-SPM');
const symlinksDir      = resolve(capAppSpmDir, 'symlinks');
const vendorDir        = resolve(capAppSpmDir, 'vendor');
const vendorPkgDir     = resolve(vendorDir, 'capacitor-swift-pm');
const packageSwiftPath = resolve(capAppSpmDir, 'Package.swift');

// ---------------------------------------------------------------------------
// Step 1 — Ensure XCFrameworks exist in vendor/capacitor-swift-pm/
//   They are committed to git, so this is normally a no-op.
//   As a fallback, unzip from the committed ZIPs if somehow missing.
// ---------------------------------------------------------------------------
const frameworks = [
  { zip: resolve(vendorDir, 'Capacitor.xcframework.zip'), xcfw: resolve(vendorPkgDir, 'Capacitor.xcframework') },
  { zip: resolve(vendorDir, 'Cordova.xcframework.zip'),   xcfw: resolve(vendorPkgDir, 'Cordova.xcframework')   },
];

mkdirSync(vendorPkgDir, { recursive: true });

for (const { zip, xcfw } of frameworks) {
  if (existsSync(xcfw)) {
    console.log(`[fix-ios] ${xcfw.split('/').pop()} present (committed) — skipping extraction.`);
  } else if (existsSync(zip)) {
    console.log(`[fix-ios] Extracting ${zip} → ${vendorPkgDir}`);
    execSync(`unzip -q "${zip}" -d "${vendorPkgDir}"`, { stdio: 'inherit' });
  } else {
    console.error(`[fix-ios] Missing both ${xcfw} and ${zip}. Run git pull and try again.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Recreate stable symlinks for plugin packages
// ---------------------------------------------------------------------------
const plugins = [
  { name: 'CapacitorCamera',                relativeTarget: '../../../../node_modules/@capacitor/camera' },
  { name: 'CapacitorGeolocation',           relativeTarget: '../../../../node_modules/@capacitor/geolocation' },
  { name: 'CapacitorCommunityCameraPreview', relativeTarget: '../../../../node_modules/@capacitor-community/camera-preview' },
  { name: 'CapacitorBrowser',               relativeTarget: '../../../../node_modules/@capacitor/browser' },
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
// Step 3 — Write the correct Package.swift (inline-target design)
//   `cap sync ios` regenerates this file with the wrong content; we always
//   overwrite it after sync.
// ---------------------------------------------------------------------------
const PACKAGE_SWIFT = `\
// swift-tools-version: 5.9
import PackageDescription

// IMPORTANT: This file is restored by scripts/fix-ios-package-swift.js after
// every \`cap sync ios\` (which overwrites it). Do not edit by hand.
//
// Plugin Swift sources are compiled as INLINE targets so that Xcode never needs
// to download the remote capacitor-swift-pm binary package. Capacitor.xcframework
// and Cordova.xcframework are vendored in vendor/capacitor-swift-pm/ (committed
// to git). Only ion-ios-camera + ion-ios-geolocation (small Swift source packages)
// are fetched remotely.
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        // LOCAL — XCFrameworks committed to git; no network access needed.
        .package(name: "capacitor-swift-pm", path: "vendor/capacitor-swift-pm"),
        // REMOTE — Swift source packages only; fast to clone.
        .package(url: "https://github.com/ionic-team/ion-ios-camera.git", exact: "1.0.4"),
        .package(url: "https://github.com/ionic-team/ion-ios-geolocation.git", exact: "2.1.1"),
    ],
    targets: [
        .target(
            name: "CameraPlugin",
            dependencies: [
                .product(name: "Capacitor",    package: "capacitor-swift-pm"),
                .product(name: "Cordova",      package: "capacitor-swift-pm"),
                .product(name: "IONCameraLib", package: "ion-ios-camera"),
            ],
            path: "symlinks/CapacitorCamera/ios/Sources/CameraPlugin"
        ),
        .target(
            name: "GeolocationPlugin",
            dependencies: [
                .product(name: "Capacitor",        package: "capacitor-swift-pm"),
                .product(name: "Cordova",          package: "capacitor-swift-pm"),
                .product(name: "IONGeolocationLib", package: "ion-ios-geolocation"),
            ],
            path: "symlinks/CapacitorGeolocation/ios/Sources/GeolocationPlugin"
        ),
        .target(
            name: "CameraPreviewPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova",   package: "capacitor-swift-pm"),
            ],
            path: "symlinks/CapacitorCommunityCameraPreview/ios/Sources/CameraPreviewPlugin"
        ),
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova",   package: "capacitor-swift-pm"),
                "CameraPlugin",
                "GeolocationPlugin",
                "CameraPreviewPlugin",
            ]
        )
    ]
)
`;

writeFileSync(packageSwiftPath, PACKAGE_SWIFT, 'utf8');
console.log('[fix-ios] CapApp-SPM/Package.swift written (inline-target design, local vendor).');
console.log('[fix-ios] Done.');
