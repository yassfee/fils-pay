### API-5 · Manual credits and balance adjustments always show as an unexplained reconciliation gap · FP-300 ☐5 (reconciliation), REC-1 design · Severity: Low (reported, not changed)

**Lead:** Team 45 heads-up list (Q3), verified by us.

**What's wrong:** `GET /v1/settlement/reconciliation` computes `gapFils = ledger merchant_payable net − settlement net payout − pending unbatched captures − pending unbatched refunds` and reports `explained: gapFils === 0` (`apps/api/src/settlement/query.ts:283-345`). Manual ledger postings to `merchant_payable` (`manual credit: base` / `manual credit: MDR reversal` from `admin/credits.ts:157,170`, `manual balance adjustment` from `admin/ledgerAdjustments.ts:10-30`, and the CSV adjustment import) are in the ledger term but in no other term, so any window that contains one shows a non-zero gap and `explained: false`, with no line naming the cause.

**Why it happens:** REC-1 rebuilt the report around the two flows that feed settlement batches (captures and FP-300 refunds) and excluded only the `settlement payout:%` legs. Manual postings are not batched by CloseBatch, so they never appear in `settlement_batches.net_payout_fils` or in either pending query.

**What it breaks:** finance sees an "unexplained" gap of exactly the manual amount for a merchant that received a goodwill credit or a balance correction, and has to find the journal entry by hand.

**Why it is reported, not changed:** the case file asks only that the FP-300 refund flow "shows up right in … reconciliation" (FP-300 ☐5), and REC-1's design defines the gap over captures, refunds and batches. Nothing in a trusted source says manual journal entries must be explained by this report, and a manual posting that settlement never pays out arguably *should* stay visible as a gap. Changing the formula is a product decision, not a bug fix.

**The change we would make if finance wants them explained:** a sixth query in the same `Promise.all` summing `merchant_payable` legs whose description starts with `manual ` in the window, returned as `manualAdjustmentsFils` and subtracted from the gap (about 6 lines), following REC-1's "own line, not hidden" pattern.

**Proof:** reading `query.ts:290-296` (ledger term: every `merchant_payable` leg except payouts) against `:297-320` (the other terms: batches, capture events, refunds only), and the descriptions quoted above.

**Regression risk:** none (no change).

Lines: prod +0/-0 (proposed about +6), test +0/-0
