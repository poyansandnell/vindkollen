---
name: Manual toggle accidentally coupled to a derived/preset mode
description: A manual on/off toggle (e.g. day/night) can silently be overridden by an unrelated preset (e.g. a "sun position" mode) if visual effects check both instead of only the manual state.
---

When a UI has both a manual override toggle (e.g. "Day Mode" / "Night Mode") and an
unrelated multi-value preset selector (e.g. a sun-position/visualization mode with an
"evening" option), watch for visual effects that check `manualToggle || presetMode === "x"`.
This makes the manual toggle *not* absolute — selecting Day Mode while the preset is still
on the overlapping value silently re-enables the effect the user just turned off.

**Why:** In the Vindkraft AR Katrineholm project, the night-mode dark overlay and blinking
aviation lights were gated on `nightMode || sunMode === "evening"`. Users could toggle
"Dagsläge" (Day Mode) and still see the dark filter because `sunMode` was independently set
to "evening". The fix was requiring the effect to depend solely on the manual toggle.

**How to apply:** When a user says a manual toggle "must completely disable X and stay
until changed," grep for every place that effect is computed and make sure the manual
state is the *sole* gate — remove any `||` conditions pulling in other preset/mode state
that could re-trigger the same visual effect.
