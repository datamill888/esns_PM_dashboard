import type { ISODate } from "./dates";

export type DataSource = "incorta" | "demo";

export interface JobOption {
  jobId: string;
  name: string;
}

/** "Total Project Performance" header (PM Dashboard tab, transposed table). */
export interface JobHeader {
  jobId: string;
  name: string;
  projectManager: string | null;
  executive: string | null;
  contractRef: string | null;
  contractType: string | null;
  market: string | null;
  workType: string | null;
  contractStatus: string | null;
  jobDate: ISODate | null;
  latestWeekEnding: ISODate | null;
}

/** "Weekly Performance" — by cost type, this period vs last period. */
export interface WeeklyPerfRow {
  costType: string;
  costTypeDescr: string;
  periodSpend: number;
  lastPeriodSpend: number;
}

/** "Total Project Performance" — by cost type (budget = EST, spend = JC). */
export interface CostTypePerfRow {
  costType: string;
  costTypeDescr: string;
  spendToDate: number;
  budget: number;
}

/** "Total Project Performance - Cost Codes". */
export interface CostCodePerfRow {
  costCode: string;
  costCodeDescr: string;
  spendToDate: number;
  budget: number;
}

/** Weekly actual spend trend. */
export interface WeeklySpendPoint {
  weekEnding: ISODate;
  spend: number;
}

/** "Invoicing" — AR invoices for the job. */
export interface InvoiceRow {
  description: string | null;
  invoiceNum: string;
  invoiceDate: ISODate | null;
  receivedDate: ISODate | null;
  amount: number;
  outstanding: number;
  received: number;
}

/** "PO & SC" — commitment lines. */
export interface CommitmentRow {
  vendorId: string | null;
  vendorName: string | null;
  poNum: string;
  poDescr: string | null;
  lineNum: string;
  lineDescr: string | null;
  costCode: string | null;
  costCodeDescr: string | null;
  costType: string | null;
  costTypeDescr: string | null;
  status: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  amtOrdered: number;
  amtReceived: number;
  paidAmt: number;
}

export interface Overview {
  source: DataSource;
  header: JobHeader | null;
  weekly: WeeklyPerfRow[];
  byCostType: CostTypePerfRow[];
  byCostCode: CostCodePerfRow[];
  trend: WeeklySpendPoint[];
  /** Days from job start to as-of date — drives the daily/weekly/monthly averages. */
  daysElapsed: number;
}

/** Cost Performance Tracker (Tab 4). */
export const TRACKER_SERIES = ["BASELINE", "FORECAST", "EV"] as const;
export type TrackerSeries = (typeof TRACKER_SERIES)[number];

export interface TrackerCell {
  costType: string;
  series: TrackerSeries;
  weekEnding: ISODate;
  amount: number;
}

export interface TrackerData {
  source: DataSource;
  persisted: boolean;
  costTypes: { code: string; descr: string }[];
  weeks: ISODate[];
  cells: TrackerCell[];
}
