---
name: SVG debug overlay markers missing from Playwright accessibility snapshot
description: A testing subagent reported numbered SVG <circle>/<text> debug markers as "not rendered" based on the ARIA snapshot, when they were actually visible in the screenshot.
---

A `runTest()` Playwright-based test can report that small decorative SVG
elements (numbered vertex dots, debug overlay labels, etc.) are "missing"
purely because the accessibility-tree snapshot omits them — not because they
failed to render.

**Why:** Plain `<circle>`/`<text>` nodes inside an `<svg>` with no explicit
role/label are often excluded or flattened out of the computed accessibility
tree, especially inside a `pointer-events-none` overlay layer. The a11y
snapshot is not a reliable proxy for "is this visually present" when the
content is non-interactive SVG graphics.

**How to apply:** If a test claims a purely visual/decorative overlay (debug
markers, chart annotations, map pins drawn as raw SVG) is absent, re-verify
with an instruction that explicitly asks the agent to describe the screenshot
pixels rather than rely on the accessibility snapshot, or take a direct
screenshot yourself. Don't treat the a11y-tree-based "missing" report as
confirmed until visually re-checked.
