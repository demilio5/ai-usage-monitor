import type { Observation, Quota, ProviderId } from '../providers/types';
import { duration } from '../utils/time';
import { sameResetCycle } from './quota';
export interface Forecast {
  rate: number | null;
  exhaustionMs: number | null;
  usedAtReset: number | null;
  message: string;
  samples: number;
  resetsBeforeEmpty: boolean;
}
export function forecast(
  history: Observation[],
  provider: ProviderId,
  q: Quota,
  hours: number,
  now: number,
  account?: string,
  interval = 5,
  idleAware = false,
): Forecast {
  const unavailable: Forecast = {
    rate: null,
    exhaustionMs: null,
    usedAtReset: null,
    message:
      hours * 60 < interval * 2 ? 'Refresh too infrequent for lookback' : 'Insufficient data',
    samples: 0,
    resetsBeforeEmpty: false,
  };
  if (q.resetAt !== null && q.resetAt <= now)
    return { ...unavailable, message: 'Awaiting reset update' };
  if (q.remaining === 0) return { ...unavailable, exhaustionMs: 0, message: 'Allowance exhausted' };
  // Keep the selected lookback. Manual readings may still provide enough samples
  // when the automatic interval would otherwise be too long.
  const cadence = idleAware ? Math.max(60, interval) : interval;
  let points = history
    .filter(
      (p) =>
        p.provider === provider &&
        p.id === q.id &&
        p.account === account &&
        p.status === 'ok' &&
        sameResetCycle(p.resetAt, q.resetAt) &&
        p.timestamp >= now - hours * 3600000 &&
        p.timestamp <= now,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
  // A decrease may be a sliding-window release, a plan change, or a reset. Start a new segment.
  let start = 0;
  for (let i = 1; i < points.length; i++)
    if (
      points[i].used < points[i - 1].used - 0.1 ||
      points[i].timestamp - points[i - 1].timestamp > Math.max(1800000, cadence * 180000)
    )
      start = i;
  points = points.slice(start);
  const last = points.at(-1);
  if (last && now - last.timestamp > Math.max(900000, cadence * 120000))
    return {
      ...unavailable,
      samples: points.length,
      message: 'Latest reading too old; refresh to update',
    };
  if (points.length < 3)
    return {
      ...unavailable,
      samples: points.length,
      message:
        hours * 60 < interval * 2
          ? 'Refresh too infrequent for lookback'
          : `Need ${3 - points.length} more reading${points.length === 2 ? '' : 's'}`,
    };
  const first = points[0],
    latest = last!;
  const span = latest.timestamp - first.timestamp;
  if (span < 900000)
    return {
      ...unavailable,
      samples: points.length,
      message: `Need ${Math.ceil((900000 - span) / 60000)} more minutes of readings`,
    };
  const rate = (latest.used - first.used) / (span / 3600000);
  if (rate <= 0)
    return {
      ...unavailable,
      rate: 0,
      message: 'No consumption observed in this sample window',
      samples: points.length,
    };
  const exhaustionMs = (q.remaining / rate) * 3600000;
  const untilReset = q.resetAt === null ? null : q.resetAt - now;
  return {
    rate,
    exhaustionMs,
    usedAtReset: untilReset === null ? null : Math.min(100, q.used + (rate * untilReset) / 3600000),
    message:
      untilReset === null
        ? 'Reset time unavailable'
        : untilReset < exhaustionMs
          ? 'Likely to reset before running out.'
          : 'May run out before the next reset.',
    samples: points.length,
    resetsBeforeEmpty: untilReset !== null && untilReset <= exhaustionMs,
  };
}
export function forecastText(f: Forecast | null): string {
  if (!f) return 'Last known readings · stale';
  if (f.exhaustionMs === 0) return 'Allowance exhausted';
  if (f.rate === 0) return 'Forecast: no consumption observed';
  if (f.rate === null) return `Forecast: ${f.message.toLowerCase()}`;
  if (f.resetsBeforeEmpty) return `Likely to reset before empty · ${f.rate.toFixed(1)}%/h`;
  return `Estimated time left ${duration(f.exhaustionMs)} · ${f.rate.toFixed(1)}%/h`;
}

export function weeklyPace(q: Quota, f: Forecast | null, now = Date.now()) {
  if (
    !f ||
    f.rate === null ||
    q.resetAt === null ||
    q.resetAt <= now ||
    (q.id !== 'seven_day' && q.durationMs !== 604800000)
  )
    return null;
  const budgetRate = q.remaining / ((q.resetAt - now) / 3600000);
  return { label: f.rate <= budgetRate ? 'On track' : 'Over budget', budgetRate };
}
