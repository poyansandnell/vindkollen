---
name: Tap-to-menu vs drag-to-move gesture conflict on pannable maps
description: Why drag-to-move on individual map markers conflicts with pan/pinch/zoom map gestures, and the fix pattern that separates them cleanly.
---

On a pannable/zoomable custom map (SVG or canvas, not a mapping SDK), drag-to-move for individual markers competes with drag-to-pan for the background: both start from a pointerdown+move sequence, so a gesture on or near a marker either triggers ambiguous behavior or requires fragile hit-testing/threshold heuristics to disambiguate — and quick single-taps for "add new item" also collide with the start of a double-tap-to-zoom gesture.

**Fix pattern:** Replace drag-to-move with an explicit two-step flow: tap a marker → contextual menu (e.g. Move/Remove/Info/Cancel) → "Move" enters an explicit move-mode with a visible banner → the *next* background tap commits the new position. This means:
- Background drag is unambiguously pan (never contested by a marker-drag start).
- Background pinch/wheel/double-tap is unambiguously zoom.
- Plain single-tap on empty space still adds a new item, but must be debounced by a short window so a genuine double-tap-to-zoom can supersede it before the "add" fires.
- A brief fading old→new marker/arrow after committing a move gives feedback without needing a live drag-preview.

**Why:** Removes all ambiguity between object-manipulation gestures and map-navigation gestures, and reads as familiar "Google Maps"-style behavior to users (tap pin for options, rather than drag pins around).

**How to apply:** Any custom (non-SDK) interactive map or canvas where individual objects must be repositionable AND the canvas itself must remain pannable/zoomable via the same gesture vocabulary (drag, pinch, double-tap).
