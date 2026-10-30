### HUNT-4 · Public signup and the business-profile PATCH turn invalid profile fields into 500s · · Severity: Low (open)

**What's wrong:** `POST /v1/merchants` (public, unauthenticated signup) answers `500 internal_error` when `businessProfile.businessType` is not one of the five allowed values or `country` is not exactly two characters. `PATCH /v1/merchants/:merchantId/business-profile` answers 500 for the same values, for an unknown key (`{"foo":"x"}`, `{"constructor":"x"}`) and for `null` on a required field. Non-string values (`"legalName": {"a":1}`) are accepted and stored as JSON text.

**Why it happens:** the signup route (`apps/api/src/routes/businessProfile.ts:27-39`) only checks that required fields are truthy, and `createMerchantWithOwner` (`onboarding/signup.ts:58-66`) inserts them as given, so Postgres raises 23514 (the `business_type` CHECK in `0014_merchant_onboarding_state.sql`) or 22001 (value too long for `CHAR(2)`). The PATCH route passes `request.body` straight to `updateBusinessProfile` (`onboarding/businessProfile.ts:99-121`), which builds `SET ${PATCHABLE_COLUMNS[key]} = $n` for every body key: an unknown key becomes `undefined = $2` (42703) and an inherited one such as `constructor` becomes `function Object() { [native code] } = $2` (syntax error). No user text reaches the SQL, so this is not injection, but every case falls through `plugins/errorHandler.ts` to 500.

**What it breaks:** anyone on the internet can produce error-level 500s and stack traces through the public signup endpoint at will (the same monitoring problem ERR-1 fixed for NUL bytes), and a dashboard user who mistypes a field gets "internal error" instead of a validation message. Verified with `app.inject`: `businessType: "bogus"` → 500, `country: "BHR"` → 500, a valid body → 201.

**Why it needed a fix:** malformed client input must be a 4xx; a public endpoint that 500s on demand is noise for the security review and for on-call.

**Fix:** not changed. The fix we would make (about 5 lines): in the signup route's existing validation `if`, add `|| !["sole_proprietorship", "llc", "partnership", "public_company", "other"].includes(bp.businessType) || (bp.country !== undefined && !/^[A-Z]{2}$/.test(bp.country))`; in `updateBusinessProfile`, keep only `Object.hasOwn(PATCHABLE_COLUMNS, key)` entries with string (or `null` for the two nullable columns) values and apply the same two checks, throwing `BadRequestError("invalid_request", ...)`.

**Why it is open:** the two write paths need the same allowed-values list, which today exists only as a type (`BusinessProfile["businessType"]`) and a DB CHECK; doing it properly means a shared runtime list (a new helper) or duplicating it, and the severity is Low. *Why not map 23514/22001 to 400 in the error handler?* Those SQLSTATEs also come from server-side invariants (for example the `refunded_fils <= captured_fils` CHECK in 0098), which must stay 500s.

**Proof:** probe via `app.inject` on the w3f test database: `POST /v1/merchants` with `businessType: "bogus"` → `500 {"error":"internal_error"}` (pg 23514); with `country: "BHR"` → 500 (pg 22001); with `legalName: {"a":1}` → 201. `PATCH .../business-profile` as the owner: `{"city":"Riffa"}` → 200; `{"foo":"x"}`, `{"constructor":"x"}`, `{"businessType":"bogus"}`, `{"country":"BHR"}` and `{"legalName":null}` → 500 each.

**Regression risk (of the proposed fix):** only requests that 500 today, or that store a non-string, are refused.

Lines: prod +0/-0 (proposed about +5), test +0/-0
