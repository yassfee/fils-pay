### CHECKOUT-PAIDAT · Checkout's "Payment successful" page shows a raw UTC ISO timestamp · G1 · Severity: Low

**Lead:** Team 45 heads-up list (U2), verified by us.

**What's wrong:** After paying, the buyer sees `Paid at 2026-10-30T14:11:31.805Z`, a machine timestamp in UTC. For a Bahrain buyer that reads three hours off, and it is the only date on the checkout that is not formatted.

**Why it happens:** `apps/web/src/pages/checkout/CheckoutPage.tsx:118` renders `payState.result.paidAt`, the API's ISO string, as-is. Every other date in the web app goes through `toLocaleString` (`format.ts:22-24`).

**What it breaks:** The receipt moment of the checkout looks unfinished, and the time looks wrong to a buyer in Bahrain (UTC+3).

**Why it needed a fix:** Checkout is a judged surface, and this is the page every successful buyer sees.

**Fix:** `apps/web/src/pages/checkout/CheckoutPage.tsx:118`
```diff
-          <dd>{payState.result.paidAt}</dd>
+          <dd>{new Date(payState.result.paidAt).toLocaleString()}</dd>
```
Commit: this commit. Lines: prod +1/-1, test +0/-0.

**Why this is the smallest correct fix:** It is the same rendering the dashboard's `dateTime()` uses, inlined so that the public, cookie-free checkout keeps its current imports. *Why not force `timeZone: "Asia/Bahrain"`?* The rest of the app renders in the browser's zone. One page that differs would be its own inconsistency, and a Bahrain buyer's browser is already in UTC+3.

**Proof:** There is no unit test: the change is to rendering only, and the repo has no DOM test runner. `tsc --noEmit` is clean. Screenshots: `checkout-success-before.png` (`2026-10-30T14:11:31.805Z`) and `checkout-success-after.png` (`10/30/2026, 5:12:19 PM`, Asia/Bahrain), both taken after a real pay through the UI with a simulated test card.

**Regression risk:** Display only. The API response and the request are unchanged.
