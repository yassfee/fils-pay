### API-7 · Creating a zero-fils payment link crashes with a 500 · (no case ref; plainly invalid input must be a 4xx; ADR-0001 integer fils) · Severity: Low

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.

**What's wrong:** `POST /v1/merchants/:merchantId/payment-links` with `{"amountFils":0, ...}` (owner or finance) answered `500 internal_error`; the log shows `new row for relation "payment_links" violates check constraint` (23514). Negative, fractional and non-numeric amounts already get `400 invalid_amount`.

**Why it happens:** `createPaymentLink` (`apps/api/src/paymentLinks/create.ts:31-35`) validates the amount only through `toFils`, which accepts 0 (a valid fils value). The table requires `amount_fils > 0` (`db/migrations/0020_payment_links.sql:31`), so the zero reaches the INSERT and the CHECK violation falls through the error handler as a 500. The docblock above the function promises that every failure "is a real `AppError` subclass".

**What it breaks:** a merchant who leaves the amount at 0 in an integration (or a dashboard request with an empty amount coerced to 0) gets "internal error" instead of the existing `invalid_amount` message, and every attempt logs an error-level 500.

**Why it needed a fix:** malformed client input must be a 4xx; the database already says a link of 0 fils is invalid, so the API must say so too, with the code it uses for every other bad amount.

**Fix:** `apps/api/src/paymentLinks/create.ts`, after the `toFils` try/catch:
```diff
+  if (amountFils === 0) throw new BadRequestError("invalid_amount", "amountFils must be positive"); // API-7: 0 hit CHECK (amount_fils > 0) as a 500
```

**Why this is the smallest correct fix:** one guard next to the existing amount validation, reusing its error code. *Why not map 23514 to 400 in the error handler?* A CHECK violation can also be a server bug after money moved (REF-4), which must stay a 500. *Why not add a check to `toFils`?* Zero is a legitimate fils value everywhere else (fees, refunds, balances).

**Proof:** `API-7: a zero-fils payment link is a 400, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500`, and passes after, with no `payment_links` row written.

**Regression risk:** only `amountFils: 0` changes (500 to 400). `src/routes/paymentLinks.test.ts` and `src/paymentLinks/*.test.ts` pass. The payment-link read/pay checkout path is untouched.

Lines: prod +1/-0, test +19/-0
