// swift-tools-version: 5.9
import PackageDescription

// IMPORTANT: This file is the SOURCE OF TRUTH committed to git.
// `cap sync ios` would overwrite it; scripts/fix-ios-package-swift.js
// (run by `pnpm native:fix-spm` / the `capacitor:sync:after` hook) restores it.
//
// Design: plugin Swift sources are compiled as INLINE targets within this
// package (path: "symlinks/<Name>/ios/Sources/<TargetDir>") rather than as
// separate Swift package dependencies. This eliminates the need for Xcode to
// download the remote `capacitor-swift-pm` binary package — Capacitor.xcframework
// and Cordova.xcframework are vendored locally in vendor/capacitor-swift-pm/ and
// committed to git. Only ion-ios-camera and ion-ios-geolocation (small Swift
// source packages) are fetched remotely.
//
// Prerequisites for Xcode to build:
//   1. git pull (gets vendored XCFrameworks in vendor/capacitor-swift-pm/)
//   2. pnpm install (creates node_modules so symlinks/ resolve to plugin sources)
//   3. Open App.xcodeproj — no other steps needed.
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
        // REMOTE — Swift source packages only (~KB); fast to clone.
        .package(url: "https://github.com/ionic-team/ion-ios-camera.git", exact: "1.0.4"),
        .package(url: "https://github.com/ionic-team/ion-ios-geolocation.git", exact: "2.1.1"),
    ],
    targets: [
        // Plugin sources compiled inline — no separate Swift package needed.
        .target(
            name: "CameraPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova",   package: "capacitor-swift-pm"),
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
        // Main umbrella target that the app links against.
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
