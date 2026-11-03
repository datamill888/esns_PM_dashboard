import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtShort, type ISODate } from "@/lib/dates";
import { money, moneyCompact, ratio } from "@/lib/format";
import type { TrackerCell } from "@/lib/types";
import { getTracker, saveTracker } from "@/server/fns";
import { TrackerGrid } from "./TrackerGrid";
import { Card, ErrorBox, Loading, Stat } from "./ui";

export function TrackerTab({
  jobId,
  from,
  to,
  onPeriod,
}: {
  jobId: string;
  from: ISODate;
  to: ISODate;
  onPeriod: (from: ISODate, to: ISODate) => void;
}) {
  const qc = useQueryClient();
  const queryKey = ["tracker", jobId, from, to];
  const q = useQuery({ queryKey, queryFn: () => getTracker({ data: { jobId, from, to } }) });

  const actuals = useMemo(() => new Map(q.data?.actuals ?? []), [q.data]);

  async function save(cells: Array<Omit<TrackerCell, "amount"> & { amount: number | null }>) {
    await saveTracker({ data: { jobId, cells } });
    // Optimistically merge into the cache so totals and KPIs update immediately.
    qc.setQueryData(queryKey, (old: typeof q.data) => {
      if (!old) return old;
      const map = new Map(old.cells.map((c) => [`${c.series}|${c.costType}|${c.weekEnding}`, c]));
      for (const c of cells) {
        const k = `${c.series}|${c.costType}|${c.weekEnding}`;
        if (c.amount == null) map.delete(k);
        else map.set(k, { ...c, amount: c.amount });
      }
      return { ...old, cells: [...map.values()] };
    });
  }

  const sums = useMemo(() => {
    const t = { BASELINE: 0, FORECAST: 0, EV: 0 };
    for (const c of q.data?.cells ?? []) t[c.series] += c.amount;
    const actual = [...actuals.values()].reduce((a, b) => a + b, 0);
    return { ...t, actual };
  }, [q.data, actuals]);

  const chart = useMemo(() => {
    if (!q.data) return [];
    let bl = 0, fc = 0, ev = 0, ac = 0;
    return q.data.weeks.map((w) => {
      for (const c of q.data.cells) {
        if (c.weekEnding !== w) continue;
        if (c.series === "BASELINE") bl += c.amount;
        else if (c.series === "FORECAST") fc += c.amount;
        else ev += c.amount;
      }
      for (const ct of q.data.costTypes) ac += actuals.get(`${ct.code}|${w}`) ?? 0;
      return { week: w, Baseline: bl, Forecast: fc, "Earned Value": ev, ...(q.data.source === "incorta" ? { Actual: ac } : {}) };
    });
  }, [q.data, actuals]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-navy px-4 py-2.5 text-white">
        <span className="grid h-6 w-7 place-items-center rounded bg-accent text-[10px] font-black text-navy">EV</span>
        <span className="text-[14px] font-semibold">Cost Performance Tracker</span>
        <span className="mx-1 h-5 w-px bg-white/20" />
        <label className="flex items-center gap-2 text-[12px] text-white/70">
          Period
          <input type="date" className="h-7 rounded bg-white px-2 text-[12px] text-ink" value={from} max={to} onChange={(e) => e.target.value && onPeriod(e.target.value, to)} />
          <span>—</span>
          <input type="date" className="h-7 rounded bg-white px-2 text-[12px] text-ink" value={to} min={from} onChange={(e) => e.target.value && onPeriod(from, e.target.value)} />
        </label>
        {q.data && !q.data.persisted && (
          <span className="ml-auto rounded bg-accent/90 px-2 py-0.5 text-[11px] font-semibold text-navy" title="No app database configured — entries are kept in memory only">
            NOT SAVED (local preview)
          </span>
        )}
      </div>

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="Total Baseline" value={money(sums.BASELINE)} tone="bl" />
            <Stat label="Total Forecast" value={money(sums.FORECAST)} tone="fc" />
            <Stat label="Earned Value" value={money(sums.EV)} tone="ev" />
            <Stat label="CPI" value={sums.FORECAST ? ratio(sums.EV / sums.FORECAST) : "—"} sub="Earned Value ÷ Forecast" valueClass={cpiClass(sums.EV, sums.FORECAST)} />
            <Stat label="PF" value={sums.BASELINE ? ratio(sums.EV / sums.BASELINE) : "—"} sub="Earned Value ÷ Baseline" valueClass={cpiClass(sums.EV, sums.BASELINE)} />
            {q.data.source === "incorta" && (
              <Stat label="EV ÷ Actual" value={sums.actual ? ratio(sums.EV / sums.actual) : "—"} sub={`Actual (JC) ${money(sums.actual)}`} tone="ac" valueClass={cpiClass(sums.EV, sums.actual)} />
            )}
          </div>

          <Card title={`Input Table — ${q.data.weeks.length} weeks`} right="Tab or click away from a cell to save · paste a block from Excel">
            <TrackerGrid costTypes={q.data.costTypes} weeks={q.data.weeks} cells={q.data.cells} actuals={q.data.source === "incorta" ? actuals : undefined} onSave={save} />
          </Card>

          <Card title="Cumulative Performance">
            <div className="h-[300px] px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={(v: string) => fmtShort(v).slice(0, -5)} tick={{ fontSize: 11, fill: "#6b7686" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v: number) => moneyCompact(v)} tick={{ fontSize: 11, fill: "#6b7686" }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(l) => `Week of ${fmtShort(String(l))}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Baseline" stroke="var(--color-bl)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Forecast" stroke="var(--color-fc)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Earned Value" stroke="var(--color-ev)" strokeWidth={2} dot={false} />
                  {q.data.source === "incorta" && <Line type="monotone" dataKey="Actual" stroke="var(--color-ac)" strokeWidth={2} strokeDasharray="4 3" dot={false} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function cpiClass(num: number, den: number) {
  if (!den) return "text-muted";
  return num / den >= 1 ? "text-good" : "text-bad";
}
