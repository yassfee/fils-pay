### HUNT-4 · Public signup turns an unknown businessType or a long country code into a 500 · Severity: Low

**What's wrong:** `POST /v1/merchants` (public, unauthenticated signup) answers `500 {"error":"internal_error"}` with an error-level stack trace when `businessProfile.businessType` is not one of the five allowed values or `country` is longer than two characters. Anyone on the internet can trigger it at will.

**Why it happens:** the signup route (`apps/api/src/routes/businessProfile.ts:27-39`) only checks that required fields are truthy, and `createMerchantWithOwner` (`onboarding/signup.ts:58-66`) inserts them as given. Postgres then raises 23514 (the `business_type` CHECK in `db/migrations/0014_merchant_onboarding_state.sql`) or 22001 (value too long for `country CHAR(2)`), which `plugins/errorHandler.ts` does not map, so it becomes a 500.

**What it breaks:** an unauthenticated caller can produce 500s and error logs on demand (the same alerting/log-flooding problem ERR-1 fixed for NUL bytes), and a real applicant who picks a wrong type gets "internal error" instead of a validation message.

**Why it needed a fix:** malformed client input must be a 4xx, and a public endpoint that 500s on demand is a finding in any security review.

**Fix:** `apps/api/src/routes/businessProfile.ts:40-42`
```diff
       throw new BadRequestError("invalid_request", "missing required business profile or owner fields");
     }
+    if (!["sole_proprietorship", "llc", "partnership", "public_company", "other"].includes(bp.businessType) || String(bp.country ?? "BH").length > 2) {
+      throw new BadRequestError("invalid_request", "businessType or country is not valid"); // HUNT-4: the 0014 CHECK / CHAR(2) made these a 500
+    }
```
The list is the 0014 CHECK's list; the country rule is exactly what `CHAR(2)` rejects, so only requests that used to 500 are refused.

**Why this is the smallest correct fix:** one check next to the route's existing required-field check, before any write. *Why not map 23514/22001 to 400 in the error handler?* Those SQLSTATEs also come from server-side invariants (for example the `refunded_fils <= captured_fils` CHECK in 0098), which must stay 500s. *Why not a stricter country rule (ISO letters only)?* `CHAR(2)` accepts any two characters today, and narrowing it would refuse signups that currently succeed.

**Proof:** `HUNT-4: public signup rejects an unknown businessType or a country longer than two letters with 400` (`apps/api/src/routes/auth.audit.test.ts`). Before: `{"businessType":"bogus"} -> 500`, `{"country":"BHR"} -> 500`. After: both 400, and a valid body is still 201.

**Regression risk:** only bodies that failed with 500 now get 400. `routes/auth.audit.test.ts`, `app.test.ts` (signup, login, OTP, KYC) and `onboarding/*.test.ts` pass (28/28); full api suite and `tsc --noEmit` clean. The dashboard PATCH of the same fields has the same class of 500s and is the open finding HUNT-6.

Lines: prod +3/-0, test +17/-0
