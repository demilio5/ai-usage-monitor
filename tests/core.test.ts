import { describe, it, expect, vi, afterEach } from 'vitest';
import { percentage, resetTime, color, quota } from '../src/calculations/quota';
import { forecast, forecastText, weeklyPace, forecastDate } from '../src/calculations/forecasting';
import { badge, selectQuota, tooltip } from '../src/toolbar/badge';
import { emptyStore, validateSettings } from '../src/storage/settings';
import { appendHistory, exportCSV, pruneHistory } from '../src/storage/history';
import { countdown, duration } from '../src/utils/time';
import { nextRetry, stale } from '../src/background/scheduler';
import { evaluateAlerts } from '../src/notifications/alerts';
import type { Observation } from '../src/providers/types';
const now = Date.parse('2026-10-19T19:00:00Z');
const q = quota('five_hour', '5-hour allowance', 40, now + 3600000, 18000000, 'test fixture')!;
function series(values: number[], reset = q.resetAt, step = 900000): Observation[] {
  return values.map((used, i) => ({
    ...q,
    used,
    remaining: 100 - used,
    resetAt: reset,
    provider: 'claude',
    status: 'ok',
    timestamp: now - (values.length - 1 - i) * step,
  }));
}
function ready() {
  const s = emptyStore();
  s.providers.claude = {
    ...s.providers.claude,
    status: 'ok',
    quotas: [{ ...q, id: 'seven_day', label: 'Weekly allowance' }],
    lastSuccess: now,
  };
  return s;
}
describe('accurate percentages', () => {
  it.each([null, undefined, '45', NaN, Infinity, -1, 101])('rejects invalid value %s', (v) =>
    expect(percentage(v)).toBeNull(),
  );
  it('keeps zero as reported zero and calculates remaining', () => {
    expect(quota('x', 'x', 0, null, null, 'test')?.remaining).toBe(100);
    expect(q.remaining).toBe(60);
  });
  it('interprets epoch seconds and timezone offsets identically', () => {
    expect(resetTime(now / 1000)).toBe(now);
    expect(resetTime('2026-10-19T15:00:00-04:00')).toBe(now);
    expect(resetTime('2026-10-19T19:00:00')).toBeNull();
  });
  it('uses exact badge color boundaries', () => {
    expect(color(50)).toBe(color(20));
    expect(color(51)).not.toBe(color(50));
    expect(color(19)).not.toBe(color(20));
  });
});
describe('forecasts from observations', () => {
  it('requires three samples and a 15-minute span', () => {
    expect(forecast(series([10, 20]), 'claude', q, 3, now).rate).toBeNull();
    expect(forecast(series([10, 20, 30], q.resetAt, 60000), 'claude', q, 3, now).rate).toBeNull();
  });
  it('computes rate, exhaustion, and projected reset consumption', () => {
    const f = forecast(series([20, 30, 40]), 'claude', q, 3, now);
    expect(f.rate).toBe(40);
    expect(f.exhaustionMs).toBe(5400000);
    expect(f.usedAtReset).toBe(80);
    expect(f.message).toContain('reset before');
  });
  it('warns about exhaustion before reset', () =>
    expect(forecast(series([0, 20, 40]), 'claude', q, 3, now).message).toContain('May run out'));
  it('includes idle periods in the observed rate', () =>
    expect(forecast(series([40, 40, 40]), 'claude', q, 3, now).rate).toBe(0));
  it('does not extrapolate across replenishment', () =>
    expect(forecast(series([80, 90, 20]), 'claude', q, 3, now).rate).toBeNull());
  it('does not combine reset cycles or different accounts', () => {
    expect(forecast(series([10, 20, 30], now + 7200000), 'claude', q, 3, now).rate).toBeNull();
    expect(forecast(series([10, 20, 30]), 'claude', q, 3, now, 'different').rate).toBeNull();
  });
  it('does not project from expired windows or old readings', () => {
    expect(
      forecast(series([10, 20, 30]), 'claude', { ...q, resetAt: now - 1 }, 3, now).rate,
    ).toBeNull();
    expect(forecast(series([10, 20, 30]), 'claude', q, 3, now + 1800000).rate).toBeNull();
  });
  it('cuts a segment after an observation gap', () =>
    expect(
      forecast(series([10, 20, 30], q.resetAt, 3600000), 'claude', q, 3, now).rate,
    ).toBeNull());
});
describe('badge availability', () => {
  it('starts unavailable with gray badge', () => {
    const s = emptyStore();
    expect(badge(s.providers, s.settings, now).text).toBe('—');
  });
  it('chooses the most constrained quota and honors used display', () => {
    const s = ready();
    s.providers.claude.quotas = [
      { ...q, remaining: 5, used: 95 },
      { ...q, id: 'seven_day', remaining: 18, used: 82 },
    ];
    expect(badge(s.providers, s.settings, now).text).toBe('18%');
    s.settings.display = 'used';
    expect(badge(s.providers, s.settings, now).text).toBe('82%');
  });
  it('honors provider selection and disabled providers', () => {
    const s = ready();
    s.settings.badge = 'codex';
    expect(selectQuota(s.providers, s.settings, now)).toBeNull();
    s.settings.badge = 'auto';
    s.settings.enabled.claude = false;
    expect(selectQuota(s.providers, s.settings, now)).toBeNull();
  });
  it('rejects stale, failed, and expired quota readings', () => {
    const s = ready();
    expect(stale(s.providers.claude, s.settings, now)).toBe(false);
    s.providers.claude.status = 'auth';
    expect(badge(s.providers, s.settings, now).text).toBe('—');
    s.providers.claude.status = 'ok';
    s.providers.claude.quotas = [{ ...q, resetAt: now }];
    expect(badge(s.providers, s.settings, now).text).toBe('—');
  });
  it('includes all providers and stale labels in tooltip', () => {
    const s = ready();
    expect(tooltip(s.providers, s.settings, now)).toContain('ChatGPT');
    expect(tooltip(s.providers, s.settings, now)).toContain('Codex [stale');
  });
});
describe('local history', () => {
  it('records successful readings and keeps failures out of projections', () => {
    const s = ready();
    expect(appendHistory([], s.providers.claude, now, 30)).toHaveLength(1);
    expect(appendHistory([], { ...s.providers.claude, status: 'network' }, now, 30)).toHaveLength(
      0,
    );
  });
  it('prunes retention, removes future samples and caps storage', () => {
    const points = series([10, 20, 30]);
    expect(pruneHistory(points, now + 2 * 86400000, 1)).toHaveLength(0);
    expect(pruneHistory([{ ...points[0], timestamp: now + 1 }], now, 30)).toHaveLength(0);
  });
  it('downsamples older history without merging cycles', () => {
    const p = series([10])[0];
    const older = now - 2 * 86400000;
    expect(
      pruneHistory(
        [
          { ...p, timestamp: older },
          { ...p, timestamp: older + 1 },
          { ...p, timestamp: older + 2, resetAt: now },
        ],
        now,
        30,
      ),
    ).toHaveLength(2);
  });
  it('CSV includes status and uses ISO timestamps without account ids', () => {
    const csv = exportCSV(series([20, 30, 40]));
    expect(csv).toContain('used_percent');
    expect(csv).toContain('2026-10-19T');
    expect(csv).toContain('"ok"');
    expect(csv).not.toContain('account');
  });
});
describe('scheduling and settings', () => {
  it('backs off exponentially and respects Retry-After', () => {
    expect(nextRetry('network', 2, now, 5)).toBe(now + 600000);
    expect(nextRetry('rate-limit', 1, now, 5, now + 7200000)).toBe(now + 7200000);
    expect(nextRetry('auth', 1, now, 5)).toBe(now + 1800000);
  });
  it('validates settings rather than accepting arbitrary values', () => {
    expect(
      validateSettings({
        interval: 0,
        theme: 'x',
        thresholds: [5, 5, 999],
        claudeOrg: '../../bad',
      }),
    ).toMatchObject({ interval: 5, theme: 'auto', thresholds: [5], claudeOrg: '' });
  });
  it('countdowns use absolute times across DST and show due states', () => {
    expect(countdown(now + 3600000, now)).toBe('1h 0m');
    expect(countdown(now - 1, now)).toContain('awaiting');
    expect(countdown(null, now)).toBe('Unavailable');
    expect(duration(25 * 3600000)).toBe('1d 1h');
  });
});
describe('optional notifications', () => {
  it('is disabled by default', () => {
    const s = ready();
    expect(evaluateAlerts(s.providers.claude, s.providers.claude, s.settings, {})).toEqual([]);
  });
  it('deduplicates each threshold per cycle', () => {
    const s = ready();
    s.settings.alerts = true;
    const next = { ...s.providers.claude, quotas: [{ ...q, remaining: 4, used: 96 }] };
    const alerts = evaluateAlerts(s.providers.claude, next, s.settings, {});
    expect(alerts).toHaveLength(4);
    const sent = Object.fromEntries(alerts.map((a) => [a.key, now]));
    expect(evaluateAlerts(s.providers.claude, next, s.settings, sent)).toHaveLength(0);
    next.quotas[0].resetAt = now + 7200000;
    expect(evaluateAlerts(s.providers.claude, next, s.settings, sent)).toHaveLength(4);
  });
  it('reports replenishment and never notifies on failed data', () => {
    const s = ready();
    s.settings.alerts = s.settings.resetAlerts = true;
    const next = {
      ...s.providers.claude,
      quotas: [{ ...s.providers.claude.quotas[0], used: 0, remaining: 100 }],
    };
    expect(
      evaluateAlerts(s.providers.claude, next, s.settings, {}).some((a) => a.key.includes('reset')),
    ).toBe(true);
    expect(
      evaluateAlerts(s.providers.claude, { ...next, status: 'network' }, s.settings, {}),
    ).toHaveLength(0);
  });
});
afterEach(() => vi.restoreAllMocks());
it('accepts extended refresh intervals and preserves long intervals during idle and backoff', async () => {
  const { idleEligibleAt, nextRetry } = await import('../src/background/scheduler');
  for (const minutes of [15, 30, 45, 60, 720, 1440])
    expect(validateSettings({ interval: minutes }).interval).toBe(minutes);
  expect(idleEligibleAt(now, 5, true)).toBe(now + 60 * 60000);
  expect(idleEligibleAt(now, 1440, true)).toBe(now + 1440 * 60000);
  expect(idleEligibleAt(now, 5, false)).toBe(0);
  expect(nextRetry('auth', 1, now, 1440)).toBe(now + 1440 * 60000);
});
it('selects both toolbar values independently and marks stale or disabled providers unavailable', async () => {
  const { toolbarRows } = await import('../src/toolbar/icon');
  const s = ready();
  s.providers.codex = {
    ...s.providers.claude,
    provider: 'codex',
    quotas: [{ ...q, remaining: 38, used: 62 }],
  };
  expect(toolbarRows(s.providers, s.settings, now).map((r) => r.text)).toEqual(['60', '38']);
  s.settings.display = 'used';
  expect(toolbarRows(s.providers, s.settings, now).map((r) => r.text)).toEqual(['40', '62']);
  s.providers.claude.status = 'auth';
  s.settings.enabled.codex = false;
  expect(toolbarRows(s.providers, s.settings, now).map((r) => r.text)).toEqual(['-', '-']);
});
it('pins Claude toolbar to overall weekly allowance without falling back to five-hour or model caps', async () => {
  const { toolbarRows } = await import('../src/toolbar/icon');
  const s = ready();
  s.providers.claude.quotas = [
    { ...q, used: 99, remaining: 1 },
    { ...q, id: 'seven_day', label: 'Weekly allowance', used: 25, remaining: 75 },
    { ...q, id: 'seven_day_sonnet', used: 98, remaining: 2 },
  ];
  expect(toolbarRows(s.providers, s.settings, now)[0].text).toBe('75');
  s.settings.badge = 'claude';
  expect(badge(s.providers, s.settings, now).text).toBe('75%');
  s.providers.claude.quotas[0].resetAt = now - 1;
  expect(toolbarRows(s.providers, s.settings, now)[0].text).toBe('75');
  s.providers.claude.quotas = s.providers.claude.quotas.filter((q) => q.id !== 'seven_day');
  expect(toolbarRows(s.providers, s.settings, now)[0].text).toBe('-');
  expect(badge(s.providers, s.settings, now).text).toBe('—');
});
it('shows reset date followed by total hours remaining in the selected local timezone', async () => {
  const { resetDisplay } = await import('../src/utils/time');
  const now = Date.parse('2026-10-20T12:00:00Z');
  const display = resetDisplay(
    Date.parse('2026-10-22T14:15:00Z'),
    now,
    'en-US',
    'America/New_York',
  );
  expect(display.date).toBe('Oct 22');
  expect(display.remaining).toBe('50h 15m left');
  expect(display.title).toContain('10:15');
  expect(display.iso).toBe('2026-10-22T14:15:00.000Z');
});
it('handles reset dates across DST, local midnight, and year boundaries', async () => {
  const { resetDisplay } = await import('../src/utils/time');
  expect(
    resetDisplay(
      Date.parse('2026-11-01T07:30:00Z'),
      Date.parse('2026-11-01T05:30:00Z'),
      'en-US',
      'America/New_York',
    ).remaining,
  ).toBe('2h 0m left');
  expect(
    resetDisplay(
      Date.parse('2026-10-21T01:00:00Z'),
      Date.parse('2026-10-20T23:00:00Z'),
      'en-US',
      'America/New_York',
    ).date,
  ).toBe('Oct 20');
  expect(
    resetDisplay(
      Date.parse('2027-01-02T12:00:00Z'),
      Date.parse('2026-12-31T12:00:00Z'),
      'en-US',
      'America/New_York',
    ).date,
  ).toBe('Jan 2, 2027');
});
it('keeps unavailable and expired reset times honest', async () => {
  const { resetDisplay } = await import('../src/utils/time');
  expect(resetDisplay(null).date).toBe('Unavailable');
  expect(resetDisplay(Infinity).iso).toBeNull();
  expect(resetDisplay(1e20).iso).toBeNull();
  expect(resetDisplay(now - 1, now).remaining).toBe('Awaiting update');
  expect(resetDisplay(now + 30000, now).remaining).toBe('0h 1m left');
});

