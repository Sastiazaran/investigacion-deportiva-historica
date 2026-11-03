import assert from "node:assert/strict";
import test from "node:test";
import {
  PRICE_MARGIN,
  beatsMarket,
  breakTies,
  devigThree,
  dixonColesTau,
  halfLine,
  marketsFromMatrix,
  marketsFromNormal,
  poissonPmf,
  price,
  scoreMatrix,
  settleBets,
} from "./sim-markets.ts";

function close(actual: number, expected: number, tol = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tol, `${actual} vs ${expected}`);
}

test("a fair price is the inverse probability and the minimum adds 5 percent", () => {
  assert.equal(PRICE_MARGIN, 1.05);
  const priced = price(0.5);
  close(priced.fairDecimal ?? 0, 2);
  close(priced.minimumDecimal ?? 0, 2.1);
  assert.equal(price(0).fairDecimal, null);
});

test("Dixon-Coles makes a 0-0 more likely when rho is negative", () => {
  const home = 1.4;
  const away = 1.1;
  assert.ok(dixonColesTau(0, 0, home, away, -0.1) > 1);
  assert.ok(dixonColesTau(1, 1, home, away, -0.1) > 1);
  const plain = scoreMatrix(home, away, 0, 6);
  const adjusted = scoreMatrix(home, away, -0.1, 6);
  assert.ok(adjusted[0][0] > plain[0][0]);
  const sum = adjusted.reduce((total, row) => total + row.reduce((inner, value) => inner + value, 0), 0);
  close(sum, 1, 1e-9);
  close(poissonPmf(0, home), Math.exp(-home), 1e-12);
});

test("a home win is the home -0.5 line, and 2.5 is the over", () => {
  const grid = scoreMatrix(1.6, 0.9, -0.05, 8);
  const output = marketsFromMatrix(grid, 0.5, 2.5, "goals");
  close(output.home.probability + output.draw.probability + output.away.probability, 1, 1e-8);
  close(output.spread.home.probability, output.home.probability, 1e-6);
  assert.ok(output.home.probability > output.away.probability);
  assert.ok((output.total.over.fairDecimal ?? 0) > 1);
  assert.equal(output.spread.push, 0);
  assert.equal(output.total.push, 0);
});

test("extra innings remove baseball ties and hand the home team its share", () => {
  const broken = breakTies(
    [
      [0.2, 0.1, 0],
      [0.3, 0.4, 0],
      [0, 0, 0],
    ],
    0.6,
  );
  close(broken[0][0], 0);
  close(broken[1][1], 0);
  close(broken[1][0], 0.3 + 0.2 * 0.6);
  close(broken[0][1], 0.1 + 0.2 * 0.4);
  close(broken[2][1], 0.4 * 0.6);
  const output = marketsFromMatrix(broken, 1.5, 1.5, "runs");
  close(output.draw.probability, 0, 1e-12);
});

test("a favorite's normal margin covers a short spread more often than not", () => {
  const output = marketsFromNormal(27, 20, 13, 12, 3.5, 44.5);
  assert.ok(output.home.probability > output.away.probability);
  assert.ok(output.spread.home.probability > 0.55);
  assert.ok(output.draw.probability > 0);
  assert.ok(output.draw.probability < 0.08);
  close(output.meanMargin, 7);
  assert.equal(halfLine(3), 3.5);
  assert.equal(halfLine(3.2), 3.5);
  assert.equal(halfLine(-1.2), -1.5);
});

test("the 5 percent rule skips a price inside the minimum and de-vig is a probability", () => {
  const passed = settleBets([{ probability: 0.5, odds: 2.2, won: true }]);
  assert.equal(passed.bets, 1);
  close(passed.profit, 1.2);
  const skipped = settleBets([{ probability: 0.5, odds: 2.05, won: true }]);
  assert.equal(skipped.bets, 0);
  const market = devigThree(2, 3.4, 3.6);
  close(market.home + market.draw + market.away, 1, 1e-12);
  assert.equal(beatsMarket(0.2, 0.21, 0.6, 0.61), true);
  assert.equal(beatsMarket(0.2, 0.19, 0.6, 0.61), false);
});
