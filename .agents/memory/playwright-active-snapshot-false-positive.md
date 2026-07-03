---
name: Playwright accessibility snapshot false "[active]" state
description: An e2e testing subagent flagged a toggle button as "not changing state" based on an ARIA snapshot showing [active] after a click, when the button actually toggled correctly.
---

When a `runTest()` Playwright-based test reports that a toggle/button's state
"did not update" citing an accessibility snapshot annotation like `[active]`,
treat it as a possible false positive before assuming a real bug.

**Why:** `[active]` in an ARIA/accessibility snapshot can reflect the CSS
`:active` pseudo-class captured transiently during a mouse-down/click action,
not the app's actual toggled boolean state. It is unrelated to `aria-pressed`
or the component's real variant/class.

**How to apply:** Re-verify with a narrower, lower-ambiguity test that reads
a concrete DOM property before and after the click — e.g. diff the button's
`class` attribute (variant classes like `bg-primary` vs `border bg-background`
for shadcn/ui `Button`) rather than relying on the accessibility tree's
`[active]`/`[pressed]` annotations. If the class attribute changes as
expected, the original failure was a snapshot artifact, not an app bug.