it('keeps a current weekly reading usable when a different quota has expired', () => {
  const s = ready();
  s.providers.claude.quotas.push({ ...q, resetAt: now - 1 });
  expect(stale(s.providers.claude, s.settings, now)).toBe(false);
  s.providers.claude.quotas[0].resetAt = now - 1;
  expect(stale(s.providers.claude, s.settings, now)).toBe(true);
});
it('handles hourly idle samples without bridging unrelated gaps in normal mode', () => {
  const weekly = { ...q, resetAt: now + 86400000 };
  const points = series([20, 30, 40], weekly.resetAt, 3600000);
  expect(forecast(points, 'claude', weekly, 3, now, undefined, 5, true).rate).toBe(10);
  expect(forecast(points, 'claude', weekly, 3, now, undefined, 5, false).rate).toBeNull();
});
it('explains incompatible long refresh and lookback settings without extending lookback', () => {
  const weekly = { ...q, resetAt: now + 7 * 86400000 };
  for (const interval of [720, 1440]) {
    const points = series([20, 30, 40], weekly.resetAt, interval * 60000);
    expect(forecast(points, 'claude', weekly, 3, now, undefined, interval).message).toContain(
      'Refresh too infrequent',
    );
  }
  const daily = forecast(
    series([20, 30, 40], weekly.resetAt, 86400000),
    'claude',
    weekly,
    24,
    now,
    undefined,
    1440,
  );
  expect(daily.rate).toBeNull();
  expect(daily.message).toContain('Refresh too infrequent');
});
it('distinguishes exhausted, zero consumption, insufficient, and stale forecast messages', async () => {
  const { forecastText } = await import('../src/calculations/forecasting');
  expect(forecastText(null)).toContain('stale');
  expect(forecastText(forecast([], 'claude', q, 3, now))).toBe('Forecast: need 3 more readings');
  expect(forecastText(forecast(series([40, 40, 40]), 'claude', q, 3, now))).toBe(
    'Forecast: no consumption observed',
  );
  expect(
    forecastText(forecast(series([20, 30, 40]), 'claude', { ...q, remaining: 0 }, 3, now)),
  ).toBe('Allowance exhausted');
});

