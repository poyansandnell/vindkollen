---
name: Local Android AAB prerequisites
description: Replit-specific requirements for building a Capacitor Android release bundle locally.
---

Build Android release bundles with Android API/build tools installed locally and Gradle running under JDK 21.

**Why:** The base shell may still expose Java 17 after JDK 21 is installed, while the Capacitor Android dependencies require a Java 21 toolchain. Gradle does not automatically provision it here, and the Android SDK is not preinstalled.

**How to apply:** Before a local `bundleRelease`, provide an Android SDK with the project's platform and build-tools versions, point Gradle to it through `android/local.properties` or the Android SDK environment variables, then set `JAVA_HOME` and `PATH` explicitly to JDK 21 for the Gradle invocation. Treat a locally built bundle without the Play upload keystore as inspection-only and rebuild it with the upload key before submission.

The production upload keystore remains on the owner's local Mac and must not be copied into Replit; Replit can verify the Android resources, while the final signed AAB is built locally.

**Why:** Keeping the production signing key off the workspace is an explicit release-security boundary.

**How to apply:** Do not request or upload the keystore for Replit-side icon verification. Sync the committed Android changes to the Mac, then run the existing signed release build there.