### CLOSE-1 · run-batch closes and pays a business day that has not ended · H5 · Severity: High
**What's wrong:** `CloseBatch` (and so `RunDailyBatch`, the `run-batch` CLI, `POST /internal/run-batch` and the daemon) accepted today's or a future date. It closed and paid the batch with the volume captured so far, and every later capture of that day was stranded.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:60-62`: CloseBatch computed `[start, end)` from `BusinessDayWindow` but never compared `end` with the current time. A batch that is closed or paid is skipped on the next run (`ON CONFLICT ... DO NOTHING` plus status checks), so captures after the early close never get a `settlement_batch_id`. ADMIN.md:73-75 ("re-running is always safe"), RUNBOOK:44-45 and ARCHITECTURE:51-52 told operators it was safe.

**What it breaks:** admin re-run of 2026-09-01 at 08:26 Bahrain (seen in the audit log): every merchant's 09-01 batch is paid on 00:00-08:26 volume only. For Alpha Retail (~3,932 BD/day) about 2,550 BD (2,550,000 fils) stays on merchant_payable, never batched or paid, and nothing reports it.

**Why it needed a fix:** a single early click (or an early daemon tick, see SCHED-1) permanently strands a day's later captures, and merchants are underpaid with no alert.

**Fix:** `batch.go:62-64`
```diff
 	start, end := BusinessDayWindow(businessDate)
+	if time.Now().Before(end) { // CLOSE-1 (H5): never close a Bahrain business day that has not ended
+		return BatchResult{}, fmt.Errorf("settlement: CloseBatch: business day %s has not ended (Asia/Bahrain)", businessDate.Format("2006-01-02"))
+	}
```
Commit: this commit. Lines: prod +3/-0, test +25/-0.

**Why this is the smallest correct fix:** CloseBatch is the single function every entry point funnels through, and it already has the Bahrain window end in hand. The check happens before any write, so nothing is created for an unfinished day. Why not guard only RunDailyBatch (dossier option): direct CloseBatch callers would stay open. Why not validate in server.go/main.go: there are three entry points to patch instead of one. The HTTP layer returns its existing 500 `run_batch_failed`; mapping it to 409 is a nice-to-have in the TS/admin layer.

**Proof:** `TestRunDailyBatch_RefusesUnfinishedBusinessDay` (close_window_audit_test.go) failed before: `RunDailyBatch for today's (unfinished) Bahrain business day succeeded, want an error` and `1 batch(es) closed/paid for an unfinished business day, want 0`. It passes after. The settlement, internalapi and scheduler packages are green; every existing test closes past dates.

**Regression risk:** any caller passing the current Bahrain date now gets an error. The daemon passes the previous Bahrain day once SCHED-1 is fixed; before SCHED-1, its UTC-based "yesterday" is always a day that has ended in Bahrain too, because UTC lags Bahrain. Repair for past early closes: settle captures with `settlement_batch_id IS NULL` whose day's batch is closed or paid, via an adjustment batch (ops-approved).

**Trap note:** ADMIN.md, RUNBOOK and ARCHITECTURE "re-runs are always safe" are docs outside apps/settlement and are not edited here; the coordinator should correct them (see report).
