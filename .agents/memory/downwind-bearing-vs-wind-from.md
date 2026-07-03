---
name: Downwind bearing vs meteorological wind-from direction
description: How to correctly test whether a noise/pollution source is "downwind" of a listener using meteorological wind-direction data.
---

When combining GPS bearing-to-source with weather-API wind direction to decide
whether a listener is downwind of a source (sound, smell, emissions, etc.),
it is easy to get the sign backwards.

Meteorological wind direction is reported as the direction the wind blows
**FROM** (e.g. "270°" = wind blows from the west, travelling east).

The listener is downwind of the source — i.e. the wind carries the source's
noise/emissions toward the listener — when:

```
wind_from_degrees ≈ bearing_from_listener_to_source
```

Not the reverse, and not `wind_from_degrees ≈ bearing_from_source_to_listener`.

**Why:** If the source is due west of the listener (bearing from listener to
source = 270°) and the wind is blowing from the west (wind_from = 270°), the
wind is physically travelling east — carrying the source's sound straight at
the listener. Working through the "wind travels toward `wind_from + 180`"
identity twice (once for the source→listener geometry, once for the wind's
travel direction) cancels the extra 180° flip, leaving the two angles equal
rather than opposite. It's counterintuitive on first pass and easy to get
backwards without deriving it explicitly.

**How to apply:** When building any "is X downwind of me" feature from a
weather API bearing + a GPS bearing, use `normalizeAngle(wind_from_degrees -
bearing_listener_to_source)` and check if the absolute difference is small
(e.g. <45°) — don't add 180° anywhere.
