---
name: Postgres ORDER BY DESC and NULLs
description: Postgres sorts NULL first by default on DESC ordering, which silently breaks "highest value wins" tiebreaker queries (e.g. ranking by population, score, count) when many rows have NULL in that column.
---

`ORDER BY column DESC` in Postgres places `NULL` values *first*, not last. This is the opposite of what most people expect ("DESC = biggest first").

**Why:** In a locality search ranked by relevance then by `population DESC` as a tiebreaker, three exact-name-match rows tied at the top relevance tier — but the two rows with `population = NULL` sorted ahead of the one real town with `population = 23283`, because Postgres treated NULL as the "largest" value under DESC. This silently produced wrong-looking search results with no error.

**How to apply:**
- Whenever using a nullable column as a DESC tiebreaker/ranking key, add `NULLS LAST` explicitly: `ORDER BY col DESC NULLS LAST` (or coalesce to a low sentinel value first).
- This applies to any raw `sql` order-by fragment in Drizzle/ORMs too — the ORM's `desc()` helper does not add `NULLS LAST` automatically.
- Test ranked/tiebreak queries against real data (not just synthetic non-null data) to catch this class of bug.
