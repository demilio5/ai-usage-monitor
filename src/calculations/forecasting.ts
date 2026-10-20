import type { Observation, Quota, ProviderId } from '../providers/types';
import { duration } from '../utils/time';
export interface Forecast {
  rate: number | null;
  exhaustionMs: number | null;
  usedAtReset: number | null;
  message: string;
  samples: number;
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
    message: 'Insufficient data',
    samples: 0,
  };
  if (q.resetAt !== null && q.resetAt <= now) return unavailable;
  // Preserve the selected lookback; explain combinations that cannot hold three polls.
  if (hours * 60 < interval * 2)
    return { ...unavailable, message: 'Refresh too infrequent for lookback' };
  const cadence = idleAware ? Math.max(60, interval) : interval;
  let points = history
    .filter(
      (p) =>
        p.provider === provider &&
        p.id === q.id &&
        p.account === account &&
        p.status === 'ok' &&
        p.resetAt === q.resetAt &&
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
  if (points.length < 3) return unavailable;
  const first = points[0],
    last = points.at(-1)!;
  const span = last.timestamp - first.timestamp;
  if (span < 900000 || now - last.timestamp > Math.max(900000, cadence * 120000))
    return unavailable;
  const rate = (last.used - first.used) / (span / 3600000);
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
  };
}
export function forecastText(f: Forecast | null): string {
  if (!f) return 'Last known readings · stale';
  if (f.exhaustionMs === 0) return 'Allowance exhausted';
  if (f.rate === 0) return 'Forecast: no consumption observed';
  if (f.rate === null) return `Forecast: ${f.message.toLowerCase()}`;
  return `Estimated time left ${duration(f.exhaustionMs)} · ${f.rate.toFixed(1)}%/h`;
}
