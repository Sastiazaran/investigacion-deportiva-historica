import assert from "node:assert/strict";
import test from "node:test";
import {
  decimalToAmerican,
  formatComboOdds,
  formatDisplayedOdds,
  formatOddsBucketLabel,
} from "./odds-format.ts";

test("even money and the favorite/underdog split", () => {
  assert.equal(decimalToAmerican(2), "+100");
  assert.equal(decimalToAmerican(2.0), "+100");
  assert.equal(decimalToAmerican(1.5), "-200");
  assert.equal(decimalToAmerican(3), "+200");
  assert.equal(decimalToAmerican(1.2), "-500");
  assert.equal(decimalToAmerican(1.25), "-400");
  assert.equal(decimalToAmerican(2.5), "+150");
});

test("rounds to the nearest integer, halves away from zero", () => {
  // 100 / 0.7 = 142.857... -> -143
  assert.equal(decimalToAmerican(1.7), "-143");
  // (2.505 - 1) * 100 = 150.5 -> +151
  assert.equal(decimalToAmerican(2.505), "+151");
  // 100 / (1.6644518272 - 1) ≈ 150.5 -> -151
  assert.equal(decimalToAmerican(1 + 100 / 150.5), "-151");
});

test("invalid prices render as an em dash", () => {
  assert.equal(decimalToAmerican(null), "—");
  assert.equal(decimalToAmerican(undefined), "—");
  assert.equal(decimalToAmerican(Number.NaN), "—");
  assert.equal(decimalToAmerican(Number.POSITIVE_INFINITY), "—");
  assert.equal(decimalToAmerican(1), "—");
  assert.equal(decimalToAmerican(0.99), "—");
  assert.equal(decimalToAmerican(0), "—");
  assert.equal(decimalToAmerican(-3), "—");
  assert.equal(formatDisplayedOdds(null, "decimal"), "—");
  assert.equal(formatDisplayedOdds(null, "american"), "—");
});

test("decimal display stays a two-place price and does not convert", () => {
  assert.equal(formatDisplayedOdds(1.3289, "decimal"), "1.33");
  assert.equal(formatDisplayedOdds(1.3289, "american"), "-304");
});

test("favorite bucket 1.20–1.25 becomes -500 to -400", () => {
  assert.equal(formatOddsBucketLabel("1.20–1.25", 1.2, 1.25, "decimal"), "1.20–1.25");
  assert.equal(formatOddsBucketLabel("1.20–1.25", 1.2, 1.25, "american"), "-500 to -400");
  assert.equal(formatOddsBucketLabel("2.00–2.50", 2, 2.5, "american"), "+100 to +150");
  assert.equal(formatOddsBucketLabel("< 1.20", 1, 1.2, "american"), "< -500");
  assert.equal(formatOddsBucketLabel("10.00+", 10, null, "american"), "+900+");
});

test("parlay odds convert the decimal price and leave the decimal label alone", () => {
  assert.equal(formatComboOdds(40, "2.5:1", "decimal"), "2.5:1");
  assert.equal(formatComboOdds(40, "2.5:1", "american"), "+150");
  assert.equal(formatComboOdds(0, "—", "american"), "—");
});
