---
name: Full-bleed overlay div blocks sibling pointer events
description: An absolutely-positioned inset-0 wrapper painted on top of an interactive SVG/canvas silently eats all pointer events unless the wrapper itself (not just its children) is pointer-events-none.
---

When a UI layers a text/label overlay on top of an interactive SVG or canvas (e.g. map labels drawn above draggable markers), it's common to mark each individual label `pointer-events-none` but forget the *wrapper* div around them. An absolutely-positioned `inset-0` wrapper defaults to `pointer-events: auto`, so even though none of its children intercept events, the wrapper's own full-size hit box does — it silently swallows every pointerdown/mousedown across the entire overlaid area, and the interactive elements underneath (SVG circles, canvas hit-testing, etc.) never receive the event at all.

**Why:** this produces a total, unconditional failure ("nothing is draggable/clickable anywhere in this region") with no console error and no exception — the event handlers on the underlying interactive elements are correctly wired but are just never invoked, which makes it look like a logic bug in the drag/click handler itself rather than a z-order/pointer-events problem.

**How to apply:** whenever a later-painted, absolutely-positioned full-size wrapper div sits over an interactive layer (maps, drag-and-drop canvases/SVGs, custom sliders), check that the wrapper itself carries `pointer-events-none`, not just its leaf children. If only "some" of a region works, suspect a smaller/positioned overlay instead; if drag/click is broken for every element in an entire area, suspect exactly this whole-wrapper pointer-events gap first, before debugging the interaction handlers.
