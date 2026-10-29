### FEES-4 · Dashboard fee shows the most recently entered schedule, not the one in force · F6 · Severity: Medium

**What's wrong:** The admin/merchant fee display picks the `fee_schedules` row with the newest `created_at`. When an older period is backfilled later, the display shows the backfill's rate while every capture charges the rate in force.

**Why it happens:** `apps/api/src/fees/currentFeeScheduleDisplay.ts:32-37` ran `ORDER BY created_at DESC LIMIT 1` with no `effective_from` filter. The charging path, `fees/feeSchedule.ts:30-31`, resolves `WHERE effective_from <= $2 ORDER BY effective_from DESC, created_at DESC`. The faulty assumption, from the docblock, was that "most recently agreed" equals "current". MK's comment raised exactly this ("a backdated correction entered today would show as 'current'"). It was dismissed by "FH: asked Claude, it said created_at is right ... resolved" and "am: display only, nobody bills off this". The test `currentFeeScheduleDisplay.test.ts:72` ("returns the most recently entered schedule even when an older period was backfilled later") asserted 245 bps, encoding the bug.

**What it breaks:** Case file F6, with the test's own data. A 225 bps renegotiation took effect 2026-08-01. A 245 bps correction for March was backfilled on 2026-08-15. The dashboard shows 245 bps while captures charge 225 bps. On a 100,000 fils sale the merchant expects 2,450 fils fee but is charged 2,250 fils, so support cannot reconcile what is shown with what is charged.

**Why it needed a fix:** Merchants and support act on the displayed rate (disputes, pricing). The case file names this exact mismatch as an open finance item.

**Fix:** `apps/api/src/fees/currentFeeScheduleDisplay.ts:35-36` (plus the misleading docblock and comments)
```diff
-      WHERE merchant_id = $1
-      ORDER BY created_at DESC
+      WHERE merchant_id = $1 AND effective_from <= now()
+      ORDER BY effective_from DESC, created_at DESC
```
The 7-line docblock and 4 comment lines are replaced by 3 lines stating the in-force rule. Commit: this commit. Lines: prod +5/-13 (code +2/-2, comments +3/-11), test +6/-5.

**Why this is the smallest correct fix:** It changes two SQL lines so the display uses the charging path's resolution rule. The function signature and the `createdAt` field the page shows stay the same.
- Why not call `getEffectiveMdrBps` from `feeSchedule.ts`: it returns only bps, not `effectiveFrom`/`createdAt`, so the display shape would need changing.
- Why not change the data (delete the backfill): the backfill is legitimate history, and settlement needs it for March.

**Proof:** The corrected test `returns the schedule in force by effective_from even when an older period was backfilled later` failed before the fix with `expected: 225`, `actual: 245`. After the fix it passes (225, effectiveFrom 2026-08-01). fees: currentFeeScheduleDisplay + feeSchedule + platformVolumeTier: 12 pass, 0 fail.

**Regression risk:** A schedule with a future `effective_from` no longer shows as current. That is correct, since it is not yet charged. The only caller is `admin/merchants.ts:286` (display), and no admin test asserts this value.

**Trap note:** The test at `:72` that encoded the bug ("the backfilled row wins") is corrected to cite F6. The docblock and the MK/FH/am comment thread, which "resolved" it on an unverified claim, are replaced.
