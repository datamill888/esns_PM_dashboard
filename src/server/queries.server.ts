/**
 * Live Incorta reads (SQL Interface, PostgreSQL dialect).
 *
 * Source mapping from the original Incorta dashboard:
 *   Penta_Business.Project_Labor  → Penta_Projects.Job_Cost_Stacked_1A (its physical source;
 *                                   the business view is not queryable over SQL).
 *                                   ~567M rows: ALWAYS filter job_id first.
 *   Penta_Business.Job            → header fields; PM/Executive names come from
 *                                   Penta.JOB.PMGR_EMP_ID / PROJ_ENGINEER_EMP_ID → Penta.EMPLOYEE
 *                                   (the business-view formula columns return "#ERROR" over SQL).
 *   Invoicing                     → Penta.AR_BH_BASE, DR_ACCT_NUM IN (115010,115031,115040)
 *   PO & SC                       → PO_DTL/PO_MSTR + BI40_PO_PRC_HIST (ordered) + AP_PH_BASE (invoiced/paid);
 *                                   SC_DTL equivalents via BI40_SC_PRC_HIST.
 *
 * Rules: schema/table quoted exactly, columns lowercase, every SUM cast ::float8,
 * ids never cast to numbers, values always passed as $n params.
 */
import { addDays, sundayOnOrBefore, toISO, type ISODate } from "@/lib/dates";
import type {
  CommitmentRow,
  CostCodePerfRow,
  CostTypePerfRow,
  InvoiceRow,
  JobHeader,
  JobOption,
  WeeklyPerfRow,
  WeeklySpendPoint,
} from "@/lib/types";
import { ACTUALS_ROLLUP } from "./costTypes";
import { sqlQuery } from "./incorta";

const STACK = `"Penta_Projects"."Job_Cost_Stacked_1A"`;
/** Guard against junk dates in Penta (years 0005 / 2160 / 2600 exist). */
const MIN_DATE = "1990-01-01";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const s = (v: unknown) => (v == null ? null : String(v));
const d = (v: unknown): ISODate | null => {
  if (v == null) return null;
  if (v instanceof Date) return toISO(v);
  const str = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
};

export async function listJobs(req: Request): Promise<JobOption[]> {
  const rows = await sqlQuery<{ job_id: string; name: string | null }>(
    req,
    `SELECT job_id, name FROM "Penta"."JOB" WHERE job_stat_cd = $1 ORDER BY job_id LIMIT 10000`,
    ["A"],
  );
  return rows.map((r) => ({ jobId: String(r.job_id), name: r.name ?? "" }));
}

export async function canSeeJob(req: Request, jobId: string): Promise<boolean> {
  const rows = await sqlQuery(req, `SELECT job_id FROM "Penta"."JOB" WHERE job_id = $1 LIMIT 1`, [jobId]);
  return rows.length > 0;
}

export async function jobHeader(req: Request, jobId: string, asOf: ISODate): Promise<JobHeader | null> {
  const [h] = await sqlQuery<Record<string, unknown>>(
    req,
    `SELECT j.job_id, j.name, j.cus_po_ref, j.alpha_1, j.alpha_2, j.alpha_4, j.contract_status, j.d_job_date,
            pm.first_name AS pm_first, pm.last_name AS pm_last,
            pe.first_name AS pe_first, pe.last_name AS pe_last
       FROM "Penta_Business"."Job" j
       JOIN "Penta"."JOB" pj ON pj.job_id = j.job_id
       LEFT JOIN "Penta"."EMPLOYEE" pm ON pm.emp_id = pj.pmgr_emp_id
       LEFT JOIN "Penta"."EMPLOYEE" pe ON pe.emp_id = pj.proj_engineer_emp_id
      WHERE j.job_id = $1
      LIMIT 1`,
    [jobId],
  );
  if (!h) return null;
  const [w] = await sqlQuery<{ wk: unknown }>(
    req,
    `SELECT MAX(week_ending) AS wk FROM ${STACK}
      WHERE job_id = $1 AND "type" = 'JC' AND week_ending <= $2::date AND week_ending >= $3::date`,
    [jobId, asOf, MIN_DATE],
  );
  const name = (f: unknown, l: unknown) => [f, l].filter(Boolean).join(" ").trim() || null;
  return {
    jobId: String(h.job_id),
    name: s(h.name) ?? "",
    projectManager: name(h.pm_first, h.pm_last),
    executive: name(h.pe_first, h.pe_last),
    contractRef: s(h.cus_po_ref),
    contractType: s(h.alpha_1),
    market: s(h.alpha_2),
    workType: s(h.alpha_4),
    contractStatus: s(h.contract_status),
    jobDate: d(h.d_job_date),
    latestWeekEnding: d(w?.wk),
  };
}

