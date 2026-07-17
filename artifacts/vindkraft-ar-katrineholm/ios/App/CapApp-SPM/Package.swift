// swift-tools-version: 5.9
import PackageDescription

// IMPORTANT: This file is the SOURCE OF TRUTH committed to git.
// `cap sync ios` would overwrite it; scripts/fix-ios-package-swift.js
// (run by `pnpm native:fix-spm` / the `capacitor:sync:after` hook) restores it.
//
// Design: ALL dependencies are LOCAL — no network access needed at all.
//   • Capacitor.xcframework + Cordova.xcframework: vendor/capacitor-swift-pm/
//   • IONCameraLib Swift sources:    vendor/ion-ios-camera/    (tag 1.0.4)
//   • IONGeolocationLib Swift sources: vendor/ion-ios-geolocation/ (tag 2.1.1)
//   • Plugin Swift sources: symlinks/<Name>/ios/Sources/<TargetDir>/
//
// Prerequisites for Xcode to build:
//   1. git pull (gets all vendored sources committed to git)
//   2. pnpm install (creates node_modules so symlinks/ resolve to plugin sources)
//   3. Open App.xcodeproj — no other steps needed, no network required.
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        // ALL LOCAL — committed to git; zero network access needed.
        .package(name: "capacitor-swift-pm", path: "vendor/capacitor-swift-pm"),
        .package(name: "ion-ios-camera",     path: "vendor/ion-ios-camera"),
        .package(name: "ion-ios-geolocation", path: "vendor/ion-ios-geolocation"),
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
