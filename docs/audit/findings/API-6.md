### API-6 · Authorize answers 500 for a malformed card (the amount half is fixed: K-5, in ERR-1) · Severity: Low (reported, not changed)

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.
**Category:** Reported, not changed

**Update (wave 3 merge):** the amount half (`1.5`, `0`, negative and string `amountFils` on authorize and capture) was fixed by K-5 (`683f19c`, +2/-0, counted in ERR-1), because those inputs also sent a zero authorize to the acquirer before failing. The malformed-card half (`"card":"x"`, `{"pan":5}`) is still reported, not changed: it fails before any call or write.

**What's wrong:** with a valid API key, `POST /v1/transactions` answers `500 internal_error` for `{"amountFils":1.5,"card":{}}`, `{"amountFils":1000,"card":"x"}` and `{"amountFils":1000,"card":{"pan":5}}`, and for `{"amountFils":0, ...}` with a valid card (the INSERT hits `CHECK (amount_fils > 0)`, `0004_transactions.sql:13`). With an owner session, `POST /v1/transactions/:id/capture` answers 500 for `{"amountFils":1.5}`. The log shows `RangeError: toFils: expected an integer number of fils, got 1.5` and `TypeError: pan.endsWith is not a function`.

**Why it happens:** `apps/api/src/routes/transactions.ts:71-78` checks only that `amountFils` and `card` are present, then calls `toFils(amountFils)`, which throws a plain `RangeError` (not an `AppError`) for a non-integer; capture does the same at `:100`. A `card` that is not an object with a string `pan` reaches the acquirer simulator, which calls `pan.endsWith(...)` (`apps/api/src/acquirer/simulator.ts:114`). The refund route already guards the same input (`routes/refunds.ts:15-16`, `Number.isSafeInteger`, 400 `invalid_request`).

**What it breaks:** a merchant integration that sends `12.5` instead of `12500` gets "internal error" instead of a validation message, and every such call logs an error-level 500. No money moves: the request fails before any database write.

**Why it is reported, not changed:** our working agreement freezes the checkout path (payment-link read/pay, authorize, capture) for this wave, and the effect is a wrong status code on a request that is refused anyway. The change we would make, in `routes/transactions.ts`:
```diff
-      if (amountFils === undefined || !card) {
+      if (!Number.isSafeInteger(amountFils) || (amountFils as number) <= 0 || typeof card !== "object" || card === null || typeof (card as { pan?: unknown }).pan !== "string") {
```
and, in the capture handler, `if (amountFils !== undefined && !Number.isSafeInteger(amountFils)) throw new BadRequestError("invalid_request", "amountFils must be an integer number of fils");` (2 lines in total, both returning the existing 400 `invalid_request`).

**Proof:** `app.inject` probe on our test database (API key and owner session): the five requests above → 500 each, with the two error types quoted. The same probe confirms refunds answer 400 for the same inputs.

**Regression risk (of the proposed change):** only requests that 500 today would get 400.

Lines: prod +0/-0 (proposed +2/-1), test +0/-0
