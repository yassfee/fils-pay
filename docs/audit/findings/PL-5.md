### PL-5 · A failed capture in the payment-link checkout strands an authorized transaction and its 7-day hold · FP-300 ☐1 · Severity: Medium

**What's wrong:** The public checkout (`POST /v1/payment-links/:token/pay`) authorizes, then captures. When the capture is declined or errors, it releases the link and returns, but leaves the transaction it just authorized in status `authorized` with an `active` hold for 7 days. The buyer's retry (the checkout sends a fresh `Idempotency-Key` per click, `apps/web/src/pages/checkout/CheckoutPage.tsx:56-58`) authorizes a brand-new transaction, so the old one is orphaned.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts:130-136` (before) handled `captureResult.statusCode !== 200` with `releaseReservation` alone. `authorizeTransaction` had already inserted the transaction as `authorized` and a hold `now() + interval '7 days'` (`apps/api/src/payments/authorize.ts:116-117`). Nothing else in the flow cleans it up; the authorize-stage failure path has nothing to clean because nothing was authorized.

**What it breaks:** With the default simulator about 2% of captures fail (`config.ts:221`, `ACQUIRER_FAILURE_RATE` 0.02). Each one leaves the buyer's funds held for 7 days and an `authorized` row in the merchant's dashboard. A 75.000 BD link: the retry captures 75,000 fils and pays the link; if the merchant then captures the stranded authorization from the dashboard (`POST /v1/transactions/:id/capture`), the buyer pays 150,000 fils for one 75,000 fils link. Reproduced by the test below: after the declined capture the row is `authorized` / hold `active`.

**Why it needed a fix:** Payment links are the feature's end-to-end path through the API (FP-300 "Done when" ☐1 and ☐2, money right in the ledger): a declined payment must leave nothing chargeable behind, and a buyer must never be exposed to a double charge for one link.

**Fix:** `apps/api/src/paymentLinks/pay.ts:5,132-133` and `apps/api/src/payments/void.ts:11`
```diff
+import { voidTransaction } from "../payments/void.js";
 ...
   if (captureResult.statusCode !== 200) {
+    // PL-5: nothing was captured; void our own authorization (a no-op 409 unless still 'authorized') so it can't be captured later
+    await voidTransaction(pool, { transactionId: txnId, merchantId: link.merchantId, actor: { type: "system", id: link.id } });
     await releaseReservation(pool, link.id);
```
```diff
-  actor: { type: "merchant_session" | "merchant_api_key"; id: string };
+  actor: { type: "merchant_session" | "merchant_api_key" | "system"; id: string }; // PL-5: the link checkout voids its own auth
```
`voidTransaction` is the existing, wired void (`POST /v1/transactions/:id/void`): one DB transaction that row-locks the transaction, sets `voided` only if it is still `authorized`, releases the hold, records the `voided` timeline event (actor `system`, which `transaction_events.actor_type` and `captureTransaction` already accept) and enqueues `transaction.voided` for webhooks and reporting. The actor type is widened by one union member so the checkout can pass the same `system` actor it already passes to authorize and capture.

**Why this is the smallest correct fix:** one call on the single failing branch, reusing the void the API already exposes. *Why not let the hold expire?* `expire_holds` only flips the hold; the transaction stays `authorized` and capturable. *Why not reuse the authorization on the retry?* The checkout mints a new idempotency key per click by design, and reusing an auth across requests would need new state. *Why not also void on the PL-1 fence exit (`pay.ts:122`)?* There a same-key retry may be capturing the same transaction concurrently; it is a separate residual of PL-1 and out of this lead's scope. Safety: the void row-locks and only acts on `authorized`, so if a concurrent same-key request already captured the transaction, the void returns 409 and changes nothing.

**Proof:** `PL-5: a declined capture voids the link payment's authorization and releases its hold` (`apps/api/src/routes/paymentLinks.test.ts`, acquirer capture stubbed to `declined`). Before the fix: `deepEqual` fails with `{ status: 'authorized', hold_status: 'active' }`. After: `{ status: 'voided', hold_status: 'released' }`, the response is still 402 `stage: "capture"`, and a retry pays the link (200).

**Regression risk:** The response to the buyer is unchanged. A capture that failed with an ambiguous acquirer error (502) is now voided locally; with the simulator an error means nothing was captured, while a real acquirer integration would need a capture-status lookup before voiding. An API client that retries the same `Idempotency-Key` after a 502 now gets a failure (the transaction is voided) and must use a new key, as the checkout already does. The merchant receives a `transaction.voided` webhook for the failed attempt. `routes/paymentLinks.test.ts`, `paymentLinks/*.test.ts` and the transactions/void tests pass (36/36).

Lines: prod +4/-1 (pay.ts +3, of which 1 comment; void.ts +1/-1), test +23/-0
