### HOLD-1 · Nightly hold janitor deletes every hold on a night with nothing expired · (no case ref; data integrity) · Severity: High
**What's wrong:** `scripts/expire_holds.ts` deletes expired holds instead of marking them `expired`. On a night with nothing expired it runs a bare `DELETE FROM holds` and wipes the whole table.

**Why it happens:** `main` runs `buildExpiredHoldsDelete(fetchExpiredHoldIds())` (`scripts/expire_holds.ts:43-45`). That called `buildDelete("holds", { id: [] })`, and `buildWhere` skips empty arrays (`scripts/lib/sqlFilter.ts:9-10`), so the WHERE clause is empty (`:20`) and the statement is `DELETE FROM holds` (`:29`). Even with ids it deletes rows the schema expects to be kept as `'expired'` (`db/migrations/0005_holds.sql:7`). It also never re-checks `status = 'active'`, so a hold captured between the SELECT and the DELETE is deleted too.

**What it breaks:** On the most common night (nothing expired) every hold is destroyed: active 7-day CNP holds for in-flight authorizations plus all released and expired history. `capture.ts`/`void.ts` then `UPDATE holds ... WHERE status = 'active'` and silently match 0 rows, so nothing errors. Worked example from the test: holds of 1,000 (released), 2,000 (active) and 3,000 fils (active, expired) all vanish (`actual: []`).

**Why it needed a fix:** It irrecoverably destroys the authorization hold record every quiet night, contradicting the rule Yousif wrote in the handover ("Holds are never deleted").

**Fix:** `scripts/expire_holds.ts`
```diff
-import { buildDelete } from "./lib/sqlFilter.js";
-  return buildDelete("holds", { id: expiredIds });
+  return { text: "UPDATE holds SET status = 'expired' WHERE status = 'active' AND id = ANY($1::uuid[])", values: [expiredIds] };
```
plus 3 comment/log lines that described deletion (`:29` doc comment, `:42` the FH/"claude: negligible window" note, `:47` log text). Lines: prod +4/−5, test +2/−2 changed + 50 new.

**Why this is the smallest correct fix:** one statement at the single point that builds it. `= ANY('{}')` matches nothing, so an empty night changes no rows; `UPDATE ... 'expired'` keeps history; the `status = 'active'` re-check closes the SELECT/DELETE race. Why not guard `buildDelete` against an empty WHERE? That stops the wipe but still deletes history and keeps the race. Why not one `UPDATE ... WHERE expires_at < now()` in `main`? Equally correct, but it moves logic out of the tested builder and leaves `fetchExpiredHoldIds` unused. The function name keeps "Delete" because renames are out of scope.

**Proof:** `scripts/expire_holds.audit.test.ts` "an empty night changes no rows, and expiry marks holds expired instead of deleting them" fails before (`+ actual [] - expected [[1000,'released'],[2000,'active'],[3000,'expired']]`) and passes after (run inside a rolled-back transaction). `expire_holds.test.ts` assertions that pinned the DELETE text are corrected: 3/3 pass.

**Regression risk:** `buildDelete` in `scripts/lib/sqlFilter.ts` is now unused; it still produces an unbounded DELETE for empty arrays if anyone calls it again. Holds deleted by past runs cannot be restored from this repo.

**Trap note:** `expire_holds.ts:28-31` "a night with nothing expired changes no rows" (false before; true now). `:42` "claude: 'negligible window, fine.'" (corrected). `0005_holds.sql:12-15` (MK, FP-219) "expire_holds.ts now deletes expired rows" is an applied migration, so it is left as is and recorded here. `authorize.ts:113-114` "only flips status to expired, it never deletes" was false and is now true. `expire_holds.test.ts` pinned the DELETE text and never tested `[]`.
