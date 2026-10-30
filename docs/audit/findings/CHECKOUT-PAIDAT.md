### CHECKOUT-PAIDAT · Checkout's "Payment successful" page showed a raw UTC ISO timestamp · Severity: Low

**Lead:** Team 45 heads-up list (U2), verified by us.
**Category:** UI/UX improvement

**What's wrong:** After paying, the buyer sees `Paid at 2026-10-30T14:11:31.805Z`, a machine timestamp in UTC. For a Bahrain buyer that reads three hours off, and it is the only date on the checkout that is not formatted.

**Why it happens:** `apps/web/src/pages/checkout/CheckoutPage.tsx:118` renders `payState.result.paidAt`, the API's ISO string, as-is. Every other date in the web app goes through `toLocaleString` (`format.ts:22-24`).

**What it breaks:** The receipt moment of the checkout looks unfinished, and the time looks wrong to a buyer in Bahrain (UTC+3).

**Why we changed it:** Checkout is a judged surface, and this is the page every successful buyer sees. This is a UI/UX improvement, not a money or security defect.

**Fix:** `apps/web/src/pages/checkout/CheckoutPage.tsx:118`
```diff
-          <dd>{payState.result.paidAt}</dd>
+          <dd>{new Date(payState.result.paidAt).toLocaleString(undefined, { timeZone: "Asia/Bahrain" })}</dd>
```
Commits: `84214f6` (format the ISO string with `toLocaleString()`), then `3d62ab2` (pin the zone to `Asia/Bahrain` after the false-positive review: without a zone, the time shown depended on the buyer's browser).

**Why this is the smallest correct fix:** one expression on the one line that renders the time, inlined so that the public, cookie-free checkout keeps its current imports. The zone is pinned because the case file's business clock is Bahrain time ("Settlement closes every day at midnight, Bahrain time (UTC+3)") and a buyer abroad, or a browser set to UTC, would otherwise see a different time from the merchant's records. The dashboard's `dateTime()` helper (`format.ts:23`) still uses the browser's zone; we left it unchanged.

**Proof:** There is no unit test: the change is to rendering only, and the repo has no DOM test runner. `tsc --noEmit` is clean. Screenshots: `checkout-success-before.png` (`2026-10-30T14:11:31.805Z`) and `checkout-success-after.png` (`10/30/2026, 5:12:19 PM`, Asia/Bahrain), both taken after `84214f6` with a real pay through the UI and a simulated test card. The after-shot was taken in a browser on Bahrain time (5:12 PM, one minute after the 14:11 UTC before-shot), which is what `3d62ab2` now renders whatever the browser's zone. After `3d62ab2`: apps/web `npm test` 14/14 and root `npm run typecheck` pass.

**Regression risk:** Display only. The API response and the request are unchanged.
Lines: prod +1/-1 net (`84214f6` +1/-1, `3d62ab2` +1/-1 on the same line), test +0/-0
