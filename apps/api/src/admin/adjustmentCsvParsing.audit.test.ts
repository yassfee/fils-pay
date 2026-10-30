import assert from "node:assert/strict";
import test from "node:test";
import { parseAdjustmentAmountFils, parseAdjustmentCsv } from "./adjustmentCsvParsing.js";

// IMP-1 / case file F7: 1 BD = 1000 fils (ADR-0001). "4.75" BD must post 4750 fils, not 475.
test("CSV import amounts are BD with 3 decimals: x1000, signed, no silent truncation", () => {
  assert.equal(parseAdjustmentAmountFils("4.75"), 4750);
  assert.equal(parseAdjustmentAmountFils("4.755"), 4755);
  assert.equal(parseAdjustmentAmountFils("-3.50"), -3500);
  assert.equal(parseAdjustmentAmountFils("12"), 12000);
  assert.throws(() => parseAdjustmentAmountFils("4.7555"), /could not parse amount/);
});

// IMP-3 / case file F7: an unquoted thousands separator splits the amount. "1,250.000" BD must not post 1.000 BD.
test("IMP-3: an amount split by a thousands separator is rejected, not read as its first digit group", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.throws(() => parseAdjustmentCsv(`merchantId,amount,reason\n${id},1,250.000,refund March\n`), /must not contain commas/);
  assert.throws(() => parseAdjustmentCsv(`merchantId,amount,reason\n${id},1,250.000\n`), /must not contain commas/);
  assert.throws(() => parseAdjustmentCsv(`merchantId,amount,reason\n${id},-12,500\n`), /must not contain commas/);
  assert.deepEqual(parseAdjustmentCsv(`merchantId,amount,reason\n${id},1250.000,refund March\n`), [
    { merchantId: id, amount: "1250.000", reason: "refund March" },
  ]);
});

// Q2 / case file F7: a decimal comma "4,75" splits into amount "4" + reason "75" and posted 4.000 BD instead of 4.750.
test("Q2: a decimal-comma amount is rejected, not read as its integer part", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.throws(() => parseAdjustmentCsv(`merchantId,amount,reason\n${id},4,75\n`), /must not contain commas/);
  assert.throws(() => parseAdjustmentCsv(`merchantId,amount,reason\n${id},-4,5\n`), /must not contain commas/);
  assert.deepEqual(parseAdjustmentCsv(`merchantId,amount,reason\n${id},4.75,2026 true-up\n`), [
    { merchantId: id, amount: "4.75", reason: "2026 true-up" },
  ]);
});
