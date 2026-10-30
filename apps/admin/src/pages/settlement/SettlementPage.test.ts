import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// UI-SETTLE-1: the business day runs midnight to midnight Asia/Bahrain (case file p.1, G1), so the
// run-batch form must default to yesterday's Bahrain date, whatever the browser's timezone.
// Loaded through Vite because the page's API client reads import.meta.env.
test("yesterdayIso is the Bahrain calendar day before today", async () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const vite = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { yesterdayIso } = (await vite.ssrLoadModule("/src/pages/settlement/SettlementPage.tsx")) as { yesterdayIso: () => string };
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-29T22:30:00Z") }); // 01:30 on 30 Oct in Bahrain
    assert.equal(yesterdayIso(), "2026-10-29");
    mock.timers.setTime(Date.parse("2026-10-30T20:59:00Z")); // 23:59 on 30 Oct in Bahrain
    assert.equal(yesterdayIso(), "2026-10-29");
  } finally {
    mock.timers.reset();
    await vite.close();
  }
});
