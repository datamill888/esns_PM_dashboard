import { describe, expect, it } from "bun:test";
import { addDays, sundayOnOrBefore, weekEndingFor, weeksBetween } from "../src/lib/dates";

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
