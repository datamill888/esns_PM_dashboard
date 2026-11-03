import { describe, expect, it } from "vitest";
import { bindParams, escapeLiteral } from "../src/server/incorta";
import { addDays, sundayOnOrBefore, weekEndingFor, weeksBetween } from "../src/lib/dates";

describe("bindParams", () => {
  it("escapes quotes and binds in one pass", () => {
    expect(bindParams("a = $1 AND b = $2", ["O'Brien", "$1"])).toBe("a = 'O''Brien' AND b = '$1'");
  });
  it("handles $10 vs $1", () => {
    const p = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(bindParams("$1,$10", p)).toBe("1,10");
  });
  it("binds null, booleans, arrays", () => {
    expect(bindParams("$1 $2 $3", [null, true, ["a", 2]])).toBe("NULL TRUE ARRAY['a', 2]");
  });
  it("uses E'' for backslashes", () => {
    expect(escapeLiteral("a\\b")).toBe(" E'a\\\\b'");
  });
  it("rejects non-finite numbers", () => {
    expect(() => bindParams("$1", [Number.NaN])).toThrow();
  });
});

describe("dates", () => {
  it("past Sunday", () => {
    expect(sundayOnOrBefore("2026-11-03")).toBe("2026-11-01");
    expect(sundayOnOrBefore("2026-11-01")).toBe("2026-11-01");
  });
  it("week ending is the Sunday on/after", () => {
    expect(weekEndingFor("2026-11-03")).toBe("2026-11-08");
  });
  it("13-week window", () => {
    const w = weeksBetween(addDays("2026-11-01", -12 * 7), "2026-11-01");
    expect(w).toHaveLength(13);
    expect(w[0]).toBe("2026-08-09");
    expect(w[12]).toBe("2026-11-01");
  });
});
