/**
 * Drill-through: the transactions behind a clicked value (SQL Interface,
 * PostgreSQL dialect, run as the signed-in user so row security applies).
 *
 * Each request kind mirrors the filters of the query that produced the summary
 * number in queries.server.ts, so the drill total reconciles with it:
 *   cost   → Penta_Projects.Job_Cost_Stacked_1A   (budget EST / actual JC lines)
 *   ap     → Penta_Projects.AP_PH_BASE            (PO/SC received, invoiced, paid)
 *   commit → BI40_PO_PRC_HIST / BI40_SC_PRC_HIST  (PO/SC ordered amount, change orders)
 *   ar     → Penta.AR_BH_BASE                     (invoice distributions)
 *
 * Detail rows are capped at ROW_LIMIT; totals and count come from a separate
 * aggregate over every matching row, so they are exact even when truncated.
 */
import { toISO, type ISODate } from "@/lib/dates";
import type { DrillColumnType, DrillRequest, DrillResult } from "@/lib/types";
import { sqlQuery as rawSqlQuery } from "./incorta";
import { friendlySqlError } from "./sqlErrors";

const ROW_LIMIT = 2000;
const STACK = `"Penta_Projects"."Job_Cost_Stacked_1A"`;

async function q(req: Request, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  let rows;
  try {
    rows = await rawSqlQuery(req, sql, params);
  } catch (e) {
    throw friendlySqlError(e);
  }
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k.toLowerCase()] = v;
    return o;
  });
}

