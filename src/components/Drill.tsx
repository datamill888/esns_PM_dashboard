import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fmtShort, type ISODate } from "@/lib/dates";
import { cn, money, money2, qty } from "@/lib/format";
import type { DrillColumnType, DrillOpen, DrillRequest, DrillResult } from "@/lib/types";
import { getDrill } from "@/lib/api/pm.functions";

/* ------------------------------ context ------------------------------ */

const DrillCtx = createContext<((d: DrillOpen) => void) | null>(null);

/** Wrap a tab (or the whole dashboard) so any <Drill> inside can open the panel. */
export function DrillProvider({ jobId, asOf, children }: { jobId: string; asOf: ISODate; children: ReactNode }) {
  const [open, setOpen] = useState<DrillOpen | null>(null);
  // Close the panel when the job or date changes underneath it.
  useEffect(() => setOpen(null), [jobId, asOf]);
  return (
    <DrillCtx.Provider value={setOpen}>
      {children}
      {open && <DrillPanel jobId={jobId} asOf={asOf} drill={open} onClose={() => setOpen(null)} />}
    </DrillCtx.Provider>
  );
}

export function useDrill() {
  return useContext(DrillCtx);
}

/**
 * A clickable value. Renders its children as a button that opens the
 * transactions behind the number. Outside a DrillProvider it renders plain.
 */
