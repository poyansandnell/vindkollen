// swift-tools-version: 5.9
import PackageDescription

// IMPORTANT: This file is restored by scripts/fix-ios-package-swift.js after
// every `cap sync ios` (which overwrites it). Do not edit by hand.
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