/** Builds "$n" placeholders as params are added, so values never enter the SQL text. */
class Where {
  readonly params: unknown[] = [];
  readonly parts: string[] = [];
  p(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  add(sqlFragment: string) {
    this.parts.push(sqlFragment);
  }
  list(values: string[]): string {
    return values.map((v) => this.p(v)).join(", ");
  }
  get sql() {
    return this.parts.join(" AND ");
  }
}

type Col = { key: string; label: string; type: DrillColumnType };

function shape(rows: Record<string, unknown>[], cols: Col[]): DrillResult["rows"] {
  return rows.map((r) => {
    const o: Record<string, string | number | null> = {};
    for (const c of cols) {
      const v = r[c.key];
      if (v == null) o[c.key] = null;
      else if (c.type === "money" || c.type === "num") o[c.key] = Number(v);
      else if (c.type === "date") o[c.key] = v instanceof Date ? toISO(v) : String(v).slice(0, 10);
      else o[c.key] = String(v).trim();
    }
    return o;
  });
}

function totalsFrom(row: Record<string, unknown> | undefined, keys: string[]) {
  const t: Record<string, number> = {};
  for (const k of keys) t[k] = row?.[k] == null ? 0 : Number(row[k]);
  return t;
}

/* ------------------------------ job cost ------------------------------ */

const COST_COLS: Col[] = [
  { key: "txn_date", label: "Distr Date", type: "date" },
  { key: "week_ending", label: "Week Ending", type: "date" },
  { key: "txn_type", label: "Type", type: "text" },
  { key: "type2", label: "Line Type", type: "text" },
  { key: "src", label: "Source", type: "text" },
  { key: "doc_num", label: "Doc #", type: "text" },
  { key: "cost_type_cd", label: "Cost Type", type: "text" },
  { key: "cc", label: "Cost Code", type: "text" },
  { key: "descr", label: "Description", type: "text" },
  { key: "employee", label: "Employee", type: "text" },
  { key: "vendor", label: "Vendor", type: "text" },
  { key: "po_sc", label: "PO / SC", type: "text" },
  { key: "line", label: "Line", type: "text" },
  { key: "invoice_num", label: "Invoice #", type: "text" },
  { key: "hrs", label: "Hours", type: "num" },
  { key: "units", label: "Units", type: "num" },
  { key: "amt", label: "Amount", type: "money" },
];

async function costDrill(req: Request, jobId: string, asOf: ISODate, r: Extract<DrillRequest, { kind: "cost" }>): Promise<DrillResult> {
  const w = new Where();
  w.add(`s.job_id = ${w.p(jobId)}`);
  w.add(`s."Type" IN (${w.list(r.types)})`);
  if (r.costTypes?.length) w.add(`s.cost_type_cd IN (${w.list(r.costTypes)})`);
  if (r.costCode != null) w.add(`s.cc = ${w.p(r.costCode)}`);
  if (r.weekEnding) w.add(`s.week_ending = ${w.p(r.weekEnding)}::date`);
  if (r.capToAsOf) w.add(`s.distr_date_date <= ${w.p(asOf)}::date`);
  // Same noise filter as the original dashboard: drop lines with no amount, hours or units.
  w.add(`(COALESCE(s.amt, 0) <> 0 OR COALESCE(s.hrs, 0) <> 0 OR COALESCE(s.units, 0) <> 0)`);

  const [agg] = await q(
    req,
    `SELECT COUNT(*)::float8 AS n, SUM(s.amt)::float8 AS amt, SUM(s.hrs)::float8 AS hrs, SUM(s.units)::float8 AS units
       FROM ${STACK} s WHERE ${w.sql}`,
    w.params,
  );
  const rows = await q(
    req,
    `SELECT s.distr_date_date AS txn_date, s.week_ending, s."Type" AS txn_type, s.type2, s."Table" AS src,
            s.doc_num, s.cost_type_cd, s.cc, s.descr_formatted AS descr,
            NULLIF(TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS employee,
            v.name AS vendor,
            NULLIF(COALESCE(s.po_num, s.sc_num), '') AS po_sc, NULLIF(COALESCE(s.po_line_num, s.sc_line_num), 0) AS line,
            s.invoice_num, s.hrs, s.units, s.amt
       FROM ${STACK} s
       LEFT JOIN "Penta"."EMPLOYEE" e ON e.emp_id = s.emp_id
       LEFT JOIN "Penta"."VENDOR" v ON v.ven_id = s.ven_id
      WHERE ${w.sql}
      ORDER BY s.distr_date_date DESC, s.doc_num
      LIMIT ${ROW_LIMIT}`,
    w.params,
  );
  const count = Number(agg?.n ?? 0);
  return {
    source: "incorta",
    columns: COST_COLS,
    rows: shape(rows, COST_COLS),
    totals: totalsFrom(agg, ["amt", "hrs", "units"]),
    count,
    truncated: count > rows.length,
  };
}

/* ------------------------------ AP (PO / SC) ------------------------------ */

const AP_COLS: Col[] = [
  { key: "distr_date", label: "Distr Date", type: "date" },
  { key: "invoice_date", label: "Invoice Date", type: "date" },
  { key: "ven_invoice_num", label: "Vendor Invoice #", type: "text" },
  { key: "doc_num", label: "Doc #", type: "text" },
  { key: "descr", label: "Description", type: "text" },
  { key: "cc", label: "Cost Code", type: "text" },
  { key: "cost_type_cd", label: "Cost Type", type: "text" },
  { key: "ap_stat_cd", label: "Status", type: "text" },
  { key: "units", label: "Units", type: "num" },
  { key: "up", label: "Unit Price", type: "money" },
  { key: "amt", label: "Amount", type: "money" },
  { key: "paid_amt", label: "Paid", type: "money" },
  { key: "paid_date", label: "Paid Date", type: "date" },
];

async function apDrill(req: Request, jobId: string, asOf: ISODate, r: Extract<DrillRequest, { kind: "ap" }>): Promise<DrillResult> {
  const w = new Where();
  w.add(`job_id = ${w.p(jobId)}`);
  if (r.doc === "PO") {
    w.add(`po_num = ${w.p(r.num)}`);
    w.add(`po_line_num = ${w.p(Number(r.line))}`);
  } else {
    w.add(`sc_num = ${w.p(r.num)}`);
    w.add(`sc_line_num = ${w.p(Number(r.line))}`);
  }
  w.add(`d_distr_date < (${w.p(asOf)}::date + 1)`);
  const [agg] = await q(
    req,
    `SELECT COUNT(*)::float8 AS n, SUM(amt)::float8 AS amt, SUM(paid_amt)::float8 AS paid_amt, SUM(units)::float8 AS units
       FROM "Penta_Projects"."AP_PH_BASE" WHERE ${w.sql}`,
    w.params,
  );
  const rows = await q(
    req,
    `SELECT d_distr_date AS distr_date, d_invoice_date AS invoice_date, ven_invoice_num, doc_num, descr, cc, cost_type_cd,
            ap_stat_cd, units::float8 AS units, up::float8 AS up, amt::float8 AS amt, paid_amt::float8 AS paid_amt,
            d_paid_date AS paid_date
       FROM "Penta_Projects"."AP_PH_BASE"
      WHERE ${w.sql}
      ORDER BY d_distr_date DESC, doc_num
      LIMIT ${ROW_LIMIT}`,
    w.params,
  );
  const count = Number(agg?.n ?? 0);
  return {
    source: "incorta",
    columns: AP_COLS,
    rows: shape(rows, AP_COLS),
    totals: totalsFrom(agg, ["amt", "paid_amt", "units"]),
    count,
    truncated: count > rows.length,
  };
}

/* ------------------------------ price history (ordered) ------------------------------ */

const COMMIT_COLS: Col[] = [
  { key: "hist_date", label: "Date", type: "date" },
  { key: "seq_num", label: "Seq", type: "text" },
  { key: "descr", label: "Description", type: "text" },
  { key: "change_order", label: "Change Order", type: "text" },
  { key: "units", label: "Units", type: "num" },
  { key: "up", label: "Unit Price", type: "money" },
  { key: "amt", label: "Amount", type: "money" },
];

async function commitDrill(req: Request, jobId: string, asOf: ISODate, r: Extract<DrillRequest, { kind: "commit" }>): Promise<DrillResult> {
  const w = new Where();
  let from: string;
  let select: string;
  if (r.doc === "PO") {
    // Must match commitments(): PO number + line, history on or before As of.
    w.add(`pph_po_num = ${w.p(r.num)}`);
    w.add(`pph_line_num = ${w.p(Number(r.line))}`);
    w.add(`pph_d_hist_date < (${w.p(asOf)}::date + 1)`);
    from = `"Penta_Projects"."BI40_PO_PRC_HIST"`;
    select = `pph_d_hist_date AS hist_date, pph_seq_num AS seq_num, pph_descr AS descr, pph_po_co_name AS change_order,
              CAST(pph_units AS double precision) AS units, pph_up::float8 AS up, pph_contrib_amt::float8 AS amt`;
  } else {
    // Must match commitments(): SC price history has no as-of filter there.
    w.add(`sph_job_id = ${w.p(jobId)}`);
    w.add(`sph_sc_num = ${w.p(r.num)}`);
    w.add(`sph_line_num = ${w.p(Number(r.line))}`);
    from = `"Penta_Projects"."BI40_SC_PRC_HIST"`;
    select = `sph_d_hist_date AS hist_date, sph_seq_num AS seq_num, sph_descr AS descr, sph_co_name AS change_order,
              CAST(sph_units AS double precision) AS units, sph_up::float8 AS up, sph_contrib_amt::float8 AS amt`;
  }
  const amtCol = r.doc === "PO" ? "pph_contrib_amt" : "sph_contrib_amt";
  const [agg] = await q(req, `SELECT COUNT(*)::float8 AS n, SUM(${amtCol})::float8 AS amt FROM ${from} WHERE ${w.sql}`, w.params);
  const rows = await q(req, `SELECT ${select} FROM ${from} WHERE ${w.sql} ORDER BY 1 DESC, 2 LIMIT ${ROW_LIMIT}`, w.params);
  const count = Number(agg?.n ?? 0);
  return {
    source: "incorta",
    columns: COMMIT_COLS,
    rows: shape(rows, COMMIT_COLS),
    totals: totalsFrom(agg, ["amt"]),
    count,
    truncated: count > rows.length,
  };
}

/* ------------------------------ AR (invoices) ------------------------------ */

const AR_COLS: Col[] = [
  { key: "invoice_num", label: "Invoice #", type: "text" },
  { key: "inv_date", label: "Invoice Date", type: "date" },
  { key: "distr_date", label: "Distr Date", type: "date" },
  { key: "doc_num", label: "Doc #", type: "text" },
  { key: "descr", label: "Description", type: "text" },
  { key: "prog_bill_num", label: "Prog Bill #", type: "text" },
  { key: "ar_stat_cd", label: "Status", type: "text" },
  { key: "amt", label: "Amount", type: "money" },
  { key: "rcvd_amt", label: "Received", type: "money" },
  { key: "outstanding", label: "Outstanding", type: "money" },
  { key: "paid_date", label: "Received Date", type: "date" },
];

async function arDrill(req: Request, jobId: string, asOf: ISODate, r: Extract<DrillRequest, { kind: "ar" }>): Promise<DrillResult> {
  const w = new Where();
  // Must match invoices(): same accounts, invoice dated on or before As of.
  w.add(`job_id = ${w.p(jobId)}`);
  w.add(`dr_acct_num IN (115010, 115031, 115040)`);
  w.add(`inv_date_date <= ${w.p(asOf)}::date`);
  if (r.invoiceNum != null) w.add(`cus_invoice_num = ${w.p(r.invoiceNum)}`);
  if (r.invoiceDate) w.add(`inv_date_date = ${w.p(r.invoiceDate)}::date`);
  const [agg] = await q(
    req,
    `SELECT COUNT(*)::float8 AS n, SUM(amt)::float8 AS amt, SUM(rcvd_amt)::float8 AS rcvd_amt, SUM(outstanding_amt)::float8 AS outstanding
       FROM "Penta"."AR_BH_BASE" WHERE ${w.sql}`,
    w.params,
  );
  const rows = await q(
    req,
    `SELECT cus_invoice_num AS invoice_num, inv_date_date AS inv_date, d_distr_date AS distr_date, doc_num, descr,
            prog_bill_num, ar_stat_cd, amt::float8 AS amt, rcvd_amt::float8 AS rcvd_amt,
            outstanding_amt::float8 AS outstanding, paid_date_date AS paid_date
       FROM "Penta"."AR_BH_BASE"
      WHERE ${w.sql}
      ORDER BY inv_date_date DESC, doc_num
      LIMIT ${ROW_LIMIT}`,
    w.params,
  );
  const count = Number(agg?.n ?? 0);
  return {
    source: "incorta",
    columns: AR_COLS,
    rows: shape(rows, AR_COLS),
    totals: totalsFrom(agg, ["amt", "rcvd_amt", "outstanding"]),
    count,
    truncated: count > rows.length,
  };
}

export async function drill(req: Request, jobId: string, asOf: ISODate, r: DrillRequest): Promise<DrillResult> {
  switch (r.kind) {
    case "cost":
      return costDrill(req, jobId, asOf, r);
    case "ap":
      return apDrill(req, jobId, asOf, r);
    case "commit":
      return commitDrill(req, jobId, asOf, r);
    case "ar":
      return arDrill(req, jobId, asOf, r);
  }
}

/** Column sets, exported so demo mode renders the same shape. */
export const DRILL_COLUMNS = { cost: COST_COLS, ap: AP_COLS, commit: COMMIT_COLS, ar: AR_COLS };
