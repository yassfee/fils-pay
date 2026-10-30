### CHECKOUT-375 · On a phone the checkout's CVV field is off-screen and dashboard pages overflow sideways ·  · Severity: Medium

**Lead:** Team 45 heads-up list (item 2), verified by us.

**What's wrong:** On a 375 px phone screen, the hosted checkout's expiry-month / expiry-year / CVV row is wider than the screen. The CVV box starts at the right edge, so the buyer has to pan sideways to find it. On the merchant dashboard, the transactions table and the detail pages are also wider than the screen, so the whole page scrolls sideways.

**Why it happens:** `apps/web/src/pages/checkout/CheckoutPage.css:44-47` makes `.checkout-form-row` a flex row. Its three `<label>`s have no flex basis, and the inputs inside keep the browser's default width (about 20 characters each). Three default-width inputs do not fit in 343 px, and nothing lets them shrink. In `apps/web/src/dashboard.css:150-155` (pre-fix lines), `.dash-table` is `width: 100%` but grows to its content's width (six columns), and `.dash-dl` (`:166-170`) has a fixed `16rem` label column plus the value column. The dashboard has no rule for narrow screens.

**What it breaks:** Measured in headless Edge with a 375 px mobile viewport (`Emulation.setDeviceMetricsOverride`, `mobile: true`): the checkout lays out **549 px** wide (CVV right edge at 549 px), the transactions page **665 px**, and a transaction's detail page **411 px**. Buyers paying from a phone, the normal case for a payment link, see a cut-off form. Merchants on a phone get pages that pan sideways.

**Why it needed a fix:** Checkout is one of the three judged UI surfaces, and a payment page whose security-code field starts off-screen loses payments.

**Fix:** `apps/web/src/pages/checkout/CheckoutPage.css:42-43,50-54` and `apps/web/src/dashboard.css:178-183`
```diff
 .checkout-form input {
   padding: 0.5rem;
   font-size: 1rem;
+  width: 100%; /* CHECKOUT-375: fill the label, so a 375 px screen keeps CVV on-screen */
+  box-sizing: border-box;
 }
+.checkout-form-row label {
+  flex: 1;
+  min-width: 0;
+}
```
```diff
+/* CHECKOUT-375: on a phone, tables scroll inside themselves and label/value pairs stack. */
+@media (max-width: 640px) {
+  .dash-table { display: block; overflow-x: auto; }
+  .dash-dl { grid-template-columns: 1fr; }
+}
```
Commit: this commit. Lines: prod +13/-0 (CSS: 9 rules/declarations, 2 comments, 2 blank), test +0/-0.

**Why this is the smallest correct fix:** The checkout change is three declarations on existing selectors plus one new selector. The three labels share the row equally and may shrink below their content width, and each input fills its label. The dashboard change only applies under 640 px, so desktop layout is untouched. *Why not wrap every `.dash-table` in an `overflow-x` `<div>`?* That edits about 10 page components for the same result. `display: block; overflow-x: auto` on the table itself, scoped to narrow screens, does it in one rule. *Why not `flex-wrap`?* With `min-width: 0` the fields never need to wrap, and three short fields on one line is the expected card-form layout.

**Proof:** There is no unit test, because this is CSS and the repo has no DOM test runner. The proof is the measured layout from the same harness run on the same data, before and after (`docs/audit/evidence/ui/`): checkout 549 → **375 px** (CVV right edge 549 → 343 px), transactions 665 → **375 px** (the table scrolls inside itself), detail 411 → **375 px**. Screenshots: `checkout-375-{before,after}.png`, `dashboard-table-375-{before,after}.png`, `dashboard-detail-375-{before,after}.png`. Web tests pass 9/9 and `tsc --noEmit` is clean (CSS is not type-checked).

**Regression risk:** At desktop width, the checkout's card-number and expiry inputs now fill the 420 px form instead of using the browser default width, a cosmetic change (`checkout-open-after.png`). Dashboard rules apply only at ≤ 640 px.
