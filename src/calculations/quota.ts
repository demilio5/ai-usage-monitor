import type { Quota } from '../providers/types';
export function percentage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}
export function resetTime(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value < 1e12
        ? value * 1000
        : value
      : typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
        ? Date.parse(value)
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function quota(
  id: string,
  label: string,
  value: unknown,
  reset: unknown,
  durationMs: number | null,
  source: string,
): Quota | null {
  const used = percentage(value);
  return used === null
    ? null
    : { id, label, used, remaining: 100 - used, resetAt: resetTime(reset), durationMs, source };
}
export function current(q: Quota, now = Date.now()): boolean {
  return q.resetAt === null || q.resetAt > now;
}
export function color(remaining: number | null): string {
  return remaining === null
    ? '#78858d'
    : remaining > 50
      ? '#248767'
      : remaining >= 20
        ? '#b88719'
        : '#d14e58';
}
