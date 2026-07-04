---
name: Trimming replit.md size without losing documented functionality
description: Pattern for shrinking a bloated project README/context file while keeping every documented behavior discoverable.
---

When `replit.md` (or any always-loaded project doc) grows large enough that it noticeably eats context/tokens, split it rather than deleting content:

- Move verbose per-file/per-hook/per-feature detail (exact thresholds, timing constants, prop contracts, edge-case rationale) into artifact-local reference docs, e.g. `artifacts/<name>/docs/file-map.md`, `docs/product-details.md`, `docs/gotchas.md`.
- Keep `replit.md` itself as a slim index: short overview bullets grouped by the same section headers, each pointing to the relevant doc file for full detail.
- Mirrors the same index+topic-file structure already used for `.agents/memory/`.

**Why:** the user's actual complaint is token/context cost of a file loaded every session, not that the underlying documentation is wrong or unwanted — deleting detail risks losing load-bearing implementation nuance (e.g. exact EMA time constants, disclaimer wording that must not be reworded) that a future agent needs.

**How to apply:** before finishing, verify losslessness by diffing bullet-level fingerprints (e.g. first ~60-80 chars of each `- ` line) between the old single file and the concatenation of the new index + reference docs — every old bullet should have a match. A ~80% size reduction on the hot-path file is achievable while keeping 100% of the content, just relocated.
