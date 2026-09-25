import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSequentialCode } from "../src/utils/sequentialCode";

test("compares numbers, not text: MLD-99 then MLD-100 → MLD-101 (the old code handed out MLD-100 again)", () => {
  assert.equal(nextSequentialCode("MLD-", ["MLD-98", "MLD-99", "MLD-100"]), "MLD-101");
  assert.equal(nextSequentialCode("MLD-", ["MLD-100", "MLD-99"]), "MLD-101");
});
test("zero-pads to two digits and starts at 01", () => {
  assert.equal(nextSequentialCode("CLI-", []), "CLI-01");
  assert.equal(nextSequentialCode("CLI-", ["CLI-08"]), "CLI-09");
  assert.equal(nextSequentialCode("CLI-", ["CLI-09"]), "CLI-10");
});
test("employee style: floor of 100, no padding", () => {
  assert.equal(nextSequentialCode("EMP-", [], { floor: 100, pad: 0 }), "EMP-101");
  assert.equal(nextSequentialCode("EMP-", ["EMP-104", "EMP-999", "EMP-1000"], { floor: 100, pad: 0 }), "EMP-1001");
});
test("ignores codes that aren't PREFIX-<number>, so one odd row can't poison the sequence", () => {
  assert.equal(nextSequentialCode("CLI-", ["CLI-NaN", "T-000-mine", "CLI-05", "OTHER-99"]), "CLI-06");
});
