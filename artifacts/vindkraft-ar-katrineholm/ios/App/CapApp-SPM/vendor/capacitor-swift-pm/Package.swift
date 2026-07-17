// swift-tools-version:5.3
import PackageDescription

// Vendored local copy of capacitor-swift-pm 8.4.2.
// XCFrameworks are committed as ZIPs in the parent vendor/ directory and
// extracted by scripts/fix-ios-package-swift.js (pnpm native:fix-spm).
// This eliminates the GitHub binary-release download that blocks Xcode builds.
let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
