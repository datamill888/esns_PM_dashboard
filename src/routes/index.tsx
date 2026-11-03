import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { addDays, fmtShort } from "@/lib/dates";
import { cn } from "@/lib/format";
import { getJobs, getSessionInfo } from "@/lib/api/pm.functions";
import { OverviewTab } from "@/components/OverviewTab";
import { CommitmentsTab } from "@/components/CommitmentsTab";
import { InvoicingTab } from "@/components/InvoicingTab";
import { TrackerTab } from "@/components/TrackerTab";
import { JobPicker } from "@/components/JobPicker";

const TABS = [
  { id: "overview", label: "PM Dashboard" },
  { id: "po", label: "PO & SC" },
  { id: "invoicing", label: "Invoicing" },
  { id: "tracker", label: "Cost Performance Tracker" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const searchSchema = z.object({
  job: z.string().optional(),
  asOf: isoDate.optional(),
  tab: z.enum(["overview", "po", "invoicing", "tracker"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: (s) => searchSchema.parse(s),
  loader: async () => {
    const [jobs, session] = await Promise.all([getJobs(), getSessionInfo()]);
    return { jobs, session };
  },
  component: Dashboard,
});

function Dashboard() {
  const { jobs, session } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });

  // Default "As of" = past Sunday, computed on the server so SSR and client match.
  const asOf = search.asOf ?? session.pastSunday;
  const tab: TabId = search.tab ?? "overview";
  const jobId = search.job ?? "";
  const job = jobs.items.find((j) => j.jobId === jobId);

  const set = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded bg-gold text-[11px] font-black text-navy">PM</span>
            <div>
              <div className="text-[15px] font-semibold leading-tight">ESNS PM Dashboard</div>
              <div className="text-[11px] text-white/60">Project overview &amp; cost performance</div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-white/70">
            Job
            <JobPicker jobs={jobs.items} value={jobId} onChange={(job) => set({ job })} />
          </label>

          <label className="flex items-center gap-2 text-[12px] text-white/70">
            As of
            <input
              type="date"
              className="h-8 rounded border border-white/20 bg-white px-2 text-[13px] text-ink"
              value={asOf}
              onChange={(e) => set({ asOf: e.target.value || undefined })}
            />
          </label>

          <div className="ml-auto flex items-center gap-3 text-[11px] text-white/60">
            {jobs.source === "demo" && (
              <span className="rounded bg-gold/90 px-2 py-0.5 font-semibold text-navy" title="No Incorta SQL endpoint configured — showing sample data">
                DEMO DATA
              </span>
            )}
            {session.user && <span>{session.user}</span>}
          </div>
        </div>

        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Dashboard sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ tab: t.id === "overview" ? undefined : t.id })}
              className={cn(
                "whitespace-nowrap rounded-t-md px-4 py-2 text-[13px] font-medium transition-colors",
                tab === t.id ? "bg-canvas text-navy" : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
        {!job ? (
          <div className="mx-auto mt-16 max-w-md rounded-lg border border-line bg-panel p-8 text-center">
            <div className="text-base font-semibold">Choose a job to get started</div>
            <p className="mt-2 text-sm text-sub">
              Pick a job from the selector above. Figures are as of {fmtShort(asOf)} (defaults to the most recent Sunday).
            </p>
          </div>
        ) : tab === "overview" ? (
          <OverviewTab jobId={job.jobId} asOf={asOf} />
        ) : tab === "po" ? (
          <CommitmentsTab jobId={job.jobId} asOf={asOf} />
        ) : tab === "invoicing" ? (
          <InvoicingTab jobId={job.jobId} asOf={asOf} />
        ) : (
          <TrackerTab
            jobId={job.jobId}
            from={search.from ?? addDays(session.pastSunday, -12 * 7)}
            to={search.to ?? session.pastSunday}
            onPeriod={(from, to) => set({ from, to })}
          />
        )}
      </main>
    </div>
  );
}
