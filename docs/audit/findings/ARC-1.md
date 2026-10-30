### ARC-1 · Webhook delivery archive loads an unbounded date range into one in-memory JSON string · H9 · Severity: Medium

Duplicates of this lead: `ADMIN-ARCH-1` (admin-rbac) and `CW-13` (callbacks-webhooks) describe the same code path; this note covers all three.

**What's wrong:** `createWebhookDeliveryArchive` selected every delivery of the endpoint in `[from, to)` with no `LIMIT`, mapped the rows (with their JSONB payloads) into an array and `JSON.stringify`'d the lot into one TEXT bind parameter. `replayWebhookDeliveryArchive` reads that value back with `JSON.parse` and replays every entry inside one transaction. Nothing bounds the size of the range.

**Why it happens:** The archive is designed as one complete document per range (doc comment at `webhooks/archiveReplay.ts:20-27`: "No row cap"), and neither the route (`routes/adminMerchants.ts:256-289`, any admin session) nor the function checks how many deliveries the range holds. During create the pg result rows, the entries array, the JSON string and the bind buffer all live in memory at once.

**What it breaks:** Archiving a long range of an active endpoint (for example a year at ~200k deliveries x ~1.5 KB, about 300 MB of JSON) exceeds the 512 MB API container and kills the API for every merchant (H9). Replay of such an archive repeats the cost and holds one transaction open for the whole run.

**Why it needed a fix:** Any admin role, including support, can take the API down with a date range, and the archive's own "complete record" contract rules out silently truncating it.

**Fix:** `apps/api/src/webhooks/archiveReplay.ts:4,30,51-56`
```diff
-import { ConflictError, NotFoundError } from "../lib/errors.js";
+import { ConflictError, NotFoundError, UnprocessableEntityError } from "../lib/errors.js";
-  input: { merchantId: string; endpointId: string; adminUserId: string; from: Date; to: Date },
+  input: { merchantId: string; endpointId: string; adminUserId: string; from: Date; to: Date; maxDeliveries?: number },
-        ORDER BY created_at ASC`,
-      [input.endpointId, input.from, input.to],
+        ORDER BY created_at ASC
+        LIMIT $4`,
+      [input.endpointId, input.from, input.to, (input.maxDeliveries ?? 5000) + 1],
+    // ARC-1: refuse (never truncate) a range too large to hold as one in-memory JSON document
+    if (rows.rows.length > (input.maxDeliveries ?? 5000)) throw new UnprocessableEntityError("archive_range_too_large");
```
Commit: this commit. Lines: prod +7/-4, test +20/-1.

**Why this is the smallest correct fix:** Fetching at most cap+1 rows and refusing when the extra row exists bounds memory in the single query that loads the data, with no extra round trip. The archive stays complete-or-nothing, and since replay can only read archives created through this path, replay is bounded too (at most 5,000 entries). The route passes no `maxDeliveries`, so production always uses 5,000; the optional field only lets the test use a small cap. A 422 `archive_range_too_large` tells the admin to pick a narrower window; the existing `AppError` handler maps it. *Why not a separate `count(*)` first (the lead's suggestion)?* It is one more query for the same result. *Why not truncate at the cap?* It breaks the archive's completeness contract. *Why not page into a child table?* A schema change and a rewrite of both functions, far beyond a minimal fix.

**Proof:** `ARC-1: refuses a range with more deliveries than the cap and writes no archive` (`apps/api/src/webhooks/archiveReplay.test.ts`) inserts 3 deliveries and archives with `maxDeliveries: 2`. Before the fix it fails with `Missing expected rejection.` (the archive was written). After the fix it rejects with 422 `archive_range_too_large`, no `webhook_delivery_archives` row exists for the endpoint, and the same range at a cap of 3 is archived with `deliveryCount = 3`.

**Regression risk:** Admins archiving more than 5,000 deliveries in one range now get 422 and must split the range. Archives created before the fix with more entries can still be replayed unbounded; none exist in a fresh deployment. `webhooks/archiveReplay.test.ts` passes 5/5 and `routes/admin.test.ts` passes 41/41.

**Trap note:** `docs/ADMIN.md:100-101` ("Archives are written in pages of 1000 deliveries, so any range is fine") and `db/migrations/0068_webhook_delivery_archives.sql:35-36` ("AM: archives are built in 1000-row pages and stored compressed") are false: there was no paging or compression. Left as-is (docs and an applied migration). The doc comment's "No row cap" now holds only up to 5,000; the refusal keeps its completeness intent.
