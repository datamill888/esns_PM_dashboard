/**
 * Cost Performance Tracker storage. App-owned rows in the platform Postgres
 * (db/schema.ts → cost_tracker_entries). When DATABASE_URL is absent (local
 * demo) a process-memory map stands in so the grid is still usable.
 */
import { and, between, eq } from "drizzle-orm";
import { costTrackerEntries } from "../../db/schema";
import type { ISODate } from "@/lib/dates";
import type { TrackerCell, TrackerSeries } from "@/lib/types";
import { getDb } from "./db";

const memory = new Map<string, TrackerCell & { jobId: string }>();
const key = (jobId: string, c: Pick<TrackerCell, "costType" | "series" | "weekEnding">) =>
  `${jobId}|${c.costType}|${c.series}|${c.weekEnding}`;

export async function loadCells(jobId: string, from: ISODate, to: ISODate): Promise<{ cells: TrackerCell[]; persisted: boolean }> {
  const db = getDb();
  if (!db) {
    const cells = [...memory.values()]
      .filter((c) => c.jobId === jobId && c.weekEnding >= from && c.weekEnding <= to)
      .map(({ jobId: _j, ...c }) => c);
    return { cells, persisted: false };
  }
  const rows = await db
    .select({
      costType: costTrackerEntries.costType,
      series: costTrackerEntries.series,
      weekEnding: costTrackerEntries.weekEnding,
      amount: costTrackerEntries.amount,
    })
    .from(costTrackerEntries)
    .where(and(eq(costTrackerEntries.jobId, jobId), between(costTrackerEntries.weekEnding, from, to)));
  return {
    persisted: true,
    cells: rows.map((r) => ({
      costType: r.costType,
      series: r.series as TrackerSeries,
      weekEnding: String(r.weekEnding).slice(0, 10),
      amount: Number(r.amount),
    })),
  };
}

/** Upsert (amount != null) or clear (amount == null) a batch of cells. */
export async function saveCells(
  jobId: string,
  cells: Array<Omit<TrackerCell, "amount"> & { amount: number | null }>,
  user: string | null,
): Promise<void> {
  const db = getDb();
  if (!db) {
    for (const c of cells) {
      if (c.amount == null) memory.delete(key(jobId, c));
      else memory.set(key(jobId, c), { jobId, costType: c.costType, series: c.series, weekEnding: c.weekEnding, amount: c.amount });
    }
    return;
  }
  await db.transaction(async (tx) => {
    for (const c of cells) {
      const match = and(
        eq(costTrackerEntries.jobId, jobId),
        eq(costTrackerEntries.costType, c.costType),
        eq(costTrackerEntries.series, c.series),
        eq(costTrackerEntries.weekEnding, c.weekEnding),
      );
      if (c.amount == null) {
        await tx.delete(costTrackerEntries).where(match);
      } else {
        await tx
          .insert(costTrackerEntries)
          .values({
            jobId,
            costType: c.costType,
            series: c.series,
            weekEnding: c.weekEnding,
            amount: c.amount.toFixed(2),
            updatedBy: user,
          })
          .onConflictDoUpdate({
            target: [
              costTrackerEntries.jobId,
              costTrackerEntries.costType,
              costTrackerEntries.series,
              costTrackerEntries.weekEnding,
            ],
            set: { amount: c.amount.toFixed(2), updatedBy: user, updatedAt: new Date() },
          });
      }
    }
  });
}
