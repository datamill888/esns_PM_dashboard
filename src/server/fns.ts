/**
 * Server functions (typed RPC). Each one reads live Incorta data as the
 * signed-in user, or falls back to labelled demo data when this deployment has
 * no Incorta SQL endpoint (local runs only).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { daysBetween, sundayOnOrBefore, todayISO, weeksBetween } from "@/lib/dates";
import { TRACKER_SERIES, type DataSource, type Overview, type TrackerData } from "@/lib/types";
import { getServerSession } from "./auth";
import { DEFAULT_COST_TYPES } from "./costTypes";
import { incortaConfigured } from "./incorta";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const jobInput = z.object({ jobId: z.string().min(1).max(40), asOf: iso });

const live = (): DataSource => (incortaConfigured() ? "incorta" : "demo");

export const getSessionInfo = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getServerSession(getRequest());
  return {
    user: session?.user.name ?? session?.user.email ?? null,
    pastSunday: sundayOnOrBefore(todayISO()),
  };
});

export const getJobs = createServerFn({ method: "GET" }).handler(async () => {
  if (live() === "demo") {
    const { DEMO_JOBS } = await import("./demo.server");
    return { source: "demo" as DataSource, items: DEMO_JOBS };
  }
  const { listJobs } = await import("./queries.server");
  return { source: "incorta" as DataSource, items: await listJobs(getRequest()) };
});

export const getOverview = createServerFn({ method: "GET" })
  .inputValidator(jobInput)
  .handler(async ({ data }): Promise<Overview> => {
    if (live() === "demo") {
      const { demoOverview } = await import("./demo.server");
      return demoOverview(data.jobId, data.asOf);
    }
    const q = await import("./queries.server");
    const req = getRequest();
    const [header, weekly, byCostType, byCostCode, trend] = await Promise.all([
      q.jobHeader(req, data.jobId, data.asOf),
      q.weeklyPerformance(req, data.jobId, data.asOf),
      q.perfByCostType(req, data.jobId, data.asOf),
      q.perfByCostCode(req, data.jobId, data.asOf),
      q.weeklyTrend(req, data.jobId, data.asOf),
    ]);
    return {
      source: "incorta",
      header,
      weekly,
      byCostType,
      byCostCode,
      trend,
      daysElapsed: header?.jobDate ? Math.max(1, daysBetween(header.jobDate, data.asOf)) : 1,
    };
  });

export const getCommitments = createServerFn({ method: "GET" })
  .inputValidator(jobInput)
  .handler(async ({ data }) => {
    if (live() === "demo") {
      const { demoCommitments } = await import("./demo.server");
      return { source: "demo" as DataSource, rows: demoCommitments(data.jobId) };
    }
    const { commitments } = await import("./queries.server");
    return { source: "incorta" as DataSource, rows: await commitments(getRequest(), data.jobId, data.asOf) };
  });

export const getInvoices = createServerFn({ method: "GET" })
  .inputValidator(jobInput)
  .handler(async ({ data }) => {
    if (live() === "demo") {
      const { demoInvoices } = await import("./demo.server");
      return { source: "demo" as DataSource, rows: demoInvoices(data.jobId, data.asOf) };
    }
    const { invoices } = await import("./queries.server");
    return { source: "incorta" as DataSource, rows: await invoices(getRequest(), data.jobId, data.asOf) };
  });

/* ---------------- Cost Performance Tracker (Tab 4) ---------------- */

const periodInput = z
  .object({ jobId: z.string().min(1).max(40), from: iso, to: iso })
  .refine((v) => v.from <= v.to, "Period start must be before the end");

export const getTracker = createServerFn({ method: "GET" })
  .inputValidator(periodInput)
  .handler(async ({ data }): Promise<TrackerData & { actuals: [string, number][] }> => {
    const weeks = weeksBetween(data.from, data.to, 53);
    const first = weeks[0] ?? data.from;
    const last = weeks[weeks.length - 1] ?? data.to;
    const { loadCells } = await import("./tracker.server");
    const { cells, persisted } = await loadCells(data.jobId, first, last);

    let actuals: [string, number][] = [];
    const source = live();
    if (source === "incorta") {
      const { actualsByWeek } = await import("./queries.server");
      actuals = [...(await actualsByWeek(getRequest(), data.jobId, first, last))];
    }
    return { source, persisted, costTypes: DEFAULT_COST_TYPES, weeks, cells, actuals };
  });

const saveInput = z.object({
  jobId: z.string().min(1).max(40),
  cells: z
    .array(
      z.object({
        costType: z.string().min(1).max(10),
        series: z.enum(TRACKER_SERIES),
        weekEnding: iso,
        amount: z.number().finite().gte(-1e11).lte(1e11).nullable(),
      }),
    )
    .min(1)
    .max(2000),
});

export const saveTracker = createServerFn({ method: "POST" })
  .inputValidator(saveInput)
  .handler(async ({ data }) => {
    const req = getRequest();
    const session = await getServerSession(req);
    // On the platform the auth gate guarantees a session; locally (no auth) allow demo edits.
    if (!session && process.env.INCORTA_URL) throw new Error("Not signed in");
    if (live() === "incorta") {
      // Only allow writes for jobs this user can see under their Incorta row security.
      const { canSeeJob } = await import("./queries.server");
      if (!(await canSeeJob(req, data.jobId))) throw new Error("You don't have access to this job");
    }
    const allowed = new Set(DEFAULT_COST_TYPES.map((c) => c.code));
    const cells = data.cells.filter((c) => allowed.has(c.costType));
    const { saveCells } = await import("./tracker.server");
    await saveCells(data.jobId, cells, session?.user.email ?? session?.user.sub ?? null);
    return { ok: true, saved: cells.length };
  });
