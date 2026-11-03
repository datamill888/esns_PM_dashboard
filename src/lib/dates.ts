/**
 * Date helpers. Everything works on ISO "YYYY-MM-DD" strings in UTC so the
 * server render and the client hydrate identically (no local-timezone drift).
 *
 * Penta's Week_Ending is a Sunday (Incorta: addDays(weekEndDate(d), 1)).
 */

export type ISODate = string;

const DAY = 86_400_000;

export function parseISO(d: ISODate): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return toISO(new Date(parseISO(d).getTime() + n * DAY));
}

/** Most recent Sunday on or before `d` (Incorta $Past_Sunday semantics). */
export function sundayOnOrBefore(d: ISODate): ISODate {
  const dow = parseISO(d).getUTCDay(); // 0 = Sunday
  return addDays(d, -dow);
}

/** The Sunday week-ending that contains `d` (the Sunday on or after). */
export function weekEndingFor(d: ISODate): ISODate {
  const dow = parseISO(d).getUTCDay();
  return dow === 0 ? d : addDays(d, 7 - dow);
}

/** Sunday-anchored weeks from start through end inclusive. */
export function weeksBetween(start: ISODate, end: ISODate, max = 104): ISODate[] {
  const out: ISODate[] = [];
  let cur = sundayOnOrBefore(start);
  while (cur <= end && out.length < max) {
    out.push(cur);
    cur = addDays(cur, 7);
  }
  return out;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY);
}

/** 8/16/2026 style, fixed (not locale-dependent) for hydration safety. */
export function fmtShort(d: ISODate | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${m}/${day}/${y}`;
}

export function todayISO(): ISODate {
  return toISO(new Date());
}