it('uses valid manual samples even when the automatic refresh interval exceeds lookback', () => {
  expect(forecast(series([20, 30, 40]), 'claude', q, 3, now, undefined, 1440).rate).toBe(40);
});
it('reports exhausted current quotas without requiring samples or a rising trend', async () => {
  const { forecastText } = await import('../src/calculations/forecasting');
  const exhausted = { ...q, used: 100, remaining: 0 };
  for (const points of [[], series([100, 100, 100])])
    expect(forecastText(forecast(points, 'claude', exhausted, 3, now))).toBe('Allowance exhausted');
  expect(
    forecast([], 'claude', { ...exhausted, resetAt: now - 1 }, 3, now).exhaustionMs,
  ).toBeNull();
});

it('keeps forecast samples from the same reset cycle despite Claude subsecond timestamp jitter', () => {
  const points = series([20, 30, 40]);
  const offsets = [437, -183, 445];
  points.forEach((p, i) => {
    p.resetAt = q.resetAt! + offsets[i];
  });
  const result = forecast(points, 'claude', { ...q, resetAt: q.resetAt! + 445 }, 3, now);
  expect(result.samples).toBe(3);
  expect(result.rate).toBe(40);
  expect(result.exhaustionMs).toBe(5400000);
  expect(points[0].resetAt).toBe(q.resetAt! + 437);
});
it('keeps actual resets, missing reset times, and account boundaries separate with timestamp tolerance', async () => {
  const { sameResetCycle } = await import('../src/calculations/quota');
  expect(sameResetCycle(now, now + 2000)).toBe(true);
  expect(sameResetCycle(now, now + 2001)).toBe(false);
  expect(sameResetCycle(null, null)).toBe(true);
  expect(sameResetCycle(null, now)).toBe(false);
  expect(
    forecast(series([20, 30, 40], q.resetAt! - 18000000), 'claude', q, 3, now).rate,
  ).toBeNull();
  expect(forecast(series([20, 30, 40], null), 'claude', q, 3, now).rate).toBeNull();
  expect(
    forecast(series([20, 30, 40], q.resetAt! + 100), 'claude', q, 3, now, 'other-account').rate,
  ).toBeNull();
});

