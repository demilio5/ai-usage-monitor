import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Store } from '../src/providers/types';
const now = Date.parse('2026-10-19T19:00:00Z');
let saved: Store | undefined;
let listener: (m: unknown, s: unknown) => Promise<Store>;
let alarm: (a: { name: string }) => void;
let fetcher: ReturnType<typeof vi.fn>;
let notifications: ReturnType<typeof vi.fn>;
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  saved = undefined;
  fetcher = vi.fn(async (url: string) =>
    url.endsWith('/organizations')
      ? response([{ uuid: 'fixture-org' }])
      : url.includes('claude.ai')
        ? response({
            seven_day: { utilization: 28, resets_at: new Date(now + 7200000).toISOString() },
          })
        : response({}, 401),
  );
  notifications = vi.fn(async () => 'fixture-notification');
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async () => ({ monitor: saved ? structuredClone(saved) : undefined })),
        set: vi.fn(async ({ monitor }: { monitor: Store }) => {
          saved = structuredClone(monitor);
        }),
      },
    },
    alarms: {
      create: vi.fn(async () => {}),
      onAlarm: {
        addListener: vi.fn((fn) => {
          alarm = fn;
        }),
      },
    },
    runtime: {
      id: 'test-id',
      getURL: (path: string) => `moz-extension://fixture/${path}`,
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((fn) => {
          listener = fn;
        }),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
      onAdded: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
    notifications: { create: notifications },
    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setBadgeTextColor: vi.fn(async () => {}),
      setTitle: vi.fn(async () => {}),
      setIcon: vi.fn(async () => {}),
    },
  });
  await import('../src/background/index');
  await listener({ type: 'popup' }, { id: 'test-id' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const send = (type: string, extra: Record<string, unknown> = {}) =>
  listener({ type, ...extra }, { id: 'test-id' });
it('initializes alarms, persists real parsed quotas, and isolates unavailable providers', async () => {
  const s = await send('read');
  expect(s.providers.claude.quotas[0].remaining).toBe(72);
  expect(s.providers.codex.status).toBe('auth');
  expect(s.providers.chatgpt.status).toBe('unavailable');
  expect(s.history).toHaveLength(1);
  expect(browser.alarms.create).toHaveBeenCalledWith('usage-tick', { periodInMinutes: 1 });
  expect(browser.action.setBadgeText).toHaveBeenCalledWith({ text: '72%' });
});
it('throttles popup and manual refresh immediately after collection', async () => {
  const calls = fetcher.mock.calls.length;
  await Promise.all([send('popup'), send('refresh'), send('refresh')]);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
it('preserves last-good readings on network failure and grays the badge', async () => {
  vi.setSystemTime(now + 60000);
  fetcher.mockRejectedValue(new Error('sensitive data'));
  const s = await send('refresh');
  expect(s.providers.claude.status).toBe('network');
  expect(s.providers.claude.quotas[0].remaining).toBe(72);
  expect(s.history).toHaveLength(1);
  expect(s.providers.claude.detail).not.toContain('sensitive');
  expect(browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '—' });
});
it('does not fetch while offline', async () => {
  vi.setSystemTime(now + 60000);
  vi.stubGlobal('navigator', { onLine: false });
  const calls = fetcher.mock.calls.length;
  const s = await send('refresh');
  expect(s.providers.claude.status).toBe('offline');
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
it('does not bypass server Retry-After with manual requests', async () => {
  vi.setSystemTime(now + 60000);
  fetcher.mockResolvedValue(response({}, 429, { 'retry-after': '7200' }));
  const s = await send('refresh');
  expect(s.providers.claude.status).toBe('rate-limit');
  const count = fetcher.mock.calls.length;
  vi.setSystemTime(now + 120000);
  await send('refresh');
  expect(fetcher).toHaveBeenCalledTimes(count);
});
it('serializes concurrent settings and history clearing', async () => {
  const s = await send('read');
  const settings = {
    ...s.settings,
    enabled: { claude: false, codex: false, chatgpt: false },
    theme: 'dark',
    interval: 10,
  };
  await Promise.all([send('settings', { settings }), send('clear')]);
  const result = await send('read');
  expect(result.settings.theme).toBe('dark');
  expect(result.history).toEqual([]);
  expect(result.providers.claude.status).toBe('disabled');
});
it('clears previous organization history when selection changes', async () => {
  const s = await send('read');
  const result = await send('settings', { settings: { ...s.settings, claudeOrg: 'different' } });
  expect(result.history.filter((p) => p.provider === 'claude')).toEqual([]);
  expect(result.providers.claude.lastSuccess).toBeNull();
});
it('removes old account history when a new account is observed', async () => {
  vi.setSystemTime(now + 60000);
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/organizations')
      ? response([{ uuid: 'new-account' }])
      : url.includes('claude.ai')
        ? response({
            seven_day: { utilization: 12, resets_at: new Date(now + 7200000).toISOString() },
          })
        : response({}, 401),
  );
  const s = await send('refresh');
  expect(s.history).toHaveLength(1);
  expect(s.history[0].account).toBe('new-account');
});
it('never notifies while alerts are off and preserves alert deduplication on clear', async () => {
  const s = await send('read');
  expect(notifications).not.toHaveBeenCalled();
  s.alerts['test-key'] = now;
  saved = s;
  await send('clear');
  expect((await send('read')).alerts).toEqual({ 'test-key': now });
});
it('alarm wakes the persisted scheduler without forcing early polls', async () => {
  const calls = fetcher.mock.calls.length;
  alarm({ name: 'usage-tick' });
  await send('popup');
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
it('preserves server cooldown across interval changes and provider disable/enable', async () => {
  vi.setSystemTime(now + 60000);
  fetcher.mockResolvedValue(response({}, 429, { 'retry-after': '7200' }));
  let s = await send('refresh');
  const calls = fetcher.mock.calls.length;
  s = await send('settings', {
    settings: {
      ...s.settings,
      interval: 1,
      enabled: { claude: false, codex: false, chatgpt: false },
    },
  });
  await send('settings', {
    settings: { ...s.settings, enabled: { claude: true, codex: true, chatgpt: false } },
  });
  vi.setSystemTime(now + 120000);
  const final = await send('refresh');
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(final.providers.claude.status).toBe('rate-limit');
});
it('persists Codex quota metadata but never session credentials or account profile', async () => {
  vi.setSystemTime(now + 60000);
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/session')
      ? response({
          accessToken: 'credential-fixture-only',
          user: { email: 'private-fixture@example.test' },
          account: { id: 'test-account' },
        })
      : url.includes('/wham/usage')
        ? response({
            rate_limit: { primary_window: { used_percent: 38, reset_at: (now + 3600000) / 1000 } },
          })
        : url.endsWith('/organizations')
          ? response([{ uuid: 'fixture-org' }])
          : response({
              seven_day: { utilization: 28, resets_at: new Date(now + 7200000).toISOString() },
            }),
  );
  const s = await send('refresh');
  expect(s.providers.codex.status).toBe('ok');
  expect(s.providers.codex.quotas[0].remaining).toBe(62);
  expect(JSON.stringify(saved)).not.toMatch(/credential-fixture-only|private-fixture/);
  expect(s.providers.codex.account).toBe('test-account');
});
it('keeps Retry-After when switching Claude organizations and resumes after it expires', async () => {
  vi.setSystemTime(now + 60000);
  fetcher.mockResolvedValue(response({}, 429, { 'retry-after': '7200' }));
  let s = await send('refresh');
  const cooldown = s.providers.claude.rateLimitedUntil!;
  const calls = fetcher.mock.calls.length;
  s = await send('settings', { settings: { ...s.settings, claudeOrg: 'new-org' } });
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(s.providers.claude.rateLimitedUntil).toBe(cooldown);
  expect(s.providers.claude.quotas).toEqual([]);
  expect(s.history.filter((p) => p.provider === 'claude')).toEqual([]);
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/organizations')
      ? response([{ uuid: 'new-org' }])
      : response({ seven_day: { utilization: 10 } }),
  );
  vi.setSystemTime(cooldown);
  s = await send('popup');
  expect(s.providers.claude.account).toBe('new-org');
  expect(s.providers.claude.status).toBe('ok');
});
it('slows automatic network collection while idle and resumes on activity', async () => {
  let currentIdle = 'idle';
  let onState: ((state: string) => void) | undefined;
  (browser as any).idle = {
    queryState: vi.fn(async () => currentIdle),
    setDetectionInterval: vi.fn(),
    onStateChanged: {
      addListener: vi.fn((fn) => {
        onState = fn;
      }),
    },
  };
  let s = await send('read');
  s = await send('settings', { settings: { ...s.settings, idleAware: true } });
  const count = fetcher.mock.calls.length;
  vi.setSystemTime(now + 6 * 60000);
  await send('popup');
  expect(fetcher).toHaveBeenCalledTimes(count);
  currentIdle = 'active';
  onState!('active');
  s = await send('popup');
  expect(fetcher.mock.calls.length).toBeGreaterThan(count);
  expect(s.providers.claude.lastSuccess).toBe(now + 6 * 60000);
});

it('returns cached readings while a refresh is waiting for the network', async () => {
  vi.setSystemTime(now + 60000);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
  fetcher.mockImplementation(async (url: string) => {
    started();
    await pending;
    return url.endsWith('/organizations')
      ? response([{ uuid: 'fixture-org' }])
      : url.includes('claude.ai')
        ? response({ seven_day: { utilization: 40 } })
        : response({}, 401);
  });
  const refresh = send('refresh');
  await fetching;
  try {
    const cached = await send('read');
    expect(cached.providers.claude.quotas[0].remaining).toBe(72);
  } finally {
    release();
  }
  expect((await refresh).providers.claude.quotas[0].remaining).toBe(60);
});
it('skips unchanged storage writes while still updating the toolbar clock', async () => {
  const writes = vi.mocked(browser.storage.local.set).mock.calls.length;
  const titles = vi.mocked(browser.action.setTitle).mock.calls.length;
  await send('popup');
  await send('popup');
  expect(browser.storage.local.set).toHaveBeenCalledTimes(writes);
  expect(browser.action.setTitle).toHaveBeenCalledTimes(titles + 2);
});
it('persists retention cleanup even when no provider is due', async () => {
  const s = await send('read');
  const recent = s.history[0];
  s.history.unshift({ ...recent, timestamp: now - 31 * 86400000 });
  s.alerts.expired = now - 36 * 86400000;
  saved = s;
  const writes = vi.mocked(browser.storage.local.set).mock.calls.length;
  const result = await send('popup');
  expect(result.history).toEqual([recent]);
  expect(result.alerts).toEqual({});
  expect(browser.storage.local.set).toHaveBeenCalledTimes(writes + 1);
});

it('keeps a full retained history unchanged without rewriting it on idle ticks', async () => {
  const s = await send('read');
  const point = s.history[0];
  s.history = Array.from({ length: 18000 }, (_, i) => ({
    ...point,
    id: `window-${Math.floor(i / 1400)}`,
    timestamp: now - (i % 1400) * 60000,
  })).sort((a, b) => a.timestamp - b.timestamp);
  saved = s;
  const writes = vi.mocked(browser.storage.local.set).mock.calls.length;
  const result = await send('popup');
  expect(result.history).toEqual(s.history);
  expect(result.history).toHaveLength(18000);
  expect(browser.storage.local.set).toHaveBeenCalledTimes(writes);
});
it('recovers ambiguous discovery using the last successful Claude organization', async () => {
  const s = await send('read');
  saved = {
    ...s,
    providers: {
      ...s.providers,
      claude: {
        ...s.providers.claude,
        status: 'unavailable',
        detail: 'Multiple Claude organizations.',
        failures: 3,
        nextAttempt: now + 7200000,
      },
    },
  };
  vi.setSystemTime(now + 60000);
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/organizations')
      ? response([{ uuid: 'other-org' }, { uuid: 'fixture-org' }])
      : url.includes('claude.ai')
        ? response({ seven_day: { utilization: 63 } })
        : response({}, 401),
  );
  const result = await send('refresh');
  expect(result.providers.claude.status).toBe('ok');
  expect(result.providers.claude.account).toBe('fixture-org');
  expect(result.providers.claude.quotas[0].remaining).toBe(37);
  expect(result.settings.claudeOrg).toBe('');
  expect(result.history.filter((p) => p.provider === 'claude')).toHaveLength(2);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/other-org/usage'))).toBe(false);
});