/**
 * Weekly Performance. Original formula: week ending = addDays(weekEndDate(asOf - 1), 1)
 * i.e. the Sunday on/after (asOf - 1); last period = that minus 7 days.
 */
export async function weeklyPerformance(req: Request, jobId: string, asOf: ISODate): Promise<WeeklyPerfRow[]> {
  const prior = addDays(asOf, -1);
  const dow = new Date(`${prior}T00:00:00Z`).getUTCDay();
  const cur = dow === 0 ? prior : addDays(prior, 7 - dow);
  const last = addDays(cur, -7);
  const rows = await sqlQuery<Record<string, unknown>>(
    req,
    `SELECT s.cost_type_cd, MAX(ct.descr) AS descr,
            SUM(CASE WHEN s.week_ending = $2::date THEN s.amt ELSE 0 END)::float8 AS cur,
            SUM(CASE WHEN s.week_ending = $3::date THEN s.amt ELSE 0 END)::float8 AS prev
       FROM ${STACK} s
       LEFT JOIN "Penta"."COST_TYPE" ct ON ct.cost_type_cd = s.cost_type_cd
      WHERE s.job_id = $1 AND s."type" = 'JC'
        AND s.week_ending IN ($2::date, $3::date)
        AND s.distr_date_date <= $4::date
      GROUP BY s.cost_type_cd
      ORDER BY s.cost_type_cd`,
    [jobId, cur, last, asOf],
  );
  return rows.map((r) => ({
    costType: String(r.cost_type_cd),
    costTypeDescr: s(r.descr) ?? "",
    periodSpend: n(r.cur),
    lastPeriodSpend: n(r.prev),
  }));
}

export async function perfByCostType(req: Request, jobId: string, asOf: ISODate): Promise<CostTypePerfRow[]> {
  const rows = await sqlQuery<Record<string, unknown>>(
    req,
    `SELECT s.cost_type_cd, MAX(ct.descr) AS descr,
            SUM(CASE WHEN s."type" = 'JC'  THEN s.amt ELSE 0 END)::float8 AS spend,
            SUM(CASE WHEN s."type" = 'EST' THEN s.amt ELSE 0 END)::float8 AS budget
       FROM ${STACK} s
       LEFT JOIN "Penta"."COST_TYPE" ct ON ct.cost_type_cd = s.cost_type_cd
      WHERE s.job_id = $1 AND s."type" IN ('EST', 'JC')
        AND s.distr_date_date <= $2::date
      GROUP BY s.cost_type_cd
      ORDER BY s.cost_type_cd`,
    [jobId, asOf],
  );
  return rows
    .map((r) => ({ costType: String(r.cost_type_cd), costTypeDescr: s(r.descr) ?? "", spendToDate: n(r.spend), budget: n(r.budget) }))
    .filter((r) => r.spendToDate !== 0 || r.budget !== 0);
}

export async function perfByCostCode(req: Request, jobId: string, asOf: ISODate): Promise<CostCodePerfRow[]> {
  const rows = await sqlQuery<Record<string, unknown>>(
    req,
    `SELECT s.cc, MAX(p.descr) AS descr,
            SUM(CASE WHEN s."type" = 'JC'  THEN s.amt ELSE 0 END)::float8 AS spend,
            SUM(CASE WHEN s."type" = 'EST' THEN s.amt ELSE 0 END)::float8 AS budget
       FROM ${STACK} s
       LEFT JOIN "Penta_Projects"."PM_Cost_Code" p
              ON p.job_id = s.job_id AND p.cc = s.cc AND p.cost_type_cd = s.cost_type_cd
      WHERE s.job_id = $1 AND s."type" IN ('EST', 'JC')
        AND s.distr_date_date <= $2::date
      GROUP BY s.cc
      ORDER BY s.cc`,
    [jobId, asOf],
  );
  return rows
    .map((r) => ({ costCode: String(r.cc ?? ""), costCodeDescr: s(r.descr) ?? "", spendToDate: n(r.spend), budget: n(r.budget) }))
    .filter((r) => r.spendToDate !== 0 || r.budget !== 0);
}