it('explains exactly which readings or sample span a forecast still needs', () => {
  expect(forecast([], 'claude', q, 3, now).message).toBe('Need 3 more readings');
  expect(forecast(series([30, 40]), 'claude', q, 3, now).message).toBe('Need 1 more reading');
  expect(forecast(series([20, 30, 40], q.resetAt, 60000), 'claude', q, 3, now).message).toBe(
    'Need 13 more minutes of readings',
  );
  expect(forecast(series([80, 90, 20]), 'claude', q, 3, now).samples).toBe(1);
  expect(forecast(series([80, 90, 20]), 'claude', q, 3, now).message).toBe('Need 2 more readings');
  expect(forecast(series([20, 30, 40]), 'claude', q, 3, now + 1800000).message).toContain(
    'too old',
  );
  expect(forecast([], 'claude', { ...q, resetAt: now - 1 }, 3, now).message).toBe(
    'Awaiting reset update',
  );
});
it('shows reset-aware forecasts only when a known reset precedes exhaustion', () => {
  expect(forecastText(forecast(series([20, 30, 40]), 'claude', q, 3, now))).toContain(
    'Likely to reset before empty',
  );
  expect(forecastText(forecast(series([0, 20, 40]), 'claude', q, 3, now))).toContain(
    'Estimated time left',
  );
  const unknown = { ...q, resetAt: null };
  expect(forecast(series([20, 30, 40], null), 'claude', unknown, 3, now).resetsBeforeEmpty).toBe(
    false,
  );
});
it('compares observed weekly pace with the remaining budget until reset', () => {
  const weekly = { ...q, id: 'seven_day' };
  const f = forecast(series([20, 30, 40]), 'claude', q, 3, now);
  expect(weeklyPace(weekly, f, now)).toEqual({ label: 'On track', budgetRate: 60 });
  expect(weeklyPace({ ...weekly, resetAt: now + 10 * 3600000 }, f, now)).toEqual({
    label: 'Over budget',
    budgetRate: 6,
  });
  expect(weeklyPace(q, f, now)).toBeNull();
  expect(weeklyPace(weekly, null, now)).toBeNull();
  expect(weeklyPace({ ...weekly, resetAt: now - 1 }, f, now)).toBeNull();
  expect(weeklyPace({ ...weekly, resetAt: null }, f, now)).toBeNull();
  expect(
    weeklyPace({ ...weekly, id: 'primary_window', durationMs: 604800000 }, f, now)?.label,
  ).toBe('On track');
});

