import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { fmtShort, type ISODate } from "@/lib/dates";
import { money } from "@/lib/format";
import { TRACKER_SERIES, type TrackerCell, type TrackerSeries } from "@/lib/types";

export const SERIES_META: Record<TrackerSeries, { label: string; head: string; soft: string; text: string }> = {
  BASELINE: { label: "Baseline", head: "bg-bl-soft", soft: "bg-bl-soft/60", text: "text-bl" },
  FORECAST: { label: "Forecast", head: "bg-fc-soft", soft: "bg-fc-soft/70", text: "text-fc" },
  EV: { label: "EV (Earned Value)", head: "bg-ev-soft", soft: "bg-ev-soft/70", text: "text-ev" },
};

type SaveCell = Omit<TrackerCell, "amount"> & { amount: number | null };
type CellState = "idle" | "saving" | "error";

const k = (s: TrackerSeries, ct: string, w: ISODate) => `${s}|${ct}|${w}`;

function parseAmount(raw: string): number | null | "invalid" {
  const t = raw.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const neg = /^\(.*\)$/.test(t);
  const n = Number(neg ? t.slice(1, -1) : t);
  if (!Number.isFinite(n)) return "invalid";
  return neg ? -n : n;
}

const display = (n: number | undefined) => (n == null ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

export function TrackerGrid({
  costTypes,
  weeks,
  cells,
  actuals,
  onSave,
}: {
  costTypes: { code: string; descr: string }[];
  weeks: ISODate[];
  cells: TrackerCell[];
  /** Read-only actual spend (Penta JC) by cost type × week, keyed `${ct}|${week}`. */
  actuals?: Map<string, number>;
  onSave: (cells: SaveCell[]) => Promise<void>;
}) {
  const saved = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(k(c.series, c.costType, c.weekEnding), c.amount);
    return m;
  }, [cells]);

  const [draft, setDraft] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<Map<string, CellState>>(new Map());
  const savedRef = useRef(saved);
  savedRef.current = saved;

  // Drop drafts once the server copy catches up.
  useEffect(() => {
    setDraft((d) => {
      if (d.size === 0) return d;
      const next = new Map(d);
      for (const [key, raw] of d) {
        const p = parseAmount(raw);
        const s = saved.get(key);
        if ((p === null && s == null) || (typeof p === "number" && s === p)) next.delete(key);
      }
      return next;
    });
  }, [saved]);

  const value = (s: TrackerSeries, ct: string, w: ISODate): number | undefined => {
    const key = k(s, ct, w);
    const d = draft.get(key);
    if (d !== undefined) {
      const p = parseAmount(d);
      return typeof p === "number" ? p : undefined;
    }
    return saved.get(key);
  };

  async function commit(batch: { key: string; cell: SaveCell }[]) {
    if (batch.length === 0) return;
    setState((m) => {
      const n = new Map(m);
      for (const b of batch) n.set(b.key, "saving");
      return n;
    });
    try {
      await onSave(batch.map((b) => b.cell));
      setState((m) => {
        const n = new Map(m);
        for (const b of batch) n.delete(b.key);
        return n;
      });
    } catch {
      setState((m) => {
        const n = new Map(m);
        for (const b of batch) n.set(b.key, "error");
        return n;
      });
    }
  }

  function onBlur(s: TrackerSeries, ct: string, w: ISODate) {
    const key = k(s, ct, w);
    const raw = draft.get(key);
    if (raw === undefined) return;
    const p = parseAmount(raw);
    if (p === "invalid") {
      setState((m) => new Map(m).set(key, "error"));
      return;
    }
    if ((p ?? null) === (savedRef.current.get(key) ?? null)) return;
    void commit([{ key, cell: { series: s, costType: ct, weekEnding: w, amount: p } }]);
  }

  /** Paste a block from Excel: rows → cost types, columns → weeks. */
  function onPaste(e: ClipboardEvent<HTMLInputElement>, s: TrackerSeries, ctIdx: number, wIdx: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return; // single value: normal paste
    e.preventDefault();
    const rows = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((r) => r.split("\t"));
    const batch: { key: string; cell: SaveCell }[] = [];
    const nextDraft = new Map(draft);
    rows.forEach((cols, ri) => {
      const ct = costTypes[ctIdx + ri];
      if (!ct) return;
      cols.forEach((raw, ci) => {
        const w = weeks[wIdx + ci];
        if (!w) return;
        const p = parseAmount(raw);
        if (p === "invalid") return;
        const key = k(s, ct.code, w);
        nextDraft.set(key, raw.trim());
        batch.push({ key, cell: { series: s, costType: ct.code, weekEnding: w, amount: p } });
      });
    });
    setDraft(nextDraft);
    void commit(batch);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-grid]"));
      const i = inputs.indexOf(e.currentTarget);
      // move down one row within the same column
      const col = e.currentTarget.dataset.col;
      const next = inputs.slice(i + 1).find((el) => el.dataset.col === col);
      (next ?? inputs[i + 1])?.focus();
    } else if (e.key === "Escape") {
      const key = e.currentTarget.dataset.key!;
      setDraft((d) => {
        const n = new Map(d);
        n.delete(key);
        return n;
      });
    }
  }

  const colTotal = (s: TrackerSeries, w: ISODate) => costTypes.reduce((sum, ct) => sum + (value(s, ct.code, w) ?? 0), 0);
  const rowTotal = (s: TrackerSeries, ct: string) => weeks.reduce((sum, w) => sum + (value(s, ct, w) ?? 0), 0);
  const grand = (s: TrackerSeries) => weeks.reduce((sum, w) => sum + colTotal(s, w), 0);

  const headerRow = (bg: string) => (
    <tr>
      <th className={`sticky left-0 z-10 min-w-[230px] border-b border-line px-3 py-2 text-left ${bg}`} />
      {weeks.map((w) => (
        <th key={w} className="min-w-[110px] border-b border-line px-2 py-2 text-center text-[11px] font-medium text-muted">
          {fmtShort(w)}
        </th>
      ))}
      <th className="min-w-[120px] border-b border-l border-line bg-canvas px-3 py-2 text-right text-[11px] font-semibold uppercase text-muted">Total</th>
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <tbody>
          {TRACKER_SERIES.map((s) => {
            const meta = SERIES_META[s];
            return (
              <Fragment key={s}>
                <tr>
                  <td colSpan={weeks.length + 2} className={`sticky left-0 border-y border-line px-4 py-2 font-semibold ${meta.head} ${meta.text}`}>
                    {meta.label}
                  </td>
                </tr>
                {headerRow("bg-panel")}
                {costTypes.map((ct, ci) => (
                  <tr key={ct.code}>
                    <td className="sticky left-0 z-10 max-w-[230px] truncate whitespace-nowrap border-b border-line/70 bg-panel px-3 py-1" title={`${ct.code} — ${ct.descr}`}>
                      <span className="font-semibold">{ct.code}</span>
                      <span className="ml-2 text-[11px] text-muted">{ct.descr}</span>
                    </td>
                    {weeks.map((w, wi) => {
                      const key = k(s, ct.code, w);
                      const d = draft.get(key);
                      return (
                        <td key={w} className="border-b border-line/70 px-1 py-0.5">
                          <input
                            className="cell-input"
                            inputMode="decimal"
                            aria-label={`${meta.label} ${ct.code} week of ${fmtShort(w)}`}
                            data-grid
                            data-col={wi}
                            data-key={key}
                            data-state={state.get(key) ?? "idle"}
                            value={d ?? display(saved.get(key))}
                            onChange={(e) => setDraft((m) => new Map(m).set(key, e.target.value))}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => onBlur(s, ct.code, w)}
                            onKeyDown={onKeyDown}
                            onPaste={(e) => onPaste(e, s, ci, wi)}
                          />
                        </td>
                      );
                    })}
                    <td className="num border-b border-l border-line/70 bg-canvas px-3 text-right font-medium">{money(rowTotal(s, ct.code))}</td>
                  </tr>
                ))}
                <tr className={meta.soft}>
                  <td className={`sticky left-0 z-10 border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted ${meta.head}`}>Total</td>
                  {weeks.map((w) => (
                    <td key={w} className="num border-b border-line px-3 py-2 text-right font-semibold">
                      {colTotal(s, w) ? money(colTotal(s, w)) : ""}
                    </td>
                  ))}
                  <td className={`num border-b border-l border-line px-3 py-2 text-right font-bold ${meta.text}`}>{money(grand(s))}</td>
                </tr>
              </Fragment>
            );
          })}

          {actuals && (
            <>
              <tr>
                <td colSpan={weeks.length + 2} className="sticky left-0 border-y border-line bg-canvas px-4 py-2 font-semibold text-ac">
                  Actual (Penta JC — read only)
                </td>
              </tr>
              {headerRow("bg-panel")}
              {costTypes.map((ct) => (
                <tr key={ct.code}>
                  <td className="sticky left-0 z-10 max-w-[230px] truncate whitespace-nowrap border-b border-line/70 bg-panel px-3 py-1.5" title={`${ct.code} — ${ct.descr}`}>
                    <span className="font-semibold">{ct.code}</span>
                    <span className="ml-2 text-[11px] text-muted">{ct.descr}</span>
                  </td>
                  {weeks.map((w) => {
                    const v = actuals.get(`${ct.code}|${w}`);
                    return (
                      <td key={w} className="num border-b border-line/70 px-3 py-1.5 text-right text-muted">
                        {v ? money(v) : ""}
                      </td>
                    );
                  })}
                  <td className="num border-b border-l border-line/70 bg-canvas px-3 text-right font-medium">
                    {money(weeks.reduce((sum, w) => sum + (actuals.get(`${ct.code}|${w}`) ?? 0), 0))}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
