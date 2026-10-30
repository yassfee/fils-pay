import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// UI-1: the credit form's default effective date must be today's Asia/Bahrain business day (case file p.1,
// G1; CRED-1 rejects a date after Bahrain's today), whatever timezone the operator's browser runs in.
// Loaded through Vite because the page's API client reads import.meta.env.
test("UI-1: todayIso is the Bahrain calendar day, not the browser's", async () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const vite = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  const savedTz = process.env.TZ;
  try {
    const { todayIso } = (await vite.ssrLoadModule("/src/pages/merchants/MerchantDetailPage.tsx")) as { todayIso: () => string };
    process.env.TZ = "UTC"; // a browser behind Bahrain
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-29T22:30:00Z") }); // 01:30 on 30 Oct in Bahrain
    assert.equal(todayIso(), "2026-10-30");
    process.env.TZ = "Asia/Dubai"; // a browser ahead of Bahrain (UTC+4)
    mock.timers.setTime(Date.parse("2026-10-30T20:30:00Z")); // 23:30 on 30 Oct in Bahrain, 00:30 on 31 Oct in Dubai
    assert.equal(todayIso(), "2026-10-30");
  } finally {
    mock.timers.reset();
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    await vite.close();
  }
});
