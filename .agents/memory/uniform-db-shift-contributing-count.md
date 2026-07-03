---
name: Uniform dB shift doesn't change relative contributing-count
description: Why an environmental dB attenuation (e.g. indoor muffling) needs an absolute audibility floor, not just a relative "within N dB of loudest" filter.
---

When applying a uniform dB attenuation to every source in a "which sources contribute audibly" calculation (e.g. combining multiple sound sources and counting how many are "heard"), a relative test like "within 15 dB of the loudest source" does NOT change when every source is shifted down by the same amount — the shift cancels out in the comparison.

**Why:** Subtracting a constant `k` from every level in a list doesn't change the differences between them, so a threshold based purely on relative distance from the max is invariant to any uniform shift.

**How to apply:** When adding an environmental attenuation (indoor muffling, distance-independent damping, etc.) and the UI needs to show a *count* of contributing/audible sources, add a separate absolute floor (e.g. "must exceed 20 dBA") in addition to the relative "within N dB of loudest" test. Without the floor, applying the attenuation will correctly lower the total displayed level but will silently fail to reduce the contributing count.
