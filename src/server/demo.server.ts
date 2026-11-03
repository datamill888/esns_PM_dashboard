/**
 * Deterministic sample data for LOCAL runs with no Incorta endpoint
 * (INCORTA_PG_URL unset). Every screen labels this as demo data. Never used on
 * the platform, where the app always reads live Incorta data.
 */
import { addDays, daysBetween, sundayOnOrBefore, weeksBetween, type ISODate } from "@/lib/dates";
import type {
  CommitmentRow,
  CostCodePerfRow,
  CostTypePerfRow,
  InvoiceRow,
  JobHeader,
  JobOption,
  Overview,
  WeeklyPerfRow,
} from "@/lib/types";
import { DEFAULT_COST_TYPES } from "./costTypes";

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export const DEMO_JOBS: JobOption[] = [
  { jobId: "JOB-001", name: "Highway 45 Bridge Reconstruction" },
  { jobId: "JOB-002", name: "Riverside Water Treatment Upgrade" },
  { jobId: "JOB-003", name: "North Campus Utility Tunnel" },
];

const JOB_START: Record<string, ISODate> = {
  "JOB-001": "2026-03-01",
  "JOB-002": "2025-11-02",
  "JOB-003": "2026-06-07",
};

const COST_CODES = [
  ["01-100", "Mobilization"],
  ["02-200", "Demolition"],
  ["03-300", "Concrete Structures"],
  ["05-120", "Structural Steel"],
  ["31-230", "Earthwork"],
  ["32-120", "Paving"],
  ["33-400", "Storm Drainage"],
] as const;

function weeklyActuals(jobId: string, asOf: ISODate) {
  const start = JOB_START[jobId] ?? "2026-01-04";
  const weeks = weeksBetween(start, sundayOnOrBefore(asOf));
  const r = rng(jobId);
  return weeks.map((w, i) => {
    const ramp = Math.min(1, (i + 1) / 8);
    const byType = DEFAULT_COST_TYPES.map((ct, k) => ({
      costType: ct.code,
      amt: Math.round((8000 + 30000 * r()) * ramp * (1 - k * 0.12)),
    }));
    return { weekEnding: w, byType };
  });
}

export function demoHeader(jobId: string, asOf: ISODate): JobHeader | null {
  const job = DEMO_JOBS.find((j) => j.jobId === jobId);
  if (!job) return null;
  return {
    jobId,
    name: job.name,
    projectManager: "Jordan Ellis",
    executive: "Casey Morgan",
    contractRef: `PO-${jobId.slice(-3)}-7781`,
    contractType: "Lump Sum",
    market: "Transportation",
    workType: "Heavy Civil",
    contractStatus: "Active",
    jobDate: JOB_START[jobId] ?? null,
    latestWeekEnding: sundayOnOrBefore(asOf),
  };
}

export function demoOverview(jobId: string, asOf: ISODate): Overview {
  const header = demoHeader(jobId, asOf);
  const weeks = weeklyActuals(jobId, asOf);
  const cur = sundayOnOrBefore(asOf);
  const prev = addDays(cur, -7);
  const r = rng(`${jobId}:budget`);

  const weekly: WeeklyPerfRow[] = DEFAULT_COST_TYPES.map((ct) => ({
    costType: ct.code,
    costTypeDescr: ct.descr,
    periodSpend: weeks.find((w) => w.weekEnding === cur)?.byType.find((b) => b.costType === ct.code)?.amt ?? 0,
    lastPeriodSpend: weeks.find((w) => w.weekEnding === prev)?.byType.find((b) => b.costType === ct.code)?.amt ?? 0,
  }));

  const byCostType: CostTypePerfRow[] = DEFAULT_COST_TYPES.map((ct) => {
    const spend = weeks.reduce((s, w) => s + (w.byType.find((b) => b.costType === ct.code)?.amt ?? 0), 0);
    return { costType: ct.code, costTypeDescr: ct.descr, spendToDate: spend, budget: Math.round(spend * (1.05 + r() * 0.6)) };
  });

  const total = byCostType.reduce((s, x) => s + x.spendToDate, 0);
  const totalBudget = byCostType.reduce((s, x) => s + x.budget, 0);
  const shares = COST_CODES.map(() => 0.4 + r());
  const shareSum = shares.reduce((a, b) => a + b, 0);
  const byCostCode: CostCodePerfRow[] = COST_CODES.map(([cc, d], i) => ({
    costCode: cc,
    costCodeDescr: d,
    spendToDate: Math.round((total * shares[i]) / shareSum),
    budget: Math.round(((totalBudget * shares[i]) / shareSum) * (0.85 + r() * 0.35)),
  }));

  return {
    source: "demo",
    header,
    weekly,
    byCostType,
    byCostCode,
    trend: weeks.map((w) => ({ weekEnding: w.weekEnding, spend: w.byType.reduce((s, b) => s + b.amt, 0) })),
    daysElapsed: header?.jobDate ? Math.max(1, daysBetween(header.jobDate, asOf)) : 1,
  };
}

export function demoInvoices(jobId: string, asOf: ISODate): InvoiceRow[] {
  const start = JOB_START[jobId] ?? "2026-01-04";
  const r = rng(`${jobId}:ar`);
  const out: InvoiceRow[] = [];
  let d = addDays(start, 30);
  let n = 1;
  while (d <= asOf) {
    const amount = Math.round(120000 + r() * 260000);
    const paid = addDays(d, 25 + Math.floor(r() * 30));
    const isPaid = paid <= asOf;
    out.push({
      description: `Progress billing #${n}`,
      invoiceNum: `${jobId.slice(-3)}-${String(n).padStart(4, "0")}`,
      invoiceDate: d,
      receivedDate: isPaid ? paid : null,
      amount,
      outstanding: isPaid ? 0 : amount,
      received: isPaid ? amount : 0,
    });
    d = addDays(d, 30);
    n++;
  }
  return out.reverse();
}

export function demoCommitments(jobId: string): CommitmentRow[] {
  const r = rng(`${jobId}:po`);
  const vendors = [
    ["V1021", "Gulf Coast Ready Mix"],
    ["V1188", "Allied Steel Fabricators"],
    ["V2040", "Delta Equipment Rental"],
    ["V3307", "Precision Survey Co."],
  ];
  const rows: CommitmentRow[] = [];
  vendors.forEach(([vid, vname], vi) => {
    const lines = 2 + Math.floor(r() * 3);
    for (let l = 1; l <= lines; l++) {
      const qty = Math.round(50 + r() * 900);
      const price = Math.round(40 + r() * 400);
      const recvQty = Math.round(qty * r());
      const ct = DEFAULT_COST_TYPES[(vi + l) % DEFAULT_COST_TYPES.length];
      const cc = COST_CODES[(vi * 2 + l) % COST_CODES.length];
      rows.push({
        vendorId: vid,
        vendorName: vname,
        poNum: `${vi < 2 ? "PO" : "SC"}-${jobId.slice(-3)}${vi + 1}`,
        poDescr: vi < 2 ? "Material supply" : "Subcontract services",
        lineNum: String(l),
        lineDescr: `${cc[1]} — line ${l}`,
        costCode: cc[0],
        costCodeDescr: cc[1],
        costType: ct.code,
        costTypeDescr: ct.descr,
        status: recvQty >= qty ? "C" : "O",
        qtyOrdered: qty,
        qtyReceived: recvQty,
        amtOrdered: qty * price,
        amtReceived: recvQty * price,
        paidAmt: Math.round(recvQty * price * (0.6 + r() * 0.4)),
      });
    }
  });
  return rows;
}
