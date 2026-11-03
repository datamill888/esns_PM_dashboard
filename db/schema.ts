import {
  date,
  index,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Cost Performance Tracker input (dashboard "Tab 4").
 * One row per job × cost type × series × week. Series is one of
 * BASELINE | FORECAST | EV (earned value). Values are dollars.
 * This is app-owned data the PM types in — never a copy of Incorta data.
 */
export const costTrackerEntries = pgTable(
  "cost_tracker_entries",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").notNull(),
    costType: text("cost_type").notNull(),
    series: text("series").notNull(),
    weekEnding: date("week_ending").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cost_tracker_entries_key").on(t.jobId, t.costType, t.series, t.weekEnding),
    index("cost_tracker_entries_job").on(t.jobId),
  ],
);

/** Free-text PM notes per job and week (shown on the Overview tab). */
export const pmNotes = pgTable(
  "pm_notes",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").notNull(),
    asOfDate: date("as_of_date").notNull(),
    note: text("note").notNull(),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pm_notes_job").on(t.jobId)],
);
