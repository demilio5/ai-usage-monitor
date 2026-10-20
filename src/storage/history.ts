import type { Observation, ProviderData } from '../providers/types';
export function appendHistory(
  history: Observation[],
  p: ProviderData,
  now: number,
  days: number,
): Observation[] {
  const additions =
    p.status === 'ok'
      ? p.quotas.map((q) => ({
          ...q,
          provider: p.provider,
          timestamp: now,
          status: p.status,
          ...(p.account ? { account: p.account } : {}),
        }))
      : [];
  return pruneHistory([...history, ...additions], now, days);
}
export function pruneHistory(history: Observation[], now: number, days: number): Observation[] {
  const bins = new Map<string, Observation>();
  for (const p of history) {
    if (p.timestamp < now - days * 86400000 || p.timestamp > now) continue;
    // Keep minute samples for one day; older observations use 15-minute bins, separated by cycle.
    const width = now - p.timestamp <= 86400000 ? 60000 : 900000;
    const key = `${p.provider}:${p.account || ''}:${p.id}:${p.resetAt}:${Math.floor(p.timestamp / width)}`;
    bins.set(key, p);
  }
  return [...bins.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-18000);
}
const csvCell = (s: unknown) => '"' + String(s ?? '').replaceAll('"', '""') + '"';
export function exportCSV(history: Observation[]): string {
  return [
    'provider,window,timestamp,used_percent,remaining_percent,reset_timestamp,data_source,status',
    ...history.map((p) =>
      [
        p.provider,
        p.id,
        new Date(p.timestamp).toISOString(),
        p.used,
        p.remaining,
        p.resetAt ? new Date(p.resetAt).toISOString() : '',
        p.source,
        p.status,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');
}
