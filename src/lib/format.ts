/** Number formatting pinned to en-US so SSR and client output match. */

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const money = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : usd0.format(v));
export const money2 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : usd2.format(v));
export const moneyCompact = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : compact.format(v);
export const qty = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : num.format(v));
export const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;
export const ratio = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
