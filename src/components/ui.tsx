import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-panel shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {right && <div className="text-[11px] text-muted">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const toneBorder = {
  bl: "border-l-bl",
  fc: "border-l-fc",
  ev: "border-l-ev",
  ac: "border-l-ac",
  neutral: "border-l-line",
} as const;
const toneText = {
  bl: "text-bl",
  fc: "text-fc",
  ev: "text-ev",
  ac: "text-ac",
  neutral: "text-ink",
} as const;

export type Tone = keyof typeof toneBorder;

export function Stat({ label, value, sub, tone = "neutral", valueClass }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; valueClass?: string }) {
  return (
    <div className={cn("min-w-[150px] flex-1 rounded-lg border border-line border-l-4 bg-panel px-4 py-3", toneBorder[tone])}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={cn("num mt-1 text-xl font-bold", valueClass ?? toneText[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-md border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
      Couldn&apos;t load this data: {msg}
    </div>
  );
}

export function Loading() {
  return <div className="px-4 py-10 text-center text-sm text-muted">Loading…</div>;
}

/** Signed value colored good/bad. `goodWhenPositive` flips the sense. */
export function Delta({ value, children, goodWhenPositive = true }: { value: number; children: ReactNode; goodWhenPositive?: boolean }) {
  const good = goodWhenPositive ? value >= 0 : value <= 0;
  return <span className={cn("num", value === 0 ? "text-muted" : good ? "text-good" : "text-bad")}>{children}</span>;
}
