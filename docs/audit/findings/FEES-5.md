### FEES-5 · Settlement re-prices each capture with its own formula, so the batch fee drifts from the ledger and strands fils in merchant_payable · FP-300 ☐3 · Severity: Medium
**Category:** Bug

**What's wrong:** `CloseBatch` did not use the fee the ledger booked at capture. It re-priced every capture event itself with `ComputeSettlementFee`, which takes the discount off the amount before applying the MDR. Capture books the MDR first and then takes the discount off the fee. For a discounted merchant the two answers differ by ±1 fil per event. `PayoutBatch` then debits `merchant_payable` by Go's net, so the gap stays in `merchant_payable` for good.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:211-215` (before the fix) re-resolved the rate per event (fee schedule, then platform tier at batch close) and called `ComputeSettlementFee` (`discounted_fee.go:8-9`): `ApplyRateFils(A − ApplyRateFils(A, d), m)`. Capture books `ApplyRateFils(A, m)` and then subtracts `ApplyRateFils(fee, d)` (`capture.ts`, FEES-3). `discounted_fee_test.go` pinned Go's own answer, `want: 14`, next to "am: api shows 15 for the same inputs ... ignore".

**What it breaks:** 602 fils at 275 bps with a 1250 bps discount: the ledger books 17 − 2 = 15 and the batch charges 14, so the payout is 588 and `merchant_payable` ends at −1 after payout. For 12,345 fils at 250 bps with 1500 bps the ledger books 263 and the batch 262. Each discounted event can drift by one fil, which matches "the gap is never 0 for discounted merchants". Re-pricing at close also means a tier flip, or a schedule tie-break (FEES-1/FEES-8), between capture and close prices the batch differently from the ledger.

**Why it needed a fix:** Case file FP-300 ☐3, "Fees and payouts come out right", and ☐2, "money is right in the ledger, down to the fils". The defect is the **parity** break: settlement charged a different fee from the one the ledger booked, and the difference stayed in `merchant_payable`. That is a bug whichever formula order is right. Which order is right was genuinely ambiguous in the repo (the sources conflict, see the trap note), so we did not pick it ourselves. The user's decision of 2026-10-30 (option A, recorded in `5542c53` and merge `fb739e7`) settled it: one fee per capture, booked once in the ledger at capture, fee-first, and everything downstream uses the booked fee. Go must charge what the ledger charged.

**Fix:** `apps/settlement/internal/settlement/batch.go:51,142-144,163-164,169,189,204`; `discounted_fee.go:8-9`
```diff
+	feeFils       money.Fils // FEES-5: platform_fee_revenue net that capture booked for this event
 ...
-	schedules, err := LoadFeeSchedules(ctx, tx, merchantID)   (and its 5-line comment + error check)
-	tierBonusBps := VolumeTierMdrBonusBps(platformProcessedFils)
 ...
-		SELECT te.id, te.transaction_id, te.amount_fils, te.occurred_at
+		SELECT te.id, te.transaction_id, te.amount_fils, te.occurred_at, -- FEES-5: the fee legs capture wrote with THIS event (one DB txn): dated its occurred_at, or its created_at if occurred_at was re-dated later
+		       (SELECT COALESCE(sum(CASE WHEN le.direction = 'credit' THEN le.amount_fils ELSE -le.amount_fils END), 0) FROM ledger_entries le
+		         WHERE le.transaction_id = te.transaction_id AND le.account_id = 'platform_fee_revenue' AND le.occurred_at IN (te.occurred_at, te.created_at))::bigint
 ...
