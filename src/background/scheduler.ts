import type { ProviderData, Settings } from '../providers/types';
import { current } from '../calculations/quota';
export function stale(p: ProviderData, settings: Settings, now = Date.now()): boolean {
  return (
    p.status !== 'ok' ||
    p.lastSuccess === null ||
    now - p.lastSuccess > Math.max(settings.interval * 120000, 120000) ||
    (p.quotas.length > 0 && p.quotas.every((q) => !current(q, now)))
  );
}
export function nextRetry(
  status: ProviderData['status'],
  failures: number,
  now: number,
  interval: number,
  retryAt = 0,
): number {
  const base =
    status === 'auth' || status === 'blocked' || status === 'unavailable' || status === 'permission'
      ? Math.max(30, interval)
      : interval;
  return Math.max(
    retryAt,
    now +
      Math.min(Math.max(360, interval), base * 2 ** Math.min(Math.max(0, failures - 1), 8)) * 60000,
  );
}
export function idleEligibleAt(
  lastAttempt: number | null,
  interval: number,
  isIdle: boolean,
): number {
  return isIdle && lastAttempt !== null ? lastAttempt + Math.max(60, interval) * 60000 : 0;
}