export async function weeklyTrend(req: Request, jobId: string, asOf: ISODate): Promise<WeeklySpendPoint[]> {
  const rows = await sqlQuery<{ week_ending: unknown; amt: unknown }>(
    req,
    `SELECT week_ending, SUM(amt)::float8 AS amt
       FROM ${STACK}
      WHERE job_id = $1 AND "type" = 'JC'
        AND week_ending <= $2::date AND week_ending >= $3::date
      GROUP BY week_ending
      ORDER BY week_ending`,
    [jobId, sundayOnOrBefore(asOf), MIN_DATE],
  );
  return rows.flatMap((r) => {
    const wk = d(r.week_ending);
    return wk ? [{ weekEnding: wk, spend: Math.round(n(r.amt) * 100) / 100 }] : [];
  });
}

/** Actual (JC) spend by tracker cost type × week ending, burden codes rolled up. */
export async function actualsByWeek(req: Request, jobId: string, from: ISODate, to: ISODate): Promise<Map<string, number>> {
  const rows = await sqlQuery<{ cost_type_cd: string; week_ending: unknown; amt: unknown }>(
    req,
    `SELECT cost_type_cd, week_ending, SUM(amt)::float8 AS amt
       FROM ${STACK}
      WHERE job_id = $1 AND "type" = 'JC'
        AND week_ending BETWEEN $2::date AND $3::date
      GROUP BY cost_type_cd, week_ending`,
    [jobId, from, to],
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    const wk = d(r.week_ending);
    if (!wk) continue;
    const ct = ACTUALS_ROLLUP[String(r.cost_type_cd)] ?? String(r.cost_type_cd);
    const key = `${ct}|${wk}`;
    m.set(key, (m.get(key) ?? 0) + n(r.amt));
  }
  return m;
}

export async function invoices(req: Request, jobId: string, asOf: ISODate): Promise<InvoiceRow[]> {
  const rows = await sqlQuery<Record<string, unknown>>(
    req,
    `SELECT cus_invoice_num, MAX(descr) AS descr, inv_date_date, MAX(paid_date_date) AS paid_date_date,
            SUM(amt)::float8 AS amt, SUM(outstanding_amt)::float8 AS outstanding, SUM(rcvd_amt)::float8 AS rcvd
       FROM "Penta"."AR_BH_BASE"
      WHERE job_id = $1 AND dr_acct_num IN (115010, 115031, 115040)
        AND inv_date_date <= $2::date
      GROUP BY cus_invoice_num, inv_date_date
      ORDER BY inv_date_date DESC
      LIMIT 1000`,
    [jobId, asOf],
  );
  return rows.map((r) => ({
    description: s(r.descr),
    invoiceNum: String(r.cus_invoice_num ?? ""),
    invoiceDate: d(r.inv_date_date),
    receivedDate: d(r.paid_date_date),
    amount: n(r.amt),
    outstanding: n(r.outstanding),
    received: n(r.rcvd),
  }));
}

/**
 * Purchase-order and subcontract lines. Ordered = price history up to as-of;
 * received/invoiced and paid = AP distributions up to as-of.
 * (PPH_PO_CO_JOB_ID is only set on change-order rows, so PO price history is
 * matched on PO number + line rather than job.)
 */
