### RECON-REFUNDS · Merchant reconciliation says "no gap" over three numbers that do not add up (refund lines not shown) · H1 / FP-300 · Severity: Medium

**Lead:** Team 45 heads-up list (item 4, part 7), verified by us.

**What's wrong:** After a refund, the merchant dashboard's Reconciliation page shows "Reconciled — no gap" under these figures: ledger payable 3.666 BHD, settlement payout 0.000 BHD, pending 4.643 BHD, gap 0.000 BHD. The caption says "Gap = ledger − payout − pending", but 3.666 − 0.000 − 4.643 = −0.977, not 0. The 0.977 BHD of unbatched refund (1.000 BHD refunded minus the 0.023 BHD fee reversal) is in the server's formula and missing from the page.

**Why it happens:** REC-1 (FP-300 ☐5) added `pendingUnbatchedRefundsFils` and `nettedRefundsFils` to `GET /v1/settlement/reconciliation`, and the gap became `ledger − payout − pending − pendingUnbatchedRefunds` (`apps/api/src/settlement/query.ts:249-262,331`). The web type `ReconciliationReport` (`apps/web/src/types.ts:259-267`) was never updated. `ReconciliationPage.tsx:119-137` therefore renders only the old three terms and the old formula text, while showing the server's gap, which does include refunds.

**What it breaks:** The merchant cannot check the page's own arithmetic. After any refund the page shows a contradiction ("no gap" over numbers with a 0.977 BHD hole), or a non-zero gap that the listed terms cannot explain. Reconciliation is exactly where a merchant needs every fil to be visible.

**Why it needed a fix:** FP-300 ☐5 asks for refunds to tie out in reconciliation. The API now does that, and the page has to show the terms it ties out with.

**Fix:** `apps/web/src/types.ts:265-266` and `apps/web/src/pages/settlement/ReconciliationPage.tsx:130-133,139-141`
```diff
   pendingUnbatchedFils: number;
+  pendingUnbatchedRefundsFils: number; // RECON-REFUNDS: in the API's gap formula (REC-1), was missing here
+  nettedRefundsFils: number;
```
```diff
+            <dt>Refunds, not yet batched</dt>
+            <dd>{bhd(report.pendingUnbatchedRefundsFils)}</dd>
+            <dt>Refunds netted in settled batches (inside the payout above)</dt>
+            <dd>{bhd(report.nettedRefundsFils)}</dd>
-            unbatched. A zero gap means every captured fil is accounted for in
-            either a settled batch or the pending queue.
+            unbatched − refunds not yet batched. A zero gap means every captured
+            and refunded fil is accounted for in either a settled batch or the pending queue.
```
Commit: this commit. Lines: prod +8/-2, test +0/-0.

**Why this is the smallest correct fix:** The page only displays values the API already returns, and it shows the formula the API already uses (`query.ts:331`). *Why also show `nettedRefundsFils`?* It is not a term of the gap. It sits inside the settlement payout, and labelling it that way explains why a payout can be lower than the captures. *Why not recompute the gap in the browser?* The server's gap is authoritative, and the page must not second-guess it. Negative amounts render because of UI-NEG-1, which `bhd` needed for exactly this row.

**Proof:** There is no unit test: the change is to rendering only, and the repo has no DOM test runner. The field names are checked by `tsc --noEmit` against the shared shape, and web tests pass 10/10. Screenshots on the same data: `dashboard-reconciliation-before.png` shows 3.666 − 0.000 − 4.643 ≠ 0 under "no gap". `dashboard-reconciliation-after.png` shows the −0.977 BHD refund row, and 3.666 − 0.000 − 4.643 − (−0.977) = 0.000.

**Regression risk:** None to the API. The endpoint already returns both fields (`query.ts:339-340`), and the request is unchanged.

**Trap note:** `types.ts:258` ("YA: gapFils is a string here (pre-Jan contract)") is false. The API returns a number and the type says `number`. Left as-is.
