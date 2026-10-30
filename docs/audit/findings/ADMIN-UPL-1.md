### ADMIN-UPL-1 · KYC upload buffers any number of files and decodes images of any pixel count · H9 · Severity: Medium

**What's wrong:** `POST /v1/merchants/:merchantId/kyc/documents` accepted any number of file parts: the route `toBuffer()`'d every one (up to 8 MiB each) and kept only the last. `generateKycThumbnail` then called `sharp(buffer)` with sharp's default input limit of about 268 MP, so a small PNG could decode to around 1 GiB. The original file was written to disk before the thumbnail was generated, so a rejected image left a file behind.

**Why it happens:** `plugins/multipart.ts:16` registers `@fastify/multipart` with only `limits.fileSize`; its comment says "one file per request is enforced in routes/kyc.ts", but the loop at `routes/kyc.ts:48-55` enforced nothing. File size and pixel count are independent: a single-colour 16384x16384 PNG is about 1 MB, well under the 8 MiB cap. In `onboarding/kyc.ts` the `writeFile` of the original came before `generateKycThumbnail`.

**What it breaks:** Any owner or finance user (and signup is public) can tie up the 0.5 vCPU API decoding huge thumbnails and push the 512 MB container toward an OOM kill for every merchant (H9; the RUNBOOK already records sharp-driven OOMs), or stream many 8 MiB files in one request.

**Why it needed a fix:** The 8 MiB cap was the only guard and does not bound decoded memory, so a single request from any merchant user can take the shared API down.

**Fix:** `apps/api/src/onboarding/kycThumbnail.ts:2,33-39`, `apps/api/src/routes/kyc.ts:50`, `apps/api/src/onboarding/kyc.ts:74`
```diff
+import { UnprocessableEntityError } from "../lib/errors.js";
-  const resized = await sharp(buffer)
+  // ADMIN-UPL-1: file size does not bound decoded pixels; refuse > 25 MP before decoding
+  const resized = await sharp(buffer, { limitInputPixels: 25_000_000 })
     ...
-    .toBuffer();
+    .toBuffer()
+    .catch((err: unknown) => {
+      throw /pixel limit/i.test(String(err)) ? new UnprocessableEntityError("invalid_file_type", "image exceeds 25 MP") : err;
+    });
```
```diff
         if (part.type === "file") {
+          if (buffer) throw new BadRequestError("invalid_request", "exactly one file per request"); // ADMIN-UPL-1
```
```diff
   const fullPath = join(config.kycUploadDir, storageKey);
+  const thumbnail = await generateKycThumbnail(input.buffer, detected); // ADMIN-UPL-1: decode before any disk write
   await mkdir(join(config.kycUploadDir, input.merchantId), { recursive: true });
   ...
-  const thumbnail = await generateKycThumbnail(input.buffer, detected);
```
Commit: this commit. Lines: prod +9/-3, test +60/-1.

**Why this is the smallest correct fix:** `limitInputPixels` makes sharp refuse from the image header, before decoding; 25 MP is well above any phone photo or scanned ID page. Only the pixel-limit error is mapped to the existing 422 `invalid_file_type` response; other sharp errors keep their current behaviour. The one-file rule is a single line at the point the route sees a second file part, before that part is buffered, so at most one file is ever held. Moving the thumbnail call above the first `writeFile` (one line moved) means a rejected image writes nothing. *Why not `limits: { files: 1, parts: 5 }` in the multipart plugin (the lead's suggestion)?* Tried: when the second file arrives in the same chunk, the plugin's limit cleanup destroys the first file's stream while the route is still reading it, and the request fails with `ERR_STREAM_PREMATURE_CLOSE` as a 500 `internal_error` instead of a 413. `FST_PARTS_LIMIT` / `FST_FIELDS_LIMIT` are also not mapped by `plugins/errorHandler.ts`, so they would surface as 500 too. The route check gives a deterministic 400 with no change to the plugin or the error handler.

**Proof:** `ADMIN-UPL-1: a small PNG that decodes to more than 25 MP is rejected with 422, not decoded` (`apps/api/src/onboarding/kycThumbnail.test.ts`, 6000x6000 PNG) fails before with `Missing expected rejection.` and passes after in about 0.4 s. `ADMIN-UPL-1: KYC upload with two file parts is rejected and writes nothing` (`apps/api/src/app.test.ts`) got 201 before and gets 400 after, with no upload directory and no `kyc_documents` row for the merchant. `ADMIN-UPL-1: KYC upload of a PNG over the pixel limit gets 422 and writes nothing` (`apps/api/src/app.test.ts`) got 201 before and gets 422 `invalid_file_type` after, with nothing on disk.

**Regression risk:** Low. Clients sending more than one file per request now get 400; the documented API takes one file. Images over 25 MP get 422. `onboarding/kycThumbnail.test.ts`, `onboarding/fileSignature.test.ts` and `app.test.ts` pass (24/24, three runs). Not fixed: the original file and thumbnail are still written before the DB transaction, so a failed insert can still leave an orphan file (`onboarding/kyc.ts`, the "am" comment there is still accurate); requests with very many small text fields are not capped (each field is bounded by busboy's 1 MB `fieldSize`, and only `documentType` is kept).

**Trap note:** `plugins/multipart.ts:13` "MK: ... one file per request is enforced in routes/kyc.ts" was false; it is true after this fix. `onboarding/kycThumbnail.ts:30` "YA: the 8 MiB upload cap protects us here" was false (file size does not bound pixels); left as-is, next to the new comment. `routes/kyc.ts:37` "am: the thumbnail job is the slow part, not this. ignore the perf ticket" understated the risk. All left in place to keep the diff minimal.
