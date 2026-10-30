### HUNT-6 · Business-profile PATCH turns unknown keys and invalid values into 500s · (no case ref; plainly invalid input must be a 4xx, same class as HUNT-4) · Severity: Low

**What's wrong:** `PATCH /v1/merchants/:merchantId/business-profile` (owner or finance session) answered `500 internal_error` for an unknown key (`{"foo":"x"}`, `{"constructor":"x"}`), an unknown `businessType`, a `country` longer than two characters, and `null` on a required field. Non-string values (`{"city":{"a":1}}`) were accepted and stored as JSON text.

**Why it happens:** the route passes `request.body` straight to `updateBusinessProfile` (`apps/api/src/onboarding/businessProfile.ts:99-121`), which builds `SET ${PATCHABLE_COLUMNS[key]} = $n` for every key in the body. An unknown key becomes `undefined = $2` (42703, column does not exist); an inherited key such as `constructor` becomes `function Object() { [native code] } = $2` (syntax error). No user text reaches the SQL, so this is not injection, but the values are not validated either, so 23514 (business_type CHECK, `0014_merchant_onboarding_state.sql:19`), 22001 (`CHAR(2)`, :20) and 23502 (NOT NULL) also reach the error handler and become 500s.

**What it breaks:** a logged-in user can produce 500s and error logs at will, and a dashboard typo shows "internal error" instead of a validation message. Signup had the same 500s for `businessType`/`country` and HUNT-4 fixed them there; the PATCH path writes the same columns.

**Why it needed a fix:** malformed client input must be a 4xx, the rule ERR-1, SEC-1, IMP-4 and HUNT-4 applied to the other routes.

**Fix:** `apps/api/src/onboarding/businessProfile.ts`, in `updateBusinessProfile`, before the SQL is built:
```diff
+  // HUNT-6: an unknown/inherited key, a non-string, null on a NOT NULL column, or a value outside the 0014 CHECK / CHAR(2) was a 500
+  const bad = entries.find(([key, value]) => !Object.hasOwn(PATCHABLE_COLUMNS, key) || (value === null ? key !== "addressLine2" && key !== "postalCode" : typeof value !== "string")
+    || (key === "businessType" && !["sole_proprietorship", "llc", "partnership", "public_company", "other"].includes(value!)) || (key === "country" && value!.length > 2));
+  if (bad) throw new BadRequestError("invalid_request", `${bad[0]} is not a valid business-profile field or value`);
```
plus `BadRequestError` added to the existing `lib/errors.js` import.

**Why this is the smallest correct fix:** one check at the single function that turns the body into SQL, mirroring the database's own rules (the 0014 CHECK list, `CHAR(2)`, and the two nullable columns) and the `businessType`/`country` rule HUNT-4 added to signup. The business-type list is repeated as a literal, as HUNT-4 did, rather than introducing a shared constant (no new helpers under the minimal-diff rule). *Why not map 23514/22001/42703 to 400 in the error handler?* Those codes also signal real server bugs elsewhere (REF-4 is a 23514 after money moved), so a global mapping would hide them. *Why not drop unknown keys silently?* A client that misspells a field would get 200 and an unchanged profile.

**Proof:** `HUNT-6: business-profile PATCH answers 400 for unknown keys and invalid values, and still applies valid ones` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500` (`{"foo":"x"}`), and passes after: all six bad bodies are 400, and `{"city":"Riffa","addressLine2":null,"businessType":"partnership"}` is still 200 and applied.

**Regression risk:** requests that were 500 now get 400; the only previously-200 requests that change are non-string values, which stored JSON text in a text column. `src/onboarding/*.test.ts` and `src/app.test.ts` pass.

Lines: prod +6/-1 (the import swap, a comment, 3 code lines, a blank line), test +18/-0
