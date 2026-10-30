# ADJ-1 · "Adjust balance" writes the merchant_balances cache only, with no ledger entry

Severity: High · Case ref: F4 / FP-203 (balance must come from the ledger)

## What's wrong
`POST /v1/admin/merchants/:id/balance-adjustments` called `applyBalanceCorrection`, which only `UPDATE`s `merchant_balances.cached_payable_fils`. No ledger legs are written, so the cache and the ledger disagree by the adjustment, and any rebuild of balances from the ledger silently wipes it.

## Why it happens
- `apps/api/src/routes/adminBalanceAdjustments.ts:4,67` imported and called `applyBalanceCorrection` (`apps/api/src/admin/balanceAdjustments.ts:25-64`: cache UPDATE + audit row only).
- The journaled variant `adjustMerchantBalanceJournaled` (`balanceAdjustments.ts:67-114`) already exists and posts a balanced `manual_balance_adjustment_contra` / `merchant_payable` group (accounts from migration 0064) via `postLedgerAdjustment`, the same helper the CSV import uses, but nothing called it.
- Hiding cover: the route docstring frames it as a "direct correction to a merchant's cached payable balance ... without waiting on a settlement cycle", and the route test only checked the cache before/after, never the ledger.

## What it breaks
Merchant with cache 100,000 fils; finance adjusts +50,000 fils. Cache reads 150,000 fils, the ledger's merchant_payable still nets 100,000 fils: payouts and statements built from the ledger miss 50,000 fils (50.000 BD), and a balance rebuild sets the cache back to 100,000 fils.

## Why it needed a fix
FP-203 / F4: the ledger is the source of truth; a money movement without a journal entry is unauditable and is lost on rebuild.

## Fix
`apps/api/src/routes/adminBalanceAdjustments.ts`:
```diff
-import { applyBalanceCorrection } from "../admin/balanceAdjustments.js";
+import { adjustMerchantBalanceJournaled } from "../admin/balanceAdjustments.js";
-      const result = await applyBalanceCorrection(app.db, {
+      const result = await adjustMerchantBalanceJournaled(app.db, {
```
Lines: prod +2/-2. Test +22/-0 (new test appended to `adminBalanceAdjustments.test.ts`).

## Why smallest
The journaled path already exists, is tested (`balanceAdjustments.test.ts`, 9 cases) and has the same input/result contract, so the response body, the 404 for a missing balance row, and the role gates are unchanged. Rejected: adding a `postLedgerAdjustment` call inside `applyBalanceCorrection` (+1 line, but it would make the two functions identical while the audit action still says the un-journaled `balance_adjustment`); deleting `applyBalanceCorrection` (-40 lines and 4 test deletions, no behaviour gain now that nothing in production calls it; left for a cleanup).

## Proof
Before: `ADJ-1: an adjustment posts a balanced ledger group matching the cache delta` failed, `actual: []` (no ledger rows). After: passes with `[["manual_balance_adjustment_contra","debit",50000],["merchant_payable","credit",50000]]`. Route + admin suites: 19/19 pass. The audit action is now `balance_adjustment_journaled` with the entry group id.

## Regression risk
Low: same transaction shape plus two ledger inserts. `applyBalanceCorrection` remains exported but unused outside its own unit tests.

## Trap note
The fix already existed in the file ("Journaled variant") but was never wired; trace the route, not the module.
