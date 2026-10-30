### CW-4 · Merchant webhook URLs can target internal hosts, and delivery follows redirects (SSRF) · none (security; webhook delivery runs inside the platform network) · Severity: High

**What's wrong:**
A merchant (or an API key) can register a webhook endpoint at any host: `https://169.254.169.254/latest/meta-data/`, `https://settlement:8091/internal/run-batch`, `https://10.0.0.7/`, `https://localhost/`. The dispatcher then POSTs signed payloads there from inside the platform network. Even with a public URL, the delivery `fetch` follows 3xx redirects, so a merchant-controlled server can bounce the POST to any internal host.

**Why it happens:**
- `apps/api/src/webhooks/create.ts:15-29` `validateWebhookUrl` only checks the scheme (https in production). It is also used by `update.ts:39`.
- `apps/api/src/webhooks/transport.ts:40-45` calls `fetch` without `redirect`, and the default is `"follow"`.
- Hiding cover: `create.ts:13` "MK: https-only in prod is our SSRF protection" (https does not restrict the host); `transport.ts:37` "YA: create.ts blocks private IPs, SSRF is handled upstream" (it did not); `transport.ts:38` FH/claude note naming the exact redirect fix that was never applied.

**What it breaks:**
Delivery POSTs reach the settlement service's internal endpoints, the cloud metadata service (credential theft) or Postgres-adjacent hosts, and the response body is stored in delivery attempts that the merchant can read. For money: an internal `run-batch` call could close a settlement batch out of schedule.

**Why it needed a fix:**
Webhook endpoints are self-service (merchant session or API key), so any merchant account, or a stolen key, can reach the internal network.

**Fix:**
`create.ts` (production branch only, same gate as the existing https rule):
```diff
-  if (config.nodeEnv === "production" && parsed.protocol !== "https:") {
+  if (config.nodeEnv === "production" && (parsed.protocol !== "https:" ||
+      /^[^.]+\.?$|\.(localhost|internal)\.?$/.test(parsed.hostname) || // CW-4: single-label, IPv6 literal, localhost, internal
+      /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.[\d.]+$/.test(parsed.hostname))) {
```
`transport.ts`:
```diff
         signal: controller.signal,
+        redirect: "manual", // CW-4: a 3xx is a failed delivery, never followed
```
Lines: prod +4/-1. Test +69 (new `create.audit.test.ts`).

How the host rule works: the WHATWG URL parser has already normalised the hostname (`https://2130706433/` becomes `127.0.0.1`, IPv4-mapped IPv6 becomes `[::ffff:a00:7]`). Rule 1 rejects any host with no dot (single-label service names such as `settlement`, `postgres`, `api`, `localhost`, and every bracketed IPv6 literal including `[::1]`), plus `*.localhost` and `*.internal` (e.g. `metadata.google.internal`). Rule 2 rejects dotted-quad IPv4 in 0/8, 10/8, 127/8, 169.254/16, 192.168/16, 172.16/12 and 100.64/10. Rule 2 requires an all-digit address after the prefix, so `10.example.com` stays allowed.

Gating: the check sits inside the existing `nodeEnv === "production"` branch, following the file's own pattern (http is allowed outside production, `create.ts:9-11`). Dev and test keep using `http://localhost` receivers, which is why the earlier localhost block was removed (`create.ts:14`). `redirect: "manual"` applies everywhere: with undici the 3xx is returned as-is, so the dispatcher records a non-2xx failed attempt.

**Why smallest:**
Both checks sit at the single choke points: `validateWebhookUrl` is used by both create and update, and `createFetchTransport` is the only real transport. Rejected: a new `isForbiddenHost` helper (more lines, and the rules ban new helpers); DNS resolution and IP pinning at delivery time (closes DNS rebinding but needs about 30+ lines and a custom dispatcher/agent); blocking in all environments (breaks the local receivers used by dev and by `dispatcher.test.ts` / `testSend.test.ts`).

**Proof:**
Before: `CW-4: production rejects ...` failed with `Missing expected exception: https://169.254.169.254/latest/meta-data/`, and `CW-4: delivery does not follow a redirect` failed with `expected: 0, actual: 1` (the internal server was hit through a 307). After: 2/2 pass. Neighbours green: `routes/webhooks.test.ts`, `dispatcher.test.ts`, `testSend.test.ts`, `refundWebhook.audit.test.ts` (26/26).

**Regression risk:**
Low. Production merchants using a raw IPv6 literal or a bare single-label host are refused at create/update (neither is a valid public webhook host). Endpoints registered before the fix are not re-validated. Residual risk: a public DNS name that resolves to a private IP (DNS rebinding) passes the create-time check; this needs resolve-and-pin at delivery and is left for a follow-up.

**Trap note:**
Three comments ("https-only is our SSRF protection", "create.ts blocks private IPs", the unapplied redirect advice) each claim the protection exists elsewhere.