export function Drill({
  title,
  subtitle,
  request,
  value,
  valueColumn,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  request: DrillRequest;
  value?: number;
  valueColumn?: string;
  children: ReactNode;
  className?: string;
}) {
  const open = useDrill();
  if (!open) return <>{children}</>;
  return (
    <button
      type="button"
      className={cn(
        "num cursor-pointer rounded-sm text-inherit underline decoration-dotted decoration-1 underline-offset-[3px] [text-decoration-color:rgb(107_118_134/0.45)] hover:bg-bl-soft hover:text-bl hover:decoration-solid focus-visible:outline-2 focus-visible:outline-bl",
        className,
      )}
      title="Show the transactions behind this value"
      onClick={(e) => {
        e.stopPropagation();
        open({ title, subtitle, request, clickedValue: value, valueColumn });
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------ panel ------------------------------ */

function fmt(v: string | number | null, t: DrillColumnType): string {
  if (v == null || v === "") return "";
  if (t === "money") return money2(Number(v));
  if (t === "num") return qty(Number(v));
  if (t === "date") return fmtShort(String(v));
  return String(v);
}

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function DrillPanel({ jobId, asOf, drill, onClose }: { jobId: string; asOf: ISODate; drill: DrillOpen; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["drill", jobId, asOf, drill.request],
    queryFn: () => getDrill({ data: { jobId, asOf, request: drill.request, demoTotal: drill.clickedValue } }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const data = q.data;
  const rows = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    let out = f
      ? data.rows.filter((r) => data.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(f)))
      : data.rows;
    if (sort) {
      const col = data.columns.find((c) => c.key === sort.key);
      const numeric = col && (col.type === "money" || col.type === "num");
      out = [...out].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [data, filter, sort]);

  // Hide columns that are empty in every returned row (e.g. Employee on AP lines).
  const columns = useMemo(
    () => (data ? data.columns.filter((c) => data.rows.some((r) => r[c.key] != null && r[c.key] !== "")) : []),
    [data],
  );

  const valueKey = drill.valueColumn ?? "amt";
  const total = data?.totals[valueKey];
  const diff = drill.clickedValue != null && total != null ? total - drill.clickedValue : 0;
  const reconciles = Math.abs(diff) < 0.5;

  const download = useCallback(() => {
    if (!data) return;
    const lines = [data.columns.map((c) => csvCell(c.label)).join(",")];
    for (const r of rows) lines.push(data.columns.map((c) => csvCell(r[c.key])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${jobId}-${drill.title.replace(/[^\w-]+/g, "_").slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, rows, jobId, drill.title]);

  const filteredTotals = useMemo(() => {
    const t: Record<string, number> = {};
    if (!data) return t;
    for (const c of columns) if (c.type === "money" || c.type === "num") t[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return t;
  }, [data, rows, columns]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={drill.title}>
      <div className="absolute inset-0 bg-navy/30" onClick={onClose} />
      <aside className="relative flex h-full w-[min(1240px,100vw)] flex-col bg-panel shadow-2xl">
        <header className="flex items-start gap-4 border-b border-line bg-navy px-5 py-3 text-white">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Transactions</div>
            <h2 className="truncate text-[16px] font-semibold">{drill.title}</h2>
            {drill.subtitle && <div className="mt-0.5 text-[12px] text-white/70">{drill.subtitle}</div>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[13px] text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            Close ✕
          </button>
        </header>

        {q.isPending ? (
          <div className="px-5 py-12 text-center text-sm text-sub">Loading transactions…</div>
        ) : q.isError ? (
          <div className="m-5 flex items-start gap-4 rounded-md border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
            <div className="flex-1">Couldn&apos;t load the transactions: {q.error instanceof Error ? q.error.message : String(q.error)}</div>
            <button
              type="button"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              className="shrink-0 rounded border border-bad/40 bg-panel px-3 py-1 text-[12px] font-medium text-ink hover:bg-canvas disabled:opacity-50"
            >
              {q.isFetching ? "Retrying…" : "Try again"}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-5 py-3 text-[13px]">
              <div>
                <span className="text-sub">Lines </span>
                <span className="num font-semibold">{data!.count.toLocaleString("en-US")}</span>
              </div>
              {total != null && (
                <div>
                  <span className="text-sub">Total </span>
                  <span className="num font-semibold">{money2(total)}</span>
                </div>
              )}
              {drill.clickedValue != null && total != null && (
                reconciles ? (
                  <span className="rounded bg-ev-soft px-2 py-0.5 text-[12px] font-medium text-ev">✓ Matches the value you clicked</span>
                ) : (
                  <span className="rounded bg-fc-soft px-2 py-0.5 text-[12px] font-medium text-fc">
                    Differs from the clicked value ({money2(drill.clickedValue)}) by {money2(diff)}
                  </span>
                )
              )}
              {data!.source === "demo" && <span className="rounded bg-gold/90 px-2 py-0.5 text-[11px] font-semibold text-navy">DEMO DATA</span>}
              <div className="ml-auto flex items-center gap-2">
                <input
                  className="h-8 w-56 rounded border border-line px-2 text-[12px]"
                  placeholder="Filter these lines…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <button type="button" onClick={download} className="h-8 rounded border border-line px-3 text-[12px] font-medium hover:bg-canvas">
                  Download CSV
                </button>
              </div>
            </div>

            {data!.truncated && (
              <div className="border-b border-line bg-fc-soft px-5 py-2 text-[12px] text-fc">
                Showing the latest {data!.rows.length.toLocaleString("en-US")} of {data!.count.toLocaleString("en-US")} lines. The totals above cover all of them.
              </div>
            )}

            {data!.rows.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-sub">No transactions make up this value.</div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="dtable">
                  <thead>
                    <tr>
                      {columns.map((c) => {
                        const right = c.type === "money" || c.type === "num";
                        const active = sort?.key === c.key;
                        return (
                          <th key={c.key} className={right ? "r" : undefined}>
                            <button
                              type="button"
                              className="uppercase hover:text-ink"
                              onClick={() => setSort(active ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: right ? -1 : 1 })}
                            >
                              {c.label}
                              {active ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        {columns.map((c) => {
                          const right = c.type === "money" || c.type === "num";
                          const v = r[c.key];
                          return (
                            <td
                              key={c.key}
                              className={cn(right && "num r", c.key === "descr" && "max-w-[320px] truncate", right && Number(v) < 0 && "text-bad")}
                              title={c.type === "text" && v != null ? String(v) : undefined}
                            >
                              {fmt(v, c.type)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      {columns.map((c, i) => (
                        <td key={c.key} className={c.type === "money" || c.type === "num" ? "num r" : undefined}>
                          {i === 0
                            ? filter
                              ? `Filtered (${rows.length})`
                              : data!.truncated
                                ? "Shown lines"
                                : "Total"
                            : c.type === "money"
                              ? money2(filteredTotals[c.key])
                              : c.type === "num"
                                ? qty(filteredTotals[c.key])
                                : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/** Small helper so callers can pass "money(x)" text and the raw value together. */
export function DrillMoney(props: Omit<Parameters<typeof Drill>[0], "children"> & { value: number }) {
  return <Drill {...props}>{money(props.value)}</Drill>;
}
