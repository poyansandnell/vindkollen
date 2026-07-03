---
name: Deployment type is not settable from code
description: Autoscale/vm/scheduled deployment target must be chosen by the user in the Deployments pane, not via artifact.toml or other code changes.
---

The deployment type (`autoscale`, `vm`, `static`, `scheduled`) for an artifact/project is a Deployments-pane setting, not something a task agent can change through `artifact.toml` or any other file.

**Why:** `autoscale` deployments scale to zero when idle, so any in-process `setInterval`/cron-style scheduler only runs while that instance happens to be warm — it is not a reliable substitute for a real cron job in production. Replit's `scheduled` deployment type exists specifically for that case, but switching to it requires the user's explicit action.

**How to apply:** When asked to "run X periodically" or "keep data fresh automatically" in a repo without an existing scheduler, still implement an in-process scheduler for the always-on/dev case (useful default, works immediately, no user action needed), but explicitly document in `replit.md`/commit message that if the relevant artifact is deployed as autoscale, the user should additionally set up a Scheduled Deployment (Deployments pane) pointing at the underlying CLI command for guaranteed periodic execution.
