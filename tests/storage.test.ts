import { afterEach, expect, it, vi } from 'vitest';
import { emptyStore, readStore } from '../src/storage/settings';

function load(value: unknown) {
  vi.stubGlobal('browser', { storage: { local: { get: async () => ({ monitor: value }) } } });
  return readStore();
}
afterEach(() => vi.unstubAllGlobals());

it('recovers missing sections without discarding valid settings', async () => {
  const s = await load({ version: 1, settings: { theme: 'dark' } });
  expect(s.settings.theme).toBe('dark');
  expect(s.providers.claude).toEqual(emptyStore().providers.claude);
  expect(s.history).toEqual([]);
  expect(s.alerts).toEqual({});
});
it('preserves valid state without changing timestamps, quotas, or metadata', async () => {
  const s = emptyStore();
  s.providers.claude = {
    ...s.providers.claude,
    status: 'ok',
    lastSuccess: 1000,
    lastAttempt: 1000,
    nextAttempt: 301000,
    account: 'fixture-org',
    quotas: [
      {
        id: 'seven_day',
        label: 'Weekly',
        used: 40,
        remaining: 60,
        resetAt: 900000,
        durationMs: 604800000,
        source: 'fixture',
      },
    ],
  };
  s.history = [
    {
      ...s.providers.claude.quotas[0],
      provider: 'claude',
      timestamp: 1000,
      status: 'ok',
      account: 'fixture-org',
    },
  ];
  s.alerts.fixture = 1000;
  expect(await load(s)).toEqual(s);
});
it('recovers invalid providers independently and retains valid history entries', async () => {
  const s = emptyStore();
  const point = {
    id: 'seven_day',
    label: 'Weekly',
    used: 40,
    remaining: 60,
    resetAt: 900000,
    durationMs: null,
    source: 'fixture',
    provider: 'claude',
    timestamp: 1000,
    status: 'ok',
  };
  const raw = {
    ...s,
    providers: { ...s.providers, claude: { status: 'ok', quotas: null } },
    history: [point, { ...point, used: NaN }, null, { ...point, timestamp: 1e20 }],
    alerts: { good: 1000, bad: 'invalid', infinite: Infinity },
  };
  const result = await load(raw);
  expect(result.providers.claude).toEqual(s.providers.claude);
  expect(result.providers.codex).toEqual(s.providers.codex);
  expect(result.history).toEqual([point]);
  expect(result.alerts).toEqual({ good: 1000 });
});
it.each([
  null,
  'invalid',
  [],
  { version: 99 },
  { version: 1, history: {}, alerts: null, providers: [] },
])('loads malformed records safely: %j', async (raw) => {
  const result = await load(raw);
  expect(result.history).toEqual([]);
  expect(result.providers.claude.quotas).toEqual([]);
  expect(result.alerts).toEqual({});
});

it('retains a valid server cooldown while recovering damaged provider readings', async () => {
  const cooldown = Date.now() + 7200000;
  const s = emptyStore();
  const result = await load({
    ...s,
    providers: {
      ...s.providers,
      claude: { ...s.providers.claude, quotas: null, rateLimitedUntil: cooldown },
    },
  });
  expect(result.providers.claude.quotas).toEqual([]);
  expect(result.providers.claude.rateLimitedUntil).toBe(cooldown);
  expect(result.providers.claude.nextAttempt).toBe(cooldown);
});