-			effectiveMdrBps := EffectiveMdrBpsAt(schedules, e.occurredAt, mdrBps)
-			if effectiveMdrBps -= tierBonusBps; effectiveMdrBps < 0 {
-				effectiveMdrBps = 0
-			}
-			feeForTxn += ComputeSettlementFee(e.amountFils, effectiveMdrBps, discountBps)
+			feeForTxn += e.feeFils
```
```diff
-	discountedAmount := amountFils - money.ApplyRateFils(amountFils, discountBasisPoints)
-	return money.ApplyRateFils(discountedAmount, mdrBasisPoints)
+	fee := money.ApplyRateFils(amountFils, mdrBasisPoints) // FEES-5: fee-first, as capture.ts books it
+	return fee - money.ApplyRateFils(fee, discountBasisPoints)
```
**How a capture event is linked to its ledger rows:** `transaction_events` stores no `entry_group_id`. But `captureTransaction` writes the event (`occurred_at` and `created_at` both `DEFAULT now()`) and all of its legs (`occurred_at = now()`) in one DB transaction, and `now()` is fixed for a transaction. The match is **per event, not per transaction**: `event_type` includes `partially_captured`, and each partial capture is its own DB transaction with its own `now()` and its own legs, so summing per transaction would charge later partials in the first batch. It has two arms:
- `le.occurred_at = te.occurred_at` covers legs that copy the event's business time (the seed generator, `db/seed/fixtures/transactions.ts`, and the Go fixtures write the event and its group with one explicit timestamp).
- `le.occurred_at = te.created_at` covers legs dated at write time, and survives any later re-dating of the event's `occurred_at`. `ops/demo.sh` box 3 does exactly that: it re-dates the capture event to a closed day while the append-only ledger (LED-1) keeps today. With the first arm alone the batch found no fee (fee 0) and the demo's reconciliation could not reach gap 0.

Refund legs are written in their own DB transaction, so neither arm matches them. The fee is the `platform_fee_revenue` credits − debits of the matched legs (MDR fee − discount), the same "ledger net" definition REF-7 uses for refunds. Any path that breaks the "event and legs in one DB transaction" invariant shows up as a non-zero reconciliation gap (REC-1); that check is the safety net.

The fee-schedule load, the tier bonus and the per-event re-pricing are deleted because they would be dead code; that accounts for 15 of the 22 deleted lines. `ReadAndLockPlatformProcessedFils` stays (it still feeds the lifetime counter). The merchant read stays as the eligibility check; its `mdrBps`/`discountBps` are now unused in `CloseBatch`. Lines: prod +11/-22 = **33 lines, advisor-approved (over the 30-line limit; 15 of the deletions are code made dead, the real change is +11/-7)** (batch.go +9/-20, discounted_fee.go +2/-2), test +189/-16 (new `booked_fee_audit_test.go` +159; `discounted_fee_test.go` +21/-14; `internalapi/server_test.go` +9/-2).

**RecalculateMDR:** this function re-prices unpaid (`closed`) batches at the merchant's *current* terms on purpose. Feeding it the booked fee would make it a no-op, so it keeps `ComputeSettlementFee`. Once `CloseBatch` charges the booked fee, though, the amount-first formula would make it post a −1 adjustment at *unchanged* terms (602/275/1250: booked 15, recomputed 14). The 2-line formula change to fee-first makes it agree with capture. Known limitation, unchanged by this fix: RecalculateMDR uses `merchants.mdr_bps` with no fee schedule and no tier (FEES-2/MDR-1 territory).

**Why this is the smallest correct fix:** One subquery reads the figure the ledger already holds, and one line charges it. Settlement now has no fee formula of its own to drift: the ledger is the single source of truth for the fee, and the batch reads it instead of recomputing it. The rejected alternatives:
- *Option B only*, i.e. the fee-first formula in `ComputeSettlementFee` (2 lines). This is the obvious smaller diff, and it does fix the rounding order for today's vectors. We rejected it because it keeps two independent fee computations, one at capture and one at close, that must stay equal forever. They already differ in inputs, not just order: close re-resolves the fee schedule and the platform tier at batch time, so a tier flip or schedule tie-break between capture and close (FEES-1/FEES-8), or any future capture-side change, re-opens the same gap. Reading the booked fee removes the second computation, so parity holds by construction. It is also not the user's decision.
- *Read `transaction_events.metadata.feeFils`*: after FEES-3 that is the net fee, but it is a copy, not the ledger, and for pre-FEES-3 API captures it is the pre-discount fee.
- *Sum per transaction rather than per event*: partial captures on different business days would be charged in the first batch.
- *Store `entry_group_id` on the event*: needs a migration and a TS change for a link that already exists.

**Proof:** Each test, red before the fix and green after:
- `TestCloseBatch_ChargesTheBookedDiscountedFee/602_fils...`. Before: `batch fee_fils = 14, net_payout_fils = 588`, `merchant_payable after payout nets to -1`. After: fee 15, net 587, merchant_payable 0.
- `TestCloseBatch_ChargesTheBookedDiscountedFee/12,345_fils...`. Before: 262 / 12083 / −1. After: 263 / 12,082 / 0. This is the same vector as FEES-3's API and link tests, so all three paths book 263.
- `TestCloseBatch_BookedFeeAndBookedRefundReversalNetTo6517`: a 250 bps merchant whose capture booked 225, and a refund of 3,333 that reversed 75. Before: fee 250, net 6,492. After: fee 225, net 6,517, the DEMO_SCRIPT figure.
- `TestComputeSettlementFee`: corrected `want` 14 → 15 for 602/275/1250, plus a 12,345/250/1500 → 263 row. Before: `= 14, want 15` and `= 262, want 263`.
- `TestCloseBatch_BookedFeeFoundAfterEventReDated` (the created_at arm, done the way demo.sh does it): capture 12,345 at 250/1500 in one DB transaction, re-date only the event 2 days back, close that day. With the `occurred_at` arm alone: `booked 263, batch fee 0`, `merchant_payable after payout nets to -263`. With both arms: fee 263, merchant_payable 0.
- `TestRecalculateMDR_DiscountedMerchantUnchangedTermsAdjustsNothing`: passes on the base code. With only the batch.go half applied it fails (`OldFeeFils:15 NewFeeFils:14 DiffFils:-1`). It passes with the formula change.

The FP-300 refund tests (`TestCloseBatch_NetsRefundIntoPayout`, `_RefundLargerThanNetRollsForward`, `_SplitParentChildrenSumToNettedNet`, `TestRecalculateMDR_KeepsRefundNetting`, `TestRecalculateMDR_PaidBatchUntouched`) pass unchanged. Full Go suite: 70 pass, 0 fail, 1 skip (the seeded-fixture test, also skipped on the base).

**Regression risk:**
- A capture event with no `platform_fee_revenue` legs at either timestamp is charged 0. Every real capture with a fee writes them in the same DB transaction. The one test fixture that seeded a capture without fee legs (`internalapi/server_test.go` `TestRunBatch_ValidTokenAndDate`, which expected 250 "recomputed per event") now seeds the legs capture writes. The shared fixture is left alone, because the BAL-1 rebuild test needs `merchant_payable` = 12,000.
- **Deploy caveat (transitional data):** before FEES-3 the API path wrote its discount legs post-commit in a separate DB transaction, dated `now()` of that later transaction (`apps/api/src/payments/discountAdjustment.ts:81-82`). Those legs match neither arm, so a discounted API capture made before this change and still unbatched would be charged the undiscounted fee. Close the open batches before deploying (or post a compensating entry; ledger rows are never edited, LED-1). Our hosted database is fresh, so this is documentation only.
- Refund netting is unchanged. It already nets `refunds.fee_reversed_fils`, which REF-7 derives from the same ledger net, so both sides of the payout are booked figures.

**Trap note:** `discounted_fee_test.go:9-14` claimed amount-first is "the order settlement's reconciliation policy specifies" (FH: "the 14 is right"; am: "api shows 15 ... ignore"). No such policy exists in the repo. CHANGELOG 1.3.1 ("applied after MDR at capture and settlement") and Yousif's 0047 note ("off the fee, after MDR") give fee-first, while `docs/ARCHITECTURE.md:55-56` ("Discounts reduce the amount the MDR is charged on") and AM's 0047 line give amount-first. The user's 2026-10-30 option-A decision settles it in favour of the ledger. The comments at `batch.go:126-130` (old) promised Go matched capture's resolution "exactly"; the code they described is now gone. apps/reporting does not recompute fees: it copies `fee_fils` from the `settlement.batch_closed` payload (`consumer/applyEvent.ts:114`), so it now carries the booked fee. Other fee recomputers outside settlement: `apps/api/src/admin/creditThreshold.ts:20` (credit fee reversal on `mdr_bps`, ADMIN-CRED-4), and `apps/api/src/v1/fees/calculateFee.ts` (not registered, so dead).
