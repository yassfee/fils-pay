### ADMIN-IMP-3 · "View as merchant" never opens the dashboard: /v1/auth/me ignores the impersonation grant · H3 · Severity: Medium

**Lead:** Team 45 heads-up list (W2), verified by us.
**Category:** Bug

**What's wrong:** In the admin console, "View as merchant" issues a grant and opens the merchant dashboard, and the dashboard immediately redirects to the merchant login page. The support view the feature exists for never appears, for any admin role.

**Why it happens:** The dashboard's route guard (`apps/web/src/auth/RequireDashboardAuth.tsx`, via `DashboardAuthContext.tsx`) asks `GET /v1/auth/me` who is signed in. `/me` (`apps/api/src/routes/auth.ts:252-286`) sits behind the legacy `requireSession` (`auth/middleware.ts:29-43`), which reads only the `fp_sid` cookie. The grant lives in its own `fp_impersonation` cookie (`routes/adminMerchants.ts:347`), which only `requireMerchantAuth` reads (`auth/requireMerchantAuth.ts:85-99`). Every data route therefore accepts the grant, but the one call that decides whether the dashboard renders returns 401.

**What it breaks:** Support cannot see what a merchant sees, which is the reason the grant flow exists (ARCH §8). Operators end up asking merchants for screenshots or credentials. The admin console's "View as merchant" button is visibly broken, on a judged UI surface.

**Why it needed a fix:** H3 concerns admin access done right. After ADMIN-IMP-1 made grants read-only `support`, the safe version of the feature still did not work. A working read-only view removes the reason to share merchant credentials.

**Fix:** `apps/api/src/routes/auth.ts:254-267` (plus 2 import lines at `:9,13`)
```diff
   app.get(
     "/me",
-    { preHandler: requireSession },
     async (request: FastifyRequest) => {
-      const auth = request.auth;
+      const sid = request.cookies[app.config.cookieName];
+      const auth = sid ? await lookupSession(app.db, sid) : null;
       if (!auth) {
-        throw new UnauthorizedError("unauthenticated");
+        // ADMIN-IMP-3 (H3): no merchant session, so fall back to a "view as merchant" grant ... (2 comment lines)
+        const grantToken = request.cookies[app.config.impersonationCookieName];
+        const grant = grantToken ? await lookupImpersonationGrant(app.db, grantToken) : null;
+        if (!grant) throw new UnauthorizedError("unauthenticated");
+        const m = (await app.db.query<…>(`SELECT display_name, onboarding_status FROM merchants WHERE id = $1`, [grant.merchantId])).rows[0]!;
+        return { merchantUserId: null, email: null, role: grant.merchantRole, merchant: { id: grant.merchantId, displayName: m.display_name, onboardingStatus: m.onboarding_status } };
       }
```
Commit: `f71695a`. Lines: prod +11/-3 (2 imports, 2 comments, 7 code), test +38/-0. Follow-up ADMIN-IMP-3b (`57c82d0`, below): prod +2/-0, test +28/-0. Row total: prod +13/-3, test +66/-0.

**Why this is the smallest correct fix:** It uses the same precedence as `requireMerchantAuth`: a live merchant session first (the same `lookupSession` that `requireSession` called, so pending pre-OTP sessions are still refused, see AUTH-1), then the grant. It reuses `lookupImpersonationGrant`, the single definition of a live grant, which already refuses revoked, ended, expired and disabled-admin grants (ADMIN-IMP-2). The response keeps the `/me` shape and reports `role: "support"` (the grant's merchant role since ADMIN-IMP-1) with `merchantUserId`/`email` set to `null`, because no merchant user is signed in, so nothing is attributed to a real user. *Why not switch `/me` to `requireMerchantAuth`?* That would also let API keys call `/me`, which widens access, and its context has no `merchantUserId`. *Why not change `requireSession`?* `/logout` and every `requireRole` chain use it, and they must stay merchant-session only.

**Proof:** `ADMIN-IMP-3: /v1/auth/me answers a live grant as read-only support, and refuses a revoked or expired one` (`apps/api/src/admin/impersonation.audit.test.ts`) fails before the fix with `expected: 200`, `actual: 401`. After the fix it passes and also checks four things: the grant still gets 403 on `POST /v1/merchants/:id/payment-links`; a revoked grant gets 401 on `/me`; an expired grant gets 401; and a garbage token gets 401. Impersonation audit tests pass 5/5. `src/app.test.ts` (signup → login → OTP → `/me` for a real merchant) and `routes/auth.audit.test.ts` pass 13/13. `tsc --noEmit` is clean.

**Regression risk:** A real merchant session gets the same answer as before, from the same lookup. Requests with no cookie, or with a pending or expired session and no grant, still get 401. With an `fp_impersonation` cookie and no merchant session, `/me` now returns 200 read-only `support`, which every other merchant GET route already allowed (`requireMerchantAuth`). The web app shows `me.email` only as text (`DashboardLayout.tsx:50`), so `null` renders as empty next to the `support` role chip.

**Trap note:** `auth/middleware.ts:29` ("legacy — requireMerchantAuth replaced this everywhere except /auth/me") is false: `requireSession` still guards `/logout`, the API-key routes (`routes/apiKeys.ts:36,56,65`) and `routes/businessProfile.ts:51`, and none of them change here. `DashboardAuthContext.tsx:51-53` and `DashboardLayout.tsx:8-10` say impersonation does not exist in the merchant plane, which was never true server-side. Those comments are left as-is.

**Follow-up ADMIN-IMP-3b (ours, merged into this row):** with `/me` fixed, "View as merchant" still landed on React Router's "Unexpected Application Error! 404 Not Found" page; we found this while capturing the evidence for the fix above (lead: the same Team 45 heads-up list, W2). `handleImpersonate` (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:213-214`) opens `WEB_BASE_URL`, the web app's origin with path `/` (`apps/admin/src/api/client.ts:9-10`), and the web router defined only `/pay/:token`, `/dashboard/login` and `/dashboard/*`, with no `errorElement`. A merchant typing the bare dashboard address got the same page. `docs/audit/evidence/ui/view-as-merchant-imp3-only.png` (taken at `9b54967`, the `/me` fix applied, this one not) shows the 404. Fix (`57c82d0`, `apps/web/src/router.tsx:28-29`): one route, `{ path: "/", element: <Navigate to="/dashboard" replace /> }`, plus a comment; `/dashboard` then goes through the existing `RequireDashboardAuth` guard, and the route sits outside the `DashboardAuthProvider` subtree, so `/pay/:token` still makes no auth calls. Rejected: changing the admin link to `${WEB_BASE_URL}/dashboard` (2 lines, leaves the bare URL a 404 for merchants, and gives `//dashboard` with a trailing-slash base URL); an `errorElement` (a nicer 404 that still goes nowhere). Proof: `the web root routes into the dashboard instead of a 404` (`apps/web/src/router.test.ts`) fails before with `Error: No route matches URL "/"` in `router.state.errors` and passes after (last match is the `Navigate`); screenshots `view-as-merchant-{before,after}.png` show it end to end. Side note, left as-is: `MerchantDetailPage.tsx:213` calls `window.open(..., "noopener")`, which always returns `null`, so the "blocked the new tab" fallback link always shows; it is harmless. Lines: prod +2/-0, test +28/-0.
