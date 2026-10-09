import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const data = path.join(import.meta.dirname, "../../public/data");

test("soccer summary.json stays schemaVersion 1 without a sport key", () => {
  const summary = JSON.parse(readFileSync(path.join(data, "summary.json"), "utf8"));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.sport, undefined);
  assert.ok(Array.isArray(summary.teams));
  assert.ok(summary.teams.length > 0);
});

test("each US sport file names itself and keeps relocated clubs on one franchise", () => {
  for (const sport of ["nfl", "nba", "mlb"]) {
    const summary = JSON.parse(readFileSync(path.join(data, sport, "summary.json"), "utf8"));
    assert.equal(summary.schemaVersion, 1);
    assert.equal(summary.sport, sport);
    assert.ok(summary.coverage.length > 0);
    assert.ok(summary.teams.length >= 30);
  }
  const nfl = JSON.parse(readFileSync(path.join(data, "nfl", "summary.json"), "utf8"));
  const abbrevs = nfl.teams.map((team: { abbrev: string }) => team.abbrev);
  assert.ok(abbrevs.includes("LV"));
  assert.ok(abbrevs.includes("LAC"));
  assert.ok(abbrevs.includes("LA"));
  assert.equal(abbrevs.includes("OAK"), false);
  assert.equal(abbrevs.includes("SD"), false);
  assert.equal(abbrevs.includes("STL"), false);
  const mlb = JSON.parse(readFileSync(path.join(data, "mlb", "summary.json"), "utf8"));
  const mlbAbbrevs = mlb.teams.map((team: { abbrev: string }) => team.abbrev);
  assert.ok(mlbAbbrevs.includes("ATH"));
  assert.ok(mlbAbbrevs.includes("ARI"));
  assert.equal(mlbAbbrevs.includes("OAK"), false);
  assert.equal(mlbAbbrevs.includes("AZ"), false);
});
