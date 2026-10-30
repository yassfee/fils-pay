### ADMIN-CRED-4 · A credit's MDR reversal uses the display rate (merchants.mdr_bps), not the rate capture charged · F6 · Severity: Medium

**What's wrong:** When a finance admin issues a credit with "reverse fee", the reversal is computed at `merchants.mdr_bps`. Since migration 0048 that column is only the default/display rate; capture charges the effective-dated `fee_schedules` rate. For every merchant with a schedule row, the credit gives back a different MDR than the merchant paid.

**Why it happens:** `apps/api/src/admin/credits.ts:226-227` (before) called `calculateCreditFeeReversal(draft.baseAmountFils, merchant.mdr_bps)` with the rate read at `:212` (`SELECT mdr_bps FROM merchants`). Capture resolves its rate with `getEffectiveMdrBps(client, merchantId, now, merchant.mdr_bps)` (`apps/api/src/payments/capture.ts:174`). `db/migrations/0048_fee_schedules.sql` documents mdr_bps as "the default/display rate" and the schedule as "the rate actually applied". No trigger keeps them in sync (the "0046 trigger" cited in comments does not exist).

**What it breaks:** Alpha Retail: `mdr_bps` 250, schedule 225 since 2026-08-01. A 40.000 BD goodwill credit with fee reversal posts 1,000 fils of "MDR back" instead of the 900 fils the merchant was charged on that amount, 100 fils (11%) too much, journaled from `platform_fee_revenue` to `merchant_payable`. This is the same two-rates confusion as case file F6 ("It shows 245bps, but payments go through at 225bps").

**Why it needed a fix:** F6: the fee used anywhere must be what is actually charged. A reversal at the display rate moves money the platform never collected.

**Fix:** `apps/api/src/admin/credits.ts:10,227`
```diff
+import { getEffectiveMdrBps } from "../fees/feeSchedule.js";
 ...
     const feeReversalFils = draft.reverseFee
-      ? calculateCreditFeeReversal(draft.baseAmountFils, merchant.mdr_bps)
+      ? calculateCreditFeeReversal(draft.baseAmountFils, await getEffectiveMdrBps(client, input.merchantId, new Date(), merchant.mdr_bps)) // ADMIN-CRED-4: the rate capture charges (F6)
       : ZERO_FILS;
```
The credit now resolves the rate with the exact function and fallback capture uses, inside the same transaction; a merchant without a schedule row still falls back to `mdr_bps`, as at capture.

**Why this is the smallest correct fix:** one argument at the single place the reversal is priced, reusing the existing resolver. *Not changed:* the platform volume tier (FEES-1, a pricing-policy question) and the negotiated discount are not applied to the reversal; the lead's second point (the approval threshold compares the base only) has contradicting claims in the repo (`credits.ts` MK note and ADMIN.md vs `adminCredits.test.ts:203`) and no case-file anchor, so it is left as a policy question.

**Proof:** `ADMIN-CRED-4: the credit's MDR reversal uses the effective fee-schedule rate, not merchants.mdr_bps` (`apps/api/src/admin/credits.test.ts`, mdr_bps 250 with a 225 bps schedule effective yesterday, base 40,000 fils). Before the fix: `expected: 900, actual: 1000`. After: passes. Credit, credit route, threshold and validation tests pass (43/43).

**Follow-up UI-2 (ours, merged into this row):** after this fix the server reverses the rate capture charged, but the admin credit form still labelled the reversal with the display rate: on Alpha Retail Co (`mdr_bps` 250, schedule 225) it said "reverse MDR (2.50%)" while a 40.000 BD credit reversed 900 fils (2.25%). Fix (`61cd1e3`, `MerchantDetailPage.tsx:409`, prod +1/-1): the label shows `detail.currentFeeSchedule?.mdrBps ?? merchant.mdrBps`, the schedule rate in force that the server uses. Proof (render-only, no DOM test runner in `apps/admin`): `docs/audit/evidence/ui/admin-credit-reversal-rate-before.png` and `-after.png`, from a throwaway seeded database.

**Regression risk:** Only merchants with a fee schedule that differs from `mdr_bps` get a different reversal, now equal to the charged rate. Existing tests use merchants without schedule rows, whose reversal is unchanged.

Lines: prod +3/-2 (the reversal +2/-1; follow-up UI-2 +1/-1), test +15/-0
