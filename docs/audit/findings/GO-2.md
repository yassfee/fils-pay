### GO-2 · A capture that is still committing when its day is closed by hand is never settled · H5, G1 (close timing), related to CLOSE-1 · Severity: Low (reported, not changed)

**What's wrong:** a capture carries the business day of its start time. If the capture's database transaction starts before Bahrain midnight but commits after someone has already closed that day, its capture event is left out of that day's batch. No later batch ever picks it up, so the merchant is never paid for it.

**Why it happens:** two things combine.
1. Capture writes its `transaction_events` row with `occurred_at DEFAULT now()`, which is the start time of the DB transaction. The transaction stays open across the acquirer call (`apps/api/src/payments/capture.ts:95` `withTransaction`, then `:182` `acquirer.capture`), so the event can commit seconds after the instant it is dated.
2. `CloseBatch` selects only `te.occurred_at >= start AND < end` of the requested day (`apps/settlement/internal/settlement/batch.go:150`). CLOSE-1's guard only requires `time.Now() >= end` (`:63`). Once day D is `closed`, a re-close of D is a no-op (`:98`), and day D+1's window starts at its own midnight. An event dated D that commits after D's close is outside every window that is still open. Refunds do not have this problem: their claim has no lower bound (`:215`, `occurred_at < end`).

**What it breaks:** a 10,000-fils capture starts at 23:59:59 on 27 March. An operator presses "Run batch" for 27 March at 00:00:00.5 on 28 March, before the capture commits. The 9,750 fils net (at 250 bps) is never batched or paid. The BAL-2 rebuild correctly leaves unbatched captures out of the cache, so the money shows up only as a permanent "pending unbatched" line in reconciliation (REC-1). The daemon is not exposed: it waits `SETTLEMENT_DAEMON_RUN_DELAY_MINUTES` (default 15, `internal/config/config.go`) after midnight. Only a manual close (CLI `run-batch`, or the admin console's Run batch via `POST /internal/run-batch`) in the first seconds after midnight can strand a capture.

**Why it needed a fix:** every captured fil must reach a payout (FP-300 ☐2/☐3), and the case file has settlement close the whole Bahrain day. Proved mechanism, but a narrow trigger, so it is reported and not counted.

**Fix:** not changed. Every narrow fix is a policy choice:
- *Grace period in the CLOSE-1 guard:* `time.Now().Before(end.Add(grace))`, with `grace` at least the longest capture transaction (acquirer timeout plus margin). This is one line, but someone has to choose the grace, and it delays every manual close by that amount.
- *Drop the window floor* so the next close sweeps stragglers, as refunds already do. That changes backfill semantics: a backfill of an old day would swallow every earlier unbatched day.
- *Date the capture event at commit.* That is a checkout-path change, which is out of scope for this lane.

We would take the grace period, with a value finance and ops agree on.

**Why this is the smallest correct fix:** the grace-period line keeps per-day batches and backfills exactly as they are, and it only refuses a close that is too early. The other two options either move the problem or change semantics.

**Proof:** a throwaway Go test (not committed) did the following on the w3g test DB: close 27 March for a fresh merchant, insert a capture event dated 23:59:59 that day (the late commit), close 28 March, then re-run 27 March. The re-run returns `AlreadyClosed`, and the log line reads `unbatched capture events after closing D, D+1 and re-running D: 1`.

**Regression risk:** none, because there is no code change.

Lines: prod +0/-0, test +0/-0
