### CLOSE-1 · run-batch accepts a business day that has not ended, and a closed day is never revisited, so that day's later captures would never be paid · Severity: Medium
**Category:** Bug

**What's wrong:** `CloseBatch` (and so `RunDailyBatch`, the `run-batch` CLI, `POST /internal/run-batch`, the admin "Run batch" route and the daemon) accepted today's or a future date. It would close the batch with the volume captured so far. The money property that makes this a bug: once a day's batch is `closed` or `paid`, every later run for that day is a no-op, so any capture made later the same Bahrain day would never get a `settlement_batch_id` and would never be paid out.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:62` (before): CloseBatch computed `[start, end)` from `BusinessDayWindow` but never compared `end` with the current time. A batch that is already closed or paid is returned unchanged (`batch.go:97-111`, "Step 4: already closed/paid -> idempotent no-op"), so the day is never revisited. ADMIN.md:73-75 ("re-running is always safe"), RUNBOOK:44-45 and ARCHITECTURE:51-52 told operators it was safe. The admin route only checks the date's format (`routes/admin.ts:118`), not that the day has ended.

**What the evidence shows (and does not):** the admin audit export has a run-batch for `"date":"2026-09-01"` at `2026-09-01T08:26:38+03:00` (`docs/exports/admin-audit-2026-09.csv:2`), i.e. an operator did request a Bahrain day that had not ended. That run closed nothing: its metadata is `"merchants":4,"alreadyClosed":4` (every merchant's batch was already closed or paid, so each call was the no-op above), and the 09-01 batches in `docs/exports/settlement-batches-2026-09-01_20.csv` carry a full day's gross (Alpha Retail 3,932,332 fils) and were paid at 2026-09-02 03:07. So the exports show no money stranded by an early close. The H5/G1 symptom (the close runs at 03:00 local, not midnight) is a different root cause, the daemon's UTC date, fixed as SCHED-1.

**What it breaks:** had a day been closed early, for example by an operator running today's date before midnight, every capture after the close would stay on `merchant_payable`, never batched or paid, and nothing would report it. For a merchant at Alpha Retail's ~3,932 BD/day, a close at 08:26 would strand roughly 2,550 BD (illustrative: the remaining 15.5 hours of an even day).

**Why it needed a fix:** a single early run would permanently strand that day's later captures, and merchants would be underpaid with no alert. The guard makes the property hold at the one place every entry point passes through.

**Fix:** `batch.go:62-64`
```diff
 	start, end := BusinessDayWindow(businessDate)
+	if time.Now().Before(end) { // CLOSE-1 (H5): never close a Bahrain business day that has not ended
+		return BatchResult{}, fmt.Errorf("settlement: CloseBatch: business day %s has not ended (Asia/Bahrain)", businessDate.Format("2006-01-02"))
+	}
```
Commit `56cdd1f`. Lines: prod +3/-0, test +25/-0.

**Why this is the smallest correct fix:** CloseBatch is the single function every entry point funnels through, and it already has the Bahrain window end in hand. The check happens before any write, so nothing is created for an unfinished day. Why not guard only RunDailyBatch (dossier option): direct CloseBatch callers would stay open. Why not validate in server.go/main.go: there are three entry points to patch instead of one. Why not let a closed day be re-opened for late captures: that changes the batch/payout contract (a paid batch would need an adjustment batch), far beyond a guard. The HTTP layer returns its existing 500 `run_batch_failed`; mapping it to 409 is a nice-to-have in the TS/admin layer.

**Proof:**
- The guard: `TestRunDailyBatch_RefusesUnfinishedBusinessDay` (`apps/settlement/internal/settlement/close_window_audit_test.go`) failed before: `RunDailyBatch for today's (unfinished) Bahrain business day succeeded, want an error` and `1 batch(es) closed/paid for an unfinished business day, want 0`. It passes after.
- "A closed day is never revisited": the existing `TestCloseBatch_IdempotentReClose` (`batch_test.go:197`) pins that a second CloseBatch on a closed day returns `AlreadyClosed` with the same figures and batches no new events.
- Not proven by a test: no test inserts a capture after an early close and shows it left unbatched; that end-to-end consequence follows from the two tests above and from `batch.go:97-111`.
- The settlement, internalapi and scheduler packages are green; every existing test closes past dates.

**Regression risk:** any caller passing the current Bahrain date now gets an error. The daemon passes the previous Bahrain day once SCHED-1 is fixed; before SCHED-1, its UTC-based "yesterday" is always a day that has ended in Bahrain too, because UTC lags Bahrain. Repair for any past early close: settle captures with `settlement_batch_id IS NULL` whose day's batch is closed or paid, via an adjustment batch (ops-approved).

**Trap note:** ADMIN.md, RUNBOOK and ARCHITECTURE "re-runs are always safe" are docs outside apps/settlement and are not edited here; the coordinator should correct them (see report).
