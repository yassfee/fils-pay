### HUNT-6 · Business-profile PATCH turns unknown keys and invalid values into 500s · · Severity: Low (open)

**What's wrong:** `PATCH /v1/merchants/:merchantId/business-profile` (owner or finance session) answers `500 internal_error` for an unknown key (`{"foo":"x"}`, `{"constructor":"x"}`), an unknown `businessType`, a `country` longer than two characters, and `null` on a required field. Non-string values are accepted and stored as JSON text.

**Why it happens:** the route passes `request.body` straight to `updateBusinessProfile` (`apps/api/src/onboarding/businessProfile.ts:99-121`), which builds `SET ${PATCHABLE_COLUMNS[key]} = $n` for every key in the body. An unknown key becomes `undefined = $2` (42703, column does not exist); an inherited key such as `constructor` becomes `function Object() { [native code] } = $2` (syntax error). No user text reaches the SQL, so this is not injection, but the values are not validated either, so 23514 (business_type CHECK), 22001 (`CHAR(2)`) and 23502 (NOT NULL) also reach the error handler and become 500s.

**What it breaks:** a logged-in user can produce 500s and error logs at will, and a dashboard typo shows "internal error" instead of a validation message.

**Why it needed a fix:** malformed client input must be a 4xx.

**Fix:** not changed. The fix we would make (about 3 lines in `updateBusinessProfile`): keep only entries with `Object.hasOwn(PATCHABLE_COLUMNS, key)`, refuse `null` except for `addressLine2`/`postalCode`, and apply the same `businessType`/`country` check HUNT-4 added to signup, throwing `BadRequestError("invalid_request", ...)`.

**Why it is open:** the allowed `businessType` list would be duplicated a second time (signup route and here); doing it once needs a shared constant, which is outside the minimal-diff rule for a Low item, and the route is authenticated.

**Proof:** `app.inject` probe on the w3f test database as the owner: `{"city":"Riffa"}` → 200; `{"foo":"x"}`, `{"constructor":"x"}`, `{"businessType":"bogus"}`, `{"country":"BHR"}`, `{"legalName":null}` → 500 each.

**Regression risk (of the proposed fix):** only requests that 500 today, or that store a non-string, would be refused.

Lines: prod +0/-0 (proposed about +3), test +0/-0
