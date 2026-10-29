import assert from "node:assert/strict";
import test from "node:test";
import { parseAdjustmentAmountFils } from "./adjustmentCsvParsing.js";

// IMP-1 / case file F7: 1 BD = 1000 fils (ADR-0001). "4.75" BD must post 4750 fils, not 475.
test("CSV import amounts are BD with 3 decimals: x1000, signed, no silent truncation", () => {
  assert.equal(parseAdjustmentAmountFils("4.75"), 4750);
  assert.equal(parseAdjustmentAmountFils("4.755"), 4755);
  assert.equal(parseAdjustmentAmountFils("-3.50"), -3500);
  assert.equal(parseAdjustmentAmountFils("12"), 12000);
  assert.throws(() => parseAdjustmentAmountFils("4.7555"), /could not parse amount/);
});
