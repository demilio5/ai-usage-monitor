export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'Unavailable';
  if (ms <= 0) return 'Due · awaiting update';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m % 60}m`;
}
export function countdown(reset: number | null, now = Date.now()): string {
  return duration(reset === null ? null : reset - now);
}
export function age(time: number | null, now = Date.now()): string {
  if (time === null) return 'Never';
  return now - time < 60000 ? 'Just now' : `${duration(now - time)} ago`;
}
export function resetDisplay(
  reset: number | null,
  now = Date.now(),
  locale?: string,
  timeZone?: string,
): { date: string; remaining: string; title: string; iso: string | null } {
  if (reset === null || !Number.isFinite(reset) || !Number.isFinite(new Date(reset).getTime()))
    return { date: 'Unavailable', remaining: '—', title: 'Reset time unavailable', iso: null };
  const timestamp = new Date(reset);
  const yearFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone });
  const includeYear = yearFormat.format(timestamp) !== yearFormat.format(new Date(now));
  const date = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone,
  }).format(timestamp);
  const minutes = Math.max(0, Math.ceil((reset - now) / 60000));
  const remaining =
    reset <= now ? 'Awaiting update' : `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
  const exact = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(timestamp);
  return {
    date,
    remaining,
    title: `Resets ${exact}${reset <= now ? ' · Waiting for a new service reading' : ''}`,
    iso: timestamp.toISOString(),
  };
}
