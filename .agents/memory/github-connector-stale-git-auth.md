---
name: GitHub connector fallback
description: How to keep source-of-truth updates moving when the workspace Git remote retains invalid GitHub credentials.
---

When the workspace's `origin` rejects pushes with an invalid or expired credential even after GitHub is reconnected, use the authorized Replit GitHub connector to update small release-source and Xcode-project files through GitHub's Contents API.

**Why:** the connector uses separately managed OAuth authorization, while the command-line remote can retain an unusable credential helper. Native web bundles are generated release outputs and can be rebuilt deterministically by the iOS preparation pipeline from the committed source.

**How to apply:** first attach the existing GitHub connection, then write the source/configuration change through the connector and verify the resulting `origin/main` commit. For a native release, run the native preparation command on macOS so it regenerates and syncs the bundle before Xcode Archive; do not depend on a manually pushed hashed bundle when the connector rejects oversized Git-tree payloads.