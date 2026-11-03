/**
 * Cost types shown as rows in the Cost Performance Tracker (same rows as the
 * original Tab 4 input app). Descriptions from Penta.COST_TYPE.
 */
export const DEFAULT_COST_TYPES: { code: string; descr: string }[] = [
  { code: "BL", descr: "Direct Labor" },
  { code: "BS", descr: "Staff Labor" },
  { code: "BT1", descr: "Travel & Living: Non-Meal" },
  { code: "BM", descr: "Materials (Permanent Plant)" },
  { code: "BC", descr: "Subcontracted Services" },
];

/**
 * When comparing tracker inputs to Penta actuals, burden and variant codes are
 * rolled into their parent row (BLB/BSB carry actuals but never an EST budget).
 */
export const ACTUALS_ROLLUP: Record<string, string> = {
  BLB: "BL",
  BSB: "BS",
  BT2: "BT1",
  BT3: "BT1",
  BC1: "BC",
  BC2: "BC",
  BC3: "BC",
  BC4: "BC",
};
