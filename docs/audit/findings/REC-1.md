### REC-1 · Reconciliation can never tie out: payout legs counted inside the window, pending fees are float re-estimates, refunds missing · H1 / FP-300 · Severity: High

**What's wrong:** `GET /v1/settlement/reconciliation` computes `gapFils = merchant_payable ledger net − settlement net payout − pending`. (1) The ledger term includes the payout debits (`settlement payout: …`) that PayoutBatch posts at `now()`, right after CloseBatch, which neither other term accounts for. (2) Pending re-estimates each unbatched capture's fee with floats at today's `merchants.mdr_bps` instead of using the fee capture actually journaled. (3) Unbatched refunds are missing from pending, and nothing lists refund reservations that never completed.

**Why it happens:** `apps/api/src/settlement/query.ts:290-293` (before) had no description filter; `batch.go:360` and `splits/allocate.go:137` post `merchant_payable` debits at `now()`. `query.ts:327` called `estimateFeeFils` (`fees/estimate.ts:7-10`: `mdrBps / 10_000`, `Math.round` half-up), while capture uses `applyRateFils` (half-to-even) on the effective MDR minus the tier bonus (`capture.ts:196`). The pending query selected capture events only.

**What it breaks:** 250 bps merchant, 10,000 captured, 4,000 refunded (f = 100), batch closed and paid the same day: ledger = 9,750 − 3,900 − 5,850 = 0, settlement = 5,850, gap = −5,850. One unbatched 4,740 capture: ledger fee 118, estimate 119, gap +1. One unbatched 2,000 refund (f = 50): gap −1,950. Finance's tie-out cannot pass, and FP-300 box 5 (reconciliation) is impossible.

**Why it needed a fix:** Case file FP-300 box 5 (reconciliation shows refunds) and H1 (money to the fil); the design (§7) makes REC-1 a prerequisite because otherwise the gap can never be 0.

**Fix:** `apps/api/src/settlement/query.ts:248-345`
- Ledger: `AND COALESCE(description, '') NOT LIKE 'settlement payout:%'` (batch and split payouts settle batches; they are not activity to reconcile against them).
- Pending captures: `SUM(te.amount_fils - COALESCE((te.metadata->>'feeFils')::bigint, 0))`, the fee capture journaled, in integers. The `estimateFeeFils` call, the `merchants` query, the misleading "0046 trigger" note and the import are removed.
- FP-300 refunds as their own lines: `pendingUnbatchedRefundsFils = −Σ(amount_fils − fee_reversed_fils)` for succeeded refunds with `settlement_batch_id IS NULL` in the window (enters the gap); `nettedRefundsFils = −Σ(refund_gross_fils − refund_fee_reversed_fils)` of the window's batches (informational, already inside `net_payout_fils` from Go CloseBatch); `reservedNotCompleted` lists the merchant's transactions where `refunded_fils ≠ Σ succeeded refunds` (design §4.5). It is a current-state list, not windowed and not added to the gap: a reservation moves no ledger money.
- The doc comments that claimed refunds were already included and that pending used "the same rate the capture path used" are corrected.

Lines: prod +29/-28, test +130/-0.

**Why this is the smallest correct fix:** Each defect is fixed in the one query that produces it, and the new lines reuse the same `Promise.all`. *Why not exclude payouts by time (shift the window)?* The payout can land in any later window, and timing is not what makes a leg a payout. *Why not fix `estimateFeeFils`?* It would still guess today's rate; the journaled fee is the fact. *Why not recompute refund fees?* `refunds.fee_reversed_fils` is what the ledger and Go both use.

**Proof:** `apps/api/src/routes/settlement.refunds.audit.test.ts`, red before and green after:
- `REC-1/FP-300: an unbatched capture (integer fee, 4,740 at 250 bps) and an unbatched refund tie out to 0` (before: pending 4,621 ≠ 4,622).
- `REC-1/FP-300: a refund netted into a closed and paid batch (payout posted inside the window) ties out to 0`. The batch row is written as CloseBatch/PayoutBatch write it (totals, `refund_gross_fils`/`refund_fee_reversed_fils`, stamped event and refund, payout legs at `now()`).
- `FP-300: a reservation with no completed refund is flagged in its own list, not hidden in the gap`.

The existing `routes/settlement.test.ts` still passes (13/13 together with the new file).

**Regression risk:** Discounted merchants: the `capture: negotiated discount adjustment` credit is in the ledger but not in pending, and Go charges MDR on the discounted amount (FEES-3/FEES-5, an open decision). Their gap stays non-zero until that formula is chosen. This is not hidden: it shows up as gap ≠ 0.

**Trap note:** `query.ts:249-252` ("Refund legs are included both in the ledger figure and in pending") and `:277-279` ("same rate the capture path used") were false; the MK note about a "0046 trigger" refers to a trigger that does not exist. `routes/settlement.test.ts:161-172` posts payouts at end+12h so that the bug never shows; it is left as is (still valid).