it('formats a weekly exhaustion estimate as a local date with an exact timestamp', () => {
  const later = { ...q, resetAt: now + 10 * 3600000 };
  const f = forecast(series([20, 30, 40], later.resetAt), 'claude', later, 3, now);
  const display = forecastDate(f, now, 'en-US', 'America/New_York');
  expect(display?.label).toBe('Est. Oct 19');
  expect(display?.iso).toBe('2026-10-19T20:30:00.000Z');
  expect(display?.title).toContain('4:30 PM');
  expect(display?.title).toContain('Estimated empty');
  expect(forecastDate(null, now)).toBeNull();
  expect(forecastDate({ ...f, rate: 0 }, now)).toBeNull();
  expect(forecastDate({ ...f, resetsBeforeEmpty: true }, now)).toBeNull();
  expect(forecastDate({ ...f, exhaustionMs: Infinity }, now)).toBeNull();
});
it('includes the local year when a forecast crosses into the next year', () => {
  const later = { ...q, resetAt: now + 10 * 3600000 };
  const f = forecast(series([20, 30, 40], later.resetAt), 'claude', later, 3, now);
  const boundary = Date.parse('2026-12-31T23:30:00Z');
  expect(forecastDate(f, boundary, 'en-US', 'UTC')?.label).toBe('Est. Jan 1, 2027');
});
