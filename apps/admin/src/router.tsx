import { createBrowserRouter, Navigate } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout.js";
import { RequireAdminAuth } from "./components/RequireAdminAuth.js";
import { AdjustmentImportPage } from "./pages/adjustments/AdjustmentImportPage.js";
import { CreditsPage } from "./pages/credits/CreditsPage.js";
import { LoginPage } from "./pages/login/LoginPage.js";
import { MerchantListPage } from "./pages/merchants/MerchantListPage.js";
import { MerchantDetailPage } from "./pages/merchants/MerchantDetailPage.js";
import { SettlementPage } from "./pages/settlement/SettlementPage.js";
import { WebhookReplayPage } from "./pages/webhooks/WebhookReplayPage.js";

// ROUTER-404: an unknown URL or a page that throws gets a plain page, not React Router's developer screen.
const crashed = <main className="admin-main"><h1>Something went wrong</h1><p>Reload the page to try again.</p></main>;

// MK: /v2 routes live behind VITE_ADMIN_V2 — see the admin v2 doc
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage />, errorElement: crashed },
  {
    // Everything below the login screen shares one shell and one guard. The
    // guard is navigation only — the API re-checks the admin session on
    // every request these pages make.
    element: (
      <RequireAdminAuth>
        <AdminLayout />
      </RequireAdminAuth>
    ),
    errorElement: crashed,
    children: [
      { path: "/", element: <Navigate to="/merchants" replace /> },
      { path: "/merchants", element: <MerchantListPage /> },
      { path: "/merchants/:id", element: <MerchantDetailPage /> },
      { path: "/credits", element: <CreditsPage /> },
      { path: "/settlement", element: <SettlementPage /> },
      { path: "/adjustment-imports", element: <AdjustmentImportPage /> },
      { path: "/webhooks", element: <WebhookReplayPage /> },
      { path: "/webhooks/:merchantId", element: <WebhookReplayPage /> },
      { path: "*", element: <><h1>Page not found</h1><p><a href="/merchants">Go to merchants</a></p></> },
    ],
  },
]);
