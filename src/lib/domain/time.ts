export const TZ = "Europe/Rome";

/** Offset in minuti di un fuso rispetto a UTC in un dato istante. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Converte data (YYYY-MM-DD) e ora locale italiana (HH:MM) in ISO UTC. */
export function romeLocalToUtcIso(date: string, time = "00:00"): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, TZ);
  const result = new Date(guess.getTime() - offset * 60000);
  // correzione in prossimità del cambio ora
  const offset2 = tzOffsetMinutes(result, TZ);
  return offset2 === offset ? result.toISOString() : new Date(guess.getTime() - offset2 * 60000).toISOString();
}

const fmtDateTime = new Intl.DateTimeFormat("it-IT", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDate = new Intl.DateTimeFormat("it-IT", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const fmtFull = new Intl.DateTimeFormat("it-IT", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatKickoff(iso: string | null | undefined, timeKnown = true): string {
  if (!iso) return "data da definire";
  const d = new Date(iso);
  return timeKnown ? fmtDateTime.format(d) : `${fmtDate.format(d)} (orario da definire)`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "mai";
  return fmtFull.format(new Date(iso));
}

/** "3 ore fa", "tra 2 giorni" */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "mai";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("it", { numeric: "auto" });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < min) return "adesso";
  if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  return rtf.format(Math.round(diff / day), "day");
}

export function isFuture(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getTime() > Date.now();
}

export function isOlderThan(iso: string | null | undefined, ms: number): boolean {
  return !iso || Date.now() - new Date(iso).getTime() > ms;
}

export function hoursBetween(aIso: string, bMs = Date.now()): number {
  return (new Date(aIso).getTime() - bMs) / 3_600_000;
}
