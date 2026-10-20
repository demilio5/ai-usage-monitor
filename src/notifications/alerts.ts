import type { ProviderData, Settings, Quota } from '../providers/types';
import { NAMES } from '../providers/types';
export interface Alert {
  key: string;
  message: string;
}
export function evaluateAlerts(
  previous: ProviderData,
  next: ProviderData,
  settings: Settings,
  sent: Record<string, number>,
): Alert[] {
  if (!settings.alerts || next.status !== 'ok') return [];
  const results: Alert[] = [];
  for (const q of next.quotas) {
    const cycle = `${next.provider}:${next.account || ''}:${q.id}:${q.resetAt || 'unknown'}`;
    for (const threshold of settings.thresholds) {
      const key = `${cycle}:low:${threshold}`;
      if (q.remaining < threshold && !sent[key])
        results.push({
          key,
          message: `${NAMES[next.provider]} · ${q.label}: ${Math.round(q.remaining)}% remaining (below ${threshold}%).`,
        });
    }
    const old: Quota | undefined =
      previous.account === next.account ? previous.quotas.find((p) => p.id === q.id) : undefined;
    if (settings.resetAlerts && old && old.used - q.used >= 20) {
      const key = `${cycle}:reset:${old.resetAt || 'unknown'}`;
      if (!sent[key])
        results.push({
          key,
          message: `${NAMES[next.provider]} · ${q.label} has replenished to ${Math.round(q.remaining)}% remaining.`,
        });
    }
  }
  return results;
}
