### ADMIN-KYC-2 · The PDF-only KYC rule checks the filename, so a renamed JPEG is accepted as a commercial registration · H3 · Severity: Low

**What's wrong:** `commercial_registration` and `bank_letter` documents must be PDFs. The rule checked only that the client-supplied file name ended in `.pdf`. A phone photo (JPEG) named `CR-2026.pdf` was accepted as a commercial registration and stored as `image/jpeg`, ready for an admin to approve KYC on it.

**Why it happens:** `apps/api/src/onboarding/kyc.ts:67` (before the fix) was `PDF_ONLY_DOCUMENT_TYPES.includes(input.documentType) && !input.fileName.toLowerCase().endsWith(".pdf")`. It ignored `detected`, which the function had already computed from the magic bytes at `kyc.ts:50`. This contradicts the file's own contract: the doc comment at `kyc.ts:16` says the fileName is "Informational only; never used for validation", the function doc at `kyc.ts:35` says it "Validates the upload from its own bytes (never the client-supplied filename …)", and `db/migrations/0015` says `mime_type` is always the type detected from the bytes. The `MK` note at `kyc.ts:57` ("detectFileType already rejects non-pdf bytes for these doc types. fixed in FP-231") is false: `detectFileType` (`fileSignature.ts:25`) takes no document type and accepts JPEG and PNG for every document.

**What it breaks:** A merchant uploads a JPEG photo named `CR-2026.pdf` as `commercial_registration`. The API answers 201, writes `<sha256>.jpg`, records `mime_type = image/jpeg`, and moves onboarding to `under_review`. The registry-issued PDF that the KYC policy requires was never supplied, and the reviewer's queue shows a document that passed a rule it does not meet.

**Why it needed a fix:** Admin KYC review (H3: admin-side controls) relies on this gate. A KYC document-format control that the client can bypass by renaming a file is not a control, and the code's own documented contract is "validated by detected content type".

**Fix:** `apps/api/src/onboarding/kyc.ts:67-68`
```diff
-  if (PDF_ONLY_DOCUMENT_TYPES.includes(input.documentType) && !input.fileName.toLowerCase().endsWith(".pdf")) {
+  // ADMIN-KYC-2: the name alone let a renamed JPEG through; the detected bytes must be a PDF too
+  if (PDF_ONLY_DOCUMENT_TYPES.includes(input.documentType) && (detected !== "pdf" || !input.fileName.toLowerCase().endsWith(".pdf"))) {
```

**Why this is the smallest correct fix:** This is one condition at the single gate, reusing the already-computed `detected`. *Why not replace the filename check entirely, as the lead proposed (`detected !== "pdf"` only)?* The existing contract test `KYC upload rejects a commercial_registration submitted as a non-PDF filename` (`app.test.ts:274`) uploads real `%PDF` bytes named `registration.docx` and requires 422 `document_must_be_pdf`. Dropping the name check would break that pinned behaviour. Keeping both checks is strictly stricter, so every previously rejected upload is still rejected and the bypass closes. *Why not change `detectFileType`?* It is shared by all document types and has no document-type input. Error code, status and message are unchanged.

**Proof:** `ADMIN-KYC-2: a JPEG renamed CR-2026.pdf is rejected as a commercial_registration` (`apps/api/src/app.test.ts`) uploads a real 8×8 JPEG (made with `sharp`) through the multipart route.
Before: `not ok 1 ... expected: 422, actual: 201`.
After: `ok`. `app.test.ts` passes 11/11 (including the existing `.docx` rejection and real-PDF acceptance tests), `fileSignature.test.ts` and `kycThumbnail.test.ts` pass, and `tsc --noEmit` is clean.

**Regression risk:** Low. The only uploads newly rejected are non-PDF bytes declared as `commercial_registration` or `bank_letter`, which the policy forbids. `owner_id` and `proof_of_address` still accept JPEG and PNG.

Lines: prod +2/-1, test +21/-0