export async function commitments(req: Request, jobId: string, asOf: ISODate): Promise<CommitmentRow[]> {
  const po = await sqlQuery<Record<string, unknown>>(
    req,
    `WITH h AS (
       SELECT pph_ou_id, pph_po_num, pph_line_num,
              SUM(pph_contrib_amt)::float8 AS amt, SUM(CAST(pph_units AS double precision))::float8 AS units
         FROM "Penta_Projects"."BI40_PO_PRC_HIST"
        WHERE pph_po_num LIKE $3 AND pph_d_hist_date < ($2::date + 1)
        GROUP BY pph_ou_id, pph_po_num, pph_line_num),
     ap AS (
       SELECT po_ou_id, po_num, po_line_num,
              SUM(amt)::float8 AS amt, SUM(units)::float8 AS units, SUM(paid_amt)::float8 AS paid
         FROM "Penta_Projects"."AP_PH_BASE"
        WHERE job_id = $1 AND po_num IS NOT NULL AND d_distr_date < ($2::date + 1)
        GROUP BY po_ou_id, po_num, po_line_num)
     SELECT d.po_num, m.descr AS po_descr, m.ven_id, v.name AS vendor, d.line_num, d.descr AS line_descr,
            d.po_stat_cd, d.cc, cc.descr AS cc_descr, d.cost_type_cd, ct.descr AS ct_descr,
            h.amt AS ord_amt, h.units AS ord_units, ap.amt AS inv_amt, ap.units AS inv_units, ap.paid
       FROM "Penta_Projects"."PO_DTL" d
       JOIN "Penta_Projects"."PO_MSTR" m ON m.ou_id = d.ou_id AND m.po_num = d.po_num
       LEFT JOIN "Penta"."VENDOR" v ON v.ven_id = m.ven_id
       LEFT JOIN "Penta_Projects"."PM_Cost_Code" cc ON cc.job_id = d.job_id AND cc.cc = d.cc AND cc.cost_type_cd = d.cost_type_cd
       LEFT JOIN "Penta"."COST_TYPE" ct ON ct.cost_type_cd = d.cost_type_cd
       LEFT JOIN h ON h.pph_ou_id = d.ou_id AND h.pph_po_num = d.po_num AND h.pph_line_num = d.line_num
       LEFT JOIN ap ON ap.po_ou_id = d.ou_id AND ap.po_num = d.po_num AND ap.po_line_num = d.line_num
      WHERE d.job_id = $1
      ORDER BY d.po_num, d.line_num
      LIMIT 2000`,
    [jobId, asOf, `${jobId}-%`],
  );

  const sc = await sqlQuery<Record<string, unknown>>(
    req,
    `WITH h AS (
       SELECT sph_sc_num, sph_line_num, SUM(sph_contrib_amt)::float8 AS amt, SUM(CAST(sph_units AS double precision))::float8 AS units
         FROM "Penta_Projects"."BI40_SC_PRC_HIST"
        WHERE sph_job_id = $1
        GROUP BY sph_sc_num, sph_line_num),
     ap AS (
       SELECT sc_num, sc_line_num, MAX(ven_id) AS ven_id, MAX(cc) AS cc, MAX(cost_type_cd) AS cost_type_cd,
              SUM(amt)::float8 AS amt, SUM(units)::float8 AS units, SUM(paid_amt)::float8 AS paid
         FROM "Penta_Projects"."AP_PH_BASE"
        WHERE job_id = $1 AND sc_num IS NOT NULL AND d_distr_date < ($2::date + 1)
        GROUP BY sc_num, sc_line_num)
     SELECT h.sph_sc_num AS sc_num, h.sph_line_num AS line_num, ap.ven_id, v.name AS vendor,
            ap.cc, ap.cost_type_cd, ct.descr AS ct_descr,
            h.amt AS ord_amt, h.units AS ord_units, ap.amt AS inv_amt, ap.units AS inv_units, ap.paid
       FROM h
       LEFT JOIN ap ON ap.sc_num = h.sph_sc_num AND ap.sc_line_num = h.sph_line_num
       LEFT JOIN "Penta"."VENDOR" v ON v.ven_id = ap.ven_id
       LEFT JOIN "Penta"."COST_TYPE" ct ON ct.cost_type_cd = ap.cost_type_cd
      ORDER BY h.sph_sc_num, h.sph_line_num
      LIMIT 2000`,
    [jobId, asOf],
  );

  const poRows: CommitmentRow[] = po.map((r) => ({
    vendorId: s(r.ven_id),
    vendorName: s(r.vendor),
    poNum: String(r.po_num),
    poDescr: s(r.po_descr),
    lineNum: String(r.line_num),
    lineDescr: s(r.line_descr),
    costCode: s(r.cc),
    costCodeDescr: s(r.cc_descr),
    costType: s(r.cost_type_cd),
    costTypeDescr: s(r.ct_descr),
    status: s(r.po_stat_cd),
    qtyOrdered: n(r.ord_units),
    qtyReceived: n(r.inv_units),
    amtOrdered: n(r.ord_amt),
    amtReceived: n(r.inv_amt),
    paidAmt: n(r.paid),
  }));
  const scRows: CommitmentRow[] = sc.map((r) => ({
    vendorId: s(r.ven_id),
    vendorName: s(r.vendor),
    poNum: String(r.sc_num),
    poDescr: "Subcontract",
    lineNum: String(r.line_num),
    lineDescr: null,
    costCode: s(r.cc),
    costCodeDescr: null,
    costType: s(r.cost_type_cd),
    costTypeDescr: s(r.ct_descr),
    status: null,
    qtyOrdered: n(r.ord_units),
    qtyReceived: n(r.inv_units),
    amtOrdered: n(r.ord_amt),
    amtReceived: n(r.inv_amt),
    paidAmt: n(r.paid),
  }));
  return [...poRows, ...scRows];
}
