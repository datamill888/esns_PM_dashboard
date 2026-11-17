/**
 * Deterministic sample data for LOCAL runs with no Incorta endpoint
 * (INCORTA_PG_URL unset). Every screen labels this as demo data. Never used on
 * the platform, where the app always reads live Incorta data.
 */
import { addDays, daysBetween, sundayOnOrBefore, weeksBetween, type ISODate } from "@/lib/dates";
import type {
  DrillRequest,
  DrillResult,
  CommitmentRow,
  CostCodePerfRow,
  CostTypePerfRow,
  InvoiceRow,
  JobHeader,
  JobOption,
  Overview,
  WeeklyPerfRow,
} from "@/lib/types";
import { DEFAULT_COST_TYPES } from "@/lib/costTypes";
import { DRILL_COLUMNS } from "./drill.server";

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
    periodWeek: cur,
    lastPeriodWeek: prev,
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
        doc: vi < 2 ? "PO" : "SC",
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

/** Demo drill: split the clicked total into plausible lines so the panel reconciles. */
export function demoDrill(r: DrillRequest, total: number): DrillResult {
  const cols = DRILL_COLUMNS[r.kind];
  const rand = rng(JSON.stringify(r));
  const n = Math.max(1, Math.min(14, Math.round(Math.abs(total) / 4000) + 3));
  const weights = Array.from({ length: n }, () => 0.3 + rand());
  const wsum = weights.reduce((a, b) => a + b, 0);
  let left = Math.round(total * 100);
  const rows = weights.map((w, i) => {
    const cents = i === n - 1 ? left : Math.round((total * 100 * w) / wsum);
    left -= cents;
    const amt = cents / 100;
    const date = r.kind === "cost" && r.weekEnding ? addDays(r.weekEnding, -Math.floor(rand() * 7)) : addDays("2026-10-25", -Math.floor(rand() * 60));
    const ct = r.kind === "cost" ? (r.costTypes?.[0] ?? DEFAULT_COST_TYPES[i % DEFAULT_COST_TYPES.length].code) : "BM";
    const base: Record<string, string | number | null> = {};
    for (const c of cols) base[c.key] = null;
    return {
      ...base,
      txn_date: date, week_ending: r.kind === "cost" && r.weekEnding ? r.weekEnding : sundayOnOrBefore(addDays(date, 6)), distr_date: date, invoice_date: date, hist_date: date, inv_date: date,
      txn_type: r.kind === "cost" ? r.types[i % r.types.length] : null, type2: ct === "BL" ? "Gross" : "AP", src: "Demo",
      doc_num: String(5_750_000 + Math.floor(rand() * 9999)), seq_num: String(i + 1),
      cost_type_cd: ct, cc: r.kind === "cost" ? (r.costCode ?? COST_CODES[i % COST_CODES.length][0]) : COST_CODES[i % COST_CODES.length][0],
      descr: ct === "BL" ? `PR PERIOD ENDING ${date}` : `Demo transaction ${i + 1}`,
      employee: ct === "BL" || ct === "BS" ? ["Alex Rivera", "Sam Patel", "Jo Kim"][i % 3] : null,
      vendor: ct === "BL" || ct === "BS" ? null : "Gulf Coast Ready Mix",
      ven_invoice_num: `INV-${1000 + i}`, invoice_num: r.kind === "ar" ? (r.invoiceNum ?? `00${i}-JOB`) : null,
      hrs: ct === "BL" ? Math.round(amt / 55) : null, units: null, up: null,
      amt, paid_amt: r.kind === "ap" ? amt : null, rcvd_amt: r.kind === "ar" ? amt : null, outstanding: r.kind === "ar" ? 0 : null,
    };
  });
  const totals: Record<string, number> = {};
  for (const c of cols) if (c.type === "money" || c.type === "num") totals[c.key] = rows.reduce((a, x) => a + (Number(x[c.key as keyof typeof x]) || 0), 0);
  return { source: "demo", columns: cols, rows: rows.map((x) => Object.fromEntries(cols.map((c) => [c.key, (x as Record<string, string | number | null>)[c.key] ?? null]))), totals, count: rows.length, truncated: false };
}
