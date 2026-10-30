### API-9 · A KYC image with a valid signature but corrupt data crashes the upload with a 500 · (no case ref; plainly invalid input must be a 4xx, same class as ADMIN-UPL-1) · Severity: Low

**What's wrong:** `POST /v1/merchants/:merchantId/kyc/documents` (owner or finance) with a file that starts with the PNG or JPEG magic bytes but is truncated or corrupt answered `500 internal_error`; the log shows sharp's `Input buffer has corrupt header: pngload_buffer: end of stream` (or `VipsJpeg: Premature end of input file`). An empty file, a wrong signature or an oversized image already get `422 invalid_file_type`.

**Why it happens:** `recordKycDocument` (`apps/api/src/onboarding/kyc.ts:51-53`) accepts the upload once `detectFileType` recognises the first bytes, then calls `generateKycThumbnail` (`apps/api/src/onboarding/kycThumbnail.ts:34-40`), which decodes it with sharp. The `.catch` that ADMIN-UPL-1 added turns only the pixel-limit error into a 422 and re-throws every other decode error unchanged, so a corrupt image reaches the error handler as a plain `Error`.

**What it breaks:** a merchant whose phone produced a truncated photo (an interrupted upload, a partially synced file) gets "internal error" instead of "invalid file", and support sees a server error for what is a bad file; anyone with a session can produce error-level 500s at will.

**Why it needed a fix:** malformed client input must be a 4xx, and the upload already has the right answer for undecodable files (`422 invalid_file_type`).

**Fix:** `apps/api/src/onboarding/kycThumbnail.ts:39`
```diff
-      throw /pixel limit/i.test(String(err)) ? new UnprocessableEntityError("invalid_file_type", "image exceeds 25 MP") : err;
+      throw new UnprocessableEntityError("invalid_file_type", /pixel limit/i.test(String(err)) ? "image exceeds 25 MP" : "image cannot be decoded"); // API-9: a corrupt image was a 500
```

**Why this is the smallest correct fix:** the decode of the merchant's own bytes is the only thing this `catch` wraps, so any failure there means the upload is not a usable image; one line keeps ADMIN-UPL-1's message and adds the general case. Because the thumbnail is generated before any disk write (ADMIN-UPL-1), the 422 leaves no file and no row behind. *Why not validate the image structure in `detectFileType`?* That would mean a second image parser; sharp is the parser that matters.

**Proof:** `API-9: a KYC image with a valid signature but corrupt data is a 422, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 422, actual: 500` (truncated PNG), and passes after for a truncated PNG and a truncated JPEG, with no `kyc_documents` row written.

**Regression risk:** only undecodable images change (500 to 422). `src/onboarding/kycThumbnail.test.ts` (ADMIN-UPL-1, still "image exceeds 25 MP") and `src/app.test.ts` (real PNG/JPEG/PDF uploads) pass.

Lines: prod +1/-1, test +30/-0
