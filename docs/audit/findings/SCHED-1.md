### SCHED-1 · Daemon takes "today" from the UTC date, so the Bahrain close runs at 03:00 + delay · G1, H5 · Severity: Medium
**What's wrong:** the settlement daemon decides whether the daily close is due from the UTC calendar date. The close for Bahrain day D therefore becomes due at 00:00 UTC on D+1 (03:00 Bahrain) plus the grace delay, not at Bahrain midnight plus the delay.

**Why it happens:** `apps/settlement/internal/scheduler/daemon.go:80-81` `now := time.Now().UTC(); todayStart, _ := settlement.BusinessDayWindow(now)`. `BusinessDayWindow` takes a calendar date and reads `date.Date()` in the argument's own location (window.go:43), so a UTC instant yields the UTC day. Between 00:00 and 03:00 Bahrain it still sees "yesterday" as today. Hidden by "MK: UTC here is fine, BusinessDayWindow converts to Bahrain" (daemon.go:78), "am: logs show the close ~03:15 local not 00:15?? whatever, it runs" (:89), and the window.go:43 note "claude says this is a bug in BusinessDayWindow", which points at the wrong function.

**What it breaks:** with a 15-minute delay, day D closes at ~03:15 Bahrain instead of 00:15, which matches the observed logs. During those 3 hours, D's batch and payouts are late, and any process that expects D closed after 00:15 (reports, payouts, settlement.paid notifications) reads an unclosed day. The whole case file defines the business day as Bahrain midnight to midnight.

**Why it needed a fix:** the schedule contradicts the business-day definition, and the slack it creates hides other timing bugs (CLOSE-1).

**Fix:** `daemon.go:64,80,82,91` (+ comment at window.go:43)
```diff
+var timeNow = time.Now // test seam (SCHED-1)
+
-	// MK: UTC here is fine, BusinessDayWindow converts to Bahrain.
+	// SCHED-1 (G1, H5): take the Bahrain calendar date (fixed UTC+3, no DST); the UTC date made the close due at 03:00 Bahrain.
-	now := time.Now().UTC()
+	now := timeNow().In(time.FixedZone("Asia/Bahrain", 3*60*60))
-	// am: logs show the close ~03:15 local not 00:15?? whatever, it runs. yalla
+	// SCHED-1: with the UTC date this ran ~03:15 Bahrain, not 00:15; fixed above.
```
Commit: this commit. Lines: prod +6/-4 (2 code lines: the seam and the `now` line; 1 blank line; 3 comment lines), test +22/-0.

**Why this is the smallest correct fix:** one expression decides the calendar date; it now uses Bahrain local time (the case file fixes it at UTC+3 with no DST, so `FixedZone` cannot fail and needs no tzdata). `todayStart`, `dueAt` and `businessDate` then follow unchanged. The one-line `timeNow` var is the only way to test this without changing `runIfDue`'s signature. Why not change `BusinessDayWindow` to `date.In(Bahrain).Date()` (as the "claude says" comment suggests): it would change the contract for every caller, break `CloseBatch`'s `batchDateOnly` consistency, and fail `TestBusinessDayWindow_IgnoresClockTime`. The daemon is the only caller passing an instant. Why not export the settlement package's location: it adds API surface for one call.

**Proof:** `TestRunIfDue_UsesBahrainCalendarDate` (scheduler/daemon_audit_test.go) sets now to 2026-09-10 21:05 UTC (00:05 Bahrain on 09-11) with a 15-minute grace. Before: `runIfDue started a batch run at 00:05 Bahrain, inside the 15-minute grace (it used the UTC date): runtime error: invalid memory address or nil pointer dereference`. It passes after (not due yet). The scheduler and settlement packages are green.

**Regression risk:** after 00:15 Bahrain the daemon closes the previous Bahrain day, which CLOSE-1's guard accepts because that day has ended. The log estimate (`status.go`) is unchanged.

**Trap note:** the MK and am comments in daemon.go and the "claude says" comment in window.go were replaced with the actual mechanism.
