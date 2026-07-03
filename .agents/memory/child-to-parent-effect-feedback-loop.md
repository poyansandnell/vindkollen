---
name: Child-to-parent effect feedback loop via unmemoized array props
description: How an unmemoized `data ?? []` array prop combined with a child effect that reports results back up to parent state can cause an infinite render loop.
---

A child component's `useEffect` that calls a parent callback (e.g. `onResultsChange(newState)`) to lift computed state upward is safe on its own, but becomes an infinite loop if any of the child's own `useMemo`/`useEffect` dependencies are derived from a parent prop that isn't referentially stable — e.g. `const list = query.data ?? []` computed inline in the parent's render body (a fresh `[]` every render when `data` is still `undefined`).

**Why:** Parent re-renders (triggered by the lifted state update) recompute the unstable prop with a new array reference, which changes the child's memoized dependency, which re-runs the child's effect, which calls the parent callback again — around and back, indefinitely. This only surfaces once a new child effect adds a "report back to parent" edge; pre-existing code using the same unstable prop without that upward edge never revealed the underlying instability.

**How to apply:** Whenever adding a child-to-parent state-lifting effect (a `useEffect` in a child that calls a callback prop to update parent state), audit every prop that effect's dependencies transitively touch. Memoize `query.data ?? fallback` style values in the parent with `useMemo` (or a module-level stable empty-array constant for the fallback) before passing them down, rather than assuming "it rendered fine before" is proof of stability. Confirm the fix by watching for "Maximum update depth exceeded" in the browser console immediately on page load (before any user interaction) — if it fires without interaction, suspect a mount-time effect chain like this rather than a click handler.
