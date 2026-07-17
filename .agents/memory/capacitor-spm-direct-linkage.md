---
name: Capacitor SPM direct target linkage
description: Why "No such module 'Capacitor'" persists after Package.resolved is present, and what project.pbxproj entries are required.
---

## The rule

`import Capacitor` in `AppDelegate.swift` (App target) requires the Capacitor module to be **directly** linked to the App target in `project.pbxproj`. Pinning versions in `Package.resolved` is not sufficient — Swift does not propagate module visibility transitively from a local wrapper package.

**Why:** Swift Package Manager only exposes modules from packages that are explicitly listed in a target's `packageProductDependencies` and `PBXFrameworksBuildPhase`. A transitive dependency (e.g. `CapApp-SPM → Capacitor`) is NOT importable from the parent target.

## What must be in project.pbxproj

For a Capacitor 8.x SPM-based project, the App target needs ALL of the following:

### 1. XCRemoteSwiftPackageReference (project-level)
```
XCRemoteSwiftPackageReference "capacitor-swift-pm" = {
    isa = XCRemoteSwiftPackageReference;
    repositoryURL = "https://github.com/ionic-team/capacitor-swift-pm.git";
    requirement = { kind = exactVersion; version = "8.4.2"; };
};
```
This goes in `PBXProject.packageReferences`.

### 2. XCSwiftPackageProductDependency (one each for Capacitor, Cordova)
```
/* Capacitor */ = { isa = XCSwiftPackageProductDependency; package = <remote-ref-uuid>; productName = Capacitor; };
/* Cordova */   = { isa = XCSwiftPackageProductDependency; package = <remote-ref-uuid>; productName = Cordova; };
```

### 3. PBXBuildFile entries
```
/* Capacitor in Frameworks */ = { isa = PBXBuildFile; productRef = <capacitor-dep-uuid>; };
/* Cordova in Frameworks */   = { isa = PBXBuildFile; productRef = <cordova-dep-uuid>; };
```

### 4. PBXFrameworksBuildPhase files list
```
<capacitor-build-file-uuid> /* Capacitor in Frameworks */,
<cordova-build-file-uuid>   /* Cordova in Frameworks */,
```

### 5. PBXNativeTarget.packageProductDependencies
```
<capacitor-dep-uuid> /* Capacitor */,
<cordova-dep-uuid>   /* Cordova */,
```

## What Package.resolved does (and doesn't do)

- **Does:** locks remote package versions (git revision + semver tag) so Xcode fetches the same bits on every machine.
- **Doesn't do:** create any link between a package product and a build target. That linkage lives entirely in `project.pbxproj`.

## Does cap sync ios overwrite the fix?

No. `cap sync ios` only modifies:
- `ios/App/CapApp-SPM/Package.swift` (plugin list)
- `ios/App/App/public/` (web assets)
- `ios/App/App/capacitor.config.json`

It does NOT touch `project.pbxproj`. The fix is stable across syncs.

## CapApp-SPM local package and pnpm paths

`CapApp-SPM/Package.swift` uses pnpm virtual store paths like:
```
path: "../../../../../node_modules/.pnpm/@capacitor+camera@8.2.1_@capacitor+core@8.4.2/..."
```
These paths are deterministic for a given `pnpm-lock.yaml`. They resolve correctly on any machine after `pnpm install`. No symlinks needed.

## How to apply

Whenever a Capacitor iOS project is created from scratch or the ios/ directory is regenerated, verify that `project.pbxproj` contains all five items above. Use `pnpm native:ios:verify` (runs `scripts/ios-verify.sh`) which checks 17 conditions and exits non-zero on failure.
