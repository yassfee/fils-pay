### SEC4b · A KYC document with an Arabic (non-Latin-1) filename cannot be downloaded: 500 · · Severity: Medium

**Lead:** Team 45 heads-up list (SEC4, Content-Disposition part), verified by us.

**What's wrong:** `GET /v1/merchants/:merchantId/kyc/documents/:documentId/file` and `/thumbnail` return 500 `ERR_INVALID_CHAR` ("Invalid character in header content [content-disposition]") for any document whose original filename has a character above U+00FF, for example `سجل تجاري.pdf`. A Bahraini merchant's Arabic-named commercial registration uploads fine and then can never be opened. A filename with `"` produces a malformed header, and one with CR/LF also 500s.

**Why it happens:** `apps/api/src/routes/kyc.ts:100` and `:117` interpolate the stored, client-supplied `file_name` raw into `inline; filename="${file.fileName}"`. Node's `setHeader` only accepts Latin-1 header values and throws on anything else; the throw happens in `writeHead`, after the route returned, so the error handler cannot even send its JSON body (the log shows a second `FST_ERR_REP_INVALID_PAYLOAD_TYPE`).

**What it breaks:** the owner and finance roles cannot view their own uploaded KYC documents; the same request fails every time, so support sees a recurring 500 for every merchant with a non-Latin filename. Onboarding review that relies on the merchant re-checking an upload stalls.

**Why it needed a fix:** Arabic filenames are the normal case for a Bahrain business; a download that can never succeed is a functional failure, and an unhandled header exception is noise for the security review (CR/LF reaching `setHeader`).

**Fix:** `apps/api/src/routes/kyc.ts:100,117`
```diff
-      reply.header("Content-Disposition", `inline; filename="${file.fileName}"`);
+      reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`); // SEC4b: RFC 5987, header values must be Latin-1
```
(both handlers). RFC 6266 / RFC 5987 `filename*` carries the UTF-8 name percent-encoded, so the header is pure ASCII; every current browser decodes it back to the original name.

**Why this is the smallest correct fix:** the same one-expression change at the only two places the header is built. *Why not also keep an ASCII `filename=` fallback?* It needs a transliteration rule and only helps pre-2012 browsers. *Why not sanitise the name at upload?* Stored rows already hold such names and the merchant's original filename is worth keeping. *Why not drop the header?* The browser would then name the file after the document id.

**Proof:** `SEC4b: a KYC document with an Arabic filename downloads with an RFC 5987 filename*` (`apps/api/src/routes/securityHeaders.audit.test.ts`). Before the fix: `expected: 200, actual: 500` with `ERR_INVALID_CHAR`. After: 200 with `inline; filename*=UTF-8''%D8%B3%D8%AC%D9%84...`.

**Regression risk:** the header format changes from `filename="x.pdf"` to `filename*=UTF-8''x.pdf` for ASCII names too; no test or UI parses it (grep), and browsers show the same name. `app.test.ts` (KYC upload flow) passes.

Lines: prod +2/-2, test +16/-1
