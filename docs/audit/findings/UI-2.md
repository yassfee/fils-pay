### UI-2 · Admin credit form shows the display MDR as the fee it will reverse, not the rate the server reverses · F6 · Severity: Low

**Category:** Bug

**What's wrong:** on the admin merchant page, the "Issue credit" form's checkbox reads "Also reverse the MDR on this amount (2.50%)" for Alpha Retail Co, while the server reverses at the 2.25% schedule in force (shown two sections higher as "Current negotiated rate = 2.25% (225 bps)"). A 40.000 BD goodwill credit with the box ticked posts a 900-fils reversal (225 bps), not the 1,000 fils (250 bps) the label tells the operator.

**Why it happens:** the label (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:409`) formats `merchant.mdrBps`, the `merchants.mdr_bps` column that migration 0048 documents as only the default/display rate. ADMIN-CRED-4 moved the server's reversal to `getEffectiveMdrBps(now)` (`apps/api/src/admin/credits.ts:227`, `fees/feeSchedule.ts`), and FEES-4 made the detail response carry exactly that schedule as `currentFeeSchedule` (`fees/currentFeeScheduleDisplay.ts:24-31`, same query, same `effective_from <= now()` ordering). The label was never switched to it.

**What it breaks:** finance decides whether to tick "reverse the MDR" (and how much goodwill to give) from a rate that is not the one applied, for every merchant with a fee schedule: the case file's F6 complaint ("It shows 245bps, but payments go through at 225bps") in the admin console.

**Why it needed a fix:** case file F6: the fee shown must be the fee charged; here the console shows one rate and journals another.

**Fix:** `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:409`
```diff
-            Also reverse the MDR on this amount ({(merchant.mdrBps / 100).toFixed(2)}%)
+            Also reverse the MDR on this amount ({((detail.currentFeeSchedule?.mdrBps ?? merchant.mdrBps) / 100).toFixed(2)}%)
```

**Why this is the smallest correct fix:** the page already has the in-force schedule (`detail.currentFeeSchedule`, the same row the server reverses at) and already shows it on the same page; the fallback to `merchant.mdrBps` is the server's own fallback when no schedule exists (`getEffectiveMdrBps(..., merchant.mdr_bps)`). *Why not add the rate to the credit endpoint?* The value is already in the detail response; no API change is needed.

**Proof:** reproducible before/after check (render-only change; `apps/admin` has no DOM test runner): the lane's UI harness on a throwaway seeded database (`filspay_w3h_ui`, API on :3157, admin Vite on :5288, headless Edge), Alpha Retail Co (`mdr_bps` 250, schedule 225 since 2026-08-01). BEFORE: label "(2.50%)"; posting a 40.000 BD credit with `reverseFee: true` through the API returned `feeReversalFils: 900`. AFTER: label "(2.25%)". Screenshots: `docs/audit/evidence/ui/admin-credit-reversal-rate-before.png`, `…-after.png`. `apps/admin` `npm test` 4/4 and `tsc --noEmit` clean.

**Regression risk:** text only; merchants without a fee schedule show the same rate as before.

Lines: prod +1/-1, test +0/-0 (render-only; before/after evidence instead)
