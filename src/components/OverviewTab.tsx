import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtShort, type ISODate } from "@/lib/dates";
import { money, moneyCompact, pct } from "@/lib/format";
import { getOverview } from "@/lib/api/pm.functions";
import { Card, Delta, Empty, ErrorBox, Loading, Stat } from "./ui";

export function OverviewTab({ jobId, asOf }: { jobId: string; asOf: ISODate }) {
  const q = useQuery({
    queryKey: ["overview", jobId, asOf],
    queryFn: () => getOverview({ data: { jobId, asOf } }),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} />;
  const d = q.data;
  const h = d.header;

  const spend = d.byCostType.reduce((s, r) => s + r.spendToDate, 0);
  const budget = d.byCostType.reduce((s, r) => s + r.budget, 0);
  const period = d.weekly.reduce((s, r) => s + r.periodSpend, 0);
  const last = d.weekly.reduce((s, r) => s + r.lastPeriodSpend, 0);
  const days = Math.max(1, d.daysElapsed);

  return (
    <div className="space-y-5">
      {h && (
        <Card title="Total Project Performance" right={h.latestWeekEnding ? `Latest week ending ${fmtShort(h.latestWeekEnding)}` : null}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Job", `${h.jobId} — ${h.name}`],
              ["Project Manager", h.projectManager],
              ["Executive", h.executive],
              ["Contract / PO / IWR #", h.contractRef],
              ["Contract Type", h.contractType],
              ["Market", h.market],
              ["Work Type", h.workType],
              ["Contract Status", h.contractStatus],
              ["Job Date", fmtShort(h.jobDate)],
              ["Days Elapsed", String(d.daysElapsed)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-sub">{k}</dt>
                <dd className="truncate text-[13px] font-medium" title={v ?? ""}>{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Stat label="Budget (EST)" value={money(budget)} tone="bl" />
        <Stat label="Spend to Date (JC)" value={money(spend)} tone="ac" sub={budget ? `${pct(spend / budget)} of budget` : undefined} />
        <Stat
          label="Budget Remaining"
          value={money(budget - spend)}
          tone={budget - spend >= 0 ? "ev" : "neutral"}
          valueClass={budget - spend < 0 ? "text-bad" : undefined}
        />
        <Stat label="This Week Spend" value={money(period)} tone="fc" sub={<>vs last week <Delta value={period - last} goodWhenPositive={false}>{money(period - last)}</Delta></>} />
        <Stat label="Avg Weekly Spend" value={money((spend / days) * 7)} sub={`${money(spend / days)}/day · ${money((spend / days) * 30)}/mo`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Weekly Performance" right="by cost type">
          {d.weekly.length === 0 ? (
            <Empty>No spend recorded in the last two weeks.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Cost Type</th>
                    <th className="r">Period Spend</th>
                    <th className="r">Last Period</th>
                    <th className="r">Change</th>
                    <th className="r">Change %</th>
                  </tr>
                </thead>
                <tbody>
                  {d.weekly.map((r) => {
                    const ch = r.periodSpend - r.lastPeriodSpend;
                    return (
                      <tr key={r.costType}>
                        <td><span className="font-semibold">{r.costType}</span> <span className="text-sub">{r.costTypeDescr}</span></td>
                        <td className="num r">{money(r.periodSpend)}</td>
                        <td className="num r">{money(r.lastPeriodSpend)}</td>
                        <td className="r"><Delta value={ch} goodWhenPositive={false}>{money(ch)}</Delta></td>
                        <td className="r"><Delta value={ch} goodWhenPositive={false}>{r.lastPeriodSpend ? pct(ch / r.lastPeriodSpend) : "—"}</Delta></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num r">{money(period)}</td>
                    <td className="num r">{money(last)}</td>
                    <td className="r"><Delta value={period - last} goodWhenPositive={false}>{money(period - last)}</Delta></td>
                    <td className="r"><Delta value={period - last} goodWhenPositive={false}>{last ? pct((period - last) / last) : "—"}</Delta></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <Card title="Weekly Spend Trend" right="actual cost (JC) by week ending">
          {d.trend.length === 0 ? (
            <Empty>No weekly spend yet.</Empty>
          ) : (
            <div className="h-[260px] px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.trend} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-ac)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--color-ac)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef1f5" vertical={false} />
                  <XAxis dataKey="weekEnding" tickFormatter={(v: string) => fmtShort(v).slice(0, -5)} tick={{ fontSize: 11, fill: "#6b7686" }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v: number) => moneyCompact(v)} tick={{ fontSize: 11, fill: "#6b7686" }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(l) => `Week ending ${fmtShort(String(l))}`} />
                  <Area type="monotone" dataKey="spend" name="Spend" stroke="var(--color-ac)" strokeWidth={2} fill="url(#spendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card title="Total Project Performance" right="by cost type">
        <PerfTable
          rows={d.byCostType.map((r) => ({ key: r.costType, code: r.costType, descr: r.costTypeDescr, spend: r.spendToDate, budget: r.budget }))}
          days={days}
          showAverages
          codeLabel="Cost Type"
        />
      </Card>

      <Card title="Total Project Performance — Cost Codes">
        <PerfTable
          rows={d.byCostCode.map((r) => ({ key: r.costCode, code: r.costCode, descr: r.costCodeDescr, spend: r.spendToDate, budget: r.budget }))}
          days={days}
          codeLabel="Cost Code"
        />
      </Card>
    </div>
  );
}

function PerfTable({
  rows,
  days,
  showAverages,
  codeLabel,
}: {
  rows: { key: string; code: string; descr: string; spend: number; budget: number }[];
  days: number;
  showAverages?: boolean;
  codeLabel: string;
}) {
  if (rows.length === 0) return <Empty>No budget or cost recorded for this job yet.</Empty>;
  const tSpend = rows.reduce((s, r) => s + r.spend, 0);
  const tBudget = rows.reduce((s, r) => s + r.budget, 0);
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="dtable">
        <thead>
          <tr>
            <th>{codeLabel}</th>
            <th>Description</th>
            {showAverages && (
              <>
                <th className="r">Daily Avg</th>
                <th className="r">Weekly Avg</th>
                <th className="r">Monthly Avg</th>
              </>
            )}
            <th className="r">Spend to Date</th>
            <th className="r">Budget</th>
            <th className="r">Remaining</th>
            <th className="min-w-[140px]">% Spent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rem = r.budget - r.spend;
            const p = r.budget ? r.spend / r.budget : null;
            return (
              <tr key={r.key}>
                <td className="font-semibold">{r.code}</td>
                <td className="max-w-[280px] truncate text-sub" title={r.descr}>{r.descr}</td>
                {showAverages && (
                  <>
                    <td className="num r">{money(r.spend / days)}</td>
                    <td className="num r">{money((r.spend / days) * 7)}</td>
                    <td className="num r">{money((r.spend / days) * 30)}</td>
                  </>
                )}
                <td className="num r">{money(r.spend)}</td>
                <td className="num r">{money(r.budget)}</td>
                <td className="r"><Delta value={rem}>{money(rem)}</Delta></td>
                <td><Bar p={p} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total</td>
            {showAverages && (
              <>
                <td className="num r">{money(tSpend / days)}</td>
                <td className="num r">{money((tSpend / days) * 7)}</td>
                <td className="num r">{money((tSpend / days) * 30)}</td>
              </>
            )}
            <td className="num r">{money(tSpend)}</td>
            <td className="num r">{money(tBudget)}</td>
            <td className="r"><Delta value={tBudget - tSpend}>{money(tBudget - tSpend)}</Delta></td>
            <td><Bar p={tBudget ? tSpend / tBudget : null} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Bar({ p }: { p: number | null }) {
  if (p == null) return <span className="text-sub">—</span>;
  const w = Math.min(100, Math.max(0, p * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
        <div className={p > 1 ? "h-full bg-bad" : p > 0.9 ? "h-full bg-fc" : "h-full bg-bl"} style={{ width: `${w}%` }} />
      </div>
      <span className="num text-[12px] text-sub">{pct(p)}</span>
    </div>
  );
}
