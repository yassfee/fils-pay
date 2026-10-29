### ADMIN-TEST-1 · "Recompute statuses" silently takes sandbox merchants live · G3, H7 · Severity: High
**What's wrong:** The finance backfill `POST /v1/admin/merchants/:id/transactions/recompute-statuses` sets `merchants.test_mode = false` as a side effect, so a sandbox merchant's fake captures enter the next real settlement run and are paid out.

**Why it happens:** After recomputing statuses, the route calls `reconcileSandboxFlag` (`apps/api/src/routes/adminMerchantsRecompute.ts:28` → `apps/api/src/admin/merchantFlags.ts:10-16`), which clears `test_mode` when `openAuthorizations === 0`. That counter can never be non-zero: `transactionStatusRecompute.ts:29` selects `status NOT IN ('authorized','voided')` and `:47` then counts rows whose status is `'authorized'` inside that set. Any sandbox merchant with one captured transaction is therefore switched live. Settlement's only sandbox guard is `test_mode = false` (`apps/settlement/internal/settlement/batch.go:408`), so the flip alone is enough to settle it. The response shows `flagsUpdated: ["test_mode"]`, but the console only displays scanned/updated.

**What it breaks:** Worked example (seed: Gamma Hospitality, test_mode, 320 bps): one sandbox day of 1,250,000 fils closes with a 40,000-fil fee and a **real payout of 1,210,000 fils (1,210.000 BD)** for money that was never collected. This is G3 ("test merchants keep showing up in the real settlement run") and H7 ("what happens to test merchants when certain admin tools run?").

**Why it needed a fix:** Real money leaves the platform for sandbox traffic, and the operator gets no visible signal.

**Fix:** `apps/api/src/routes/adminMerchantsRecompute.ts`
```diff
-import { reconcileSandboxFlag } from "../admin/merchantFlags.js";
-        const flagsUpdated = await reconcileSandboxFlag(client, request.params.id, recompute);
+        const flagsUpdated: string[] = []; // G3/H7: a status backfill must never take a sandbox merchant live
```
The response and audit-log shapes are unchanged (`flagsUpdated` is now always `[]`). Lines: prod +1/−2, test +72/−0.

**Why this is the smallest correct fix:** going live is a business decision, not a by-product of a status backfill, so the call is removed at its one call site. Why not fix the counter (count authorized rows correctly)? A merchant with no open authorizations would still be switched live by a backfill, which is the same bug under a narrower condition. Why not delete `merchantFlags.ts`? It adds 21 deleted lines for no behaviour change; it is now unreferenced.

**Proof:** `adminMerchantsRecompute.audit.test.ts` "recompute-statuses leaves a sandbox merchant in test_mode" fails before (`+ actual ['test_mode'] - expected []`) and passes after. `routes/admin.test.ts` still passes (42/42 together).

**Regression risk:** none for live merchants (the function only ever set the flag to false). Merchants already flipped by past runs must be found and reset by finance (for example Gamma Hospitality after the 2026-09-19 recompute, advisor §9 Q4).

**Trap note:** `merchantFlags.ts:3` "Clears the sandbox flag when a merchant has no open authorizations" describes a condition that can never be false. `docs/ADMIN.md:41-43` "Safe to run more than once" and `apps/admin/src/api/merchants.ts:58` (YA) "idempotent and safe to rerun" are false comfort. No test covered the route.
