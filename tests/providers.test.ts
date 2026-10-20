import { describe, it, expect, vi } from 'vitest';
import { fetchClaude, parseClaude } from '../src/providers/claude';
import { fetchCodex, parseCodex } from '../src/providers/codex';
import { fetchChatGPT } from '../src/providers/chatgpt';
import { getJson } from '../src/providers/http';
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const fixture = {
  five_hour: { utilization: 28, resets_at: '2026-10-19T23:00:00Z' },
  seven_day: { utilization: 55, resets_at: null },
  seven_day_sonnet: { utilization: 3 },
  extra_usage: { utilization: 80 },
};
describe('Claude adapter', () => {
  it('parses only supported quota windows and never billing credits', () => {
    const q = parseClaude(fixture);
    expect(q).toHaveLength(3);
    expect(q[0].remaining).toBe(72);
    expect(q[1].resetAt).toBeNull();
  });
  it('fails closed on schema drift or missing numbers', () => {
    expect(parseClaude({ five_hour: { utilization: '28' } })).toEqual([]);
    expect(parseClaude({})).toEqual([]);
  });
  it('discovers the organization with browser-managed authentication', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json([{ uuid: 'org-test' }]))
      .mockResolvedValueOnce(json(fixture));
    const result = await fetchClaude('', f);
    expect(result.account).toBe('org-test');
    expect(f.mock.calls[0][1].credentials).toBe('include');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(f.mock.calls[1][0]).toContain('org-test/usage');
  });
  it('requires explicit choice for ambiguous organizations', async () => {
    const f = vi.fn().mockResolvedValue(json([{ uuid: 'one' }, { uuid: 'two' }]));
    await expect(fetchClaude('', f)).rejects.toThrow('Multiple');
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('uses a configured organization only when still a member', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json([{ uuid: 'one' }, { uuid: 'two' }]))
      .mockResolvedValueOnce(json(fixture));
    expect((await fetchClaude('two', f)).account).toBe('two');
    await expect(
      fetchClaude('missing', vi.fn().mockResolvedValue(json([{ uuid: 'one' }]))),
    ).rejects.toThrow('matching');
  });
  it('recognizes expired authentication', async () =>
    await expect(fetchClaude('', vi.fn().mockResolvedValue(json({}, 401)))).rejects.toMatchObject({
      status: 'auth',
    }));
  it('keeps the previously tracked organization when additional memberships appear', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json([{ uuid: 'other' }, { uuid: 'tracked' }]))
      .mockResolvedValueOnce(json(fixture));
    expect((await fetchClaude('', f, 'tracked')).account).toBe('tracked');
    expect(f.mock.calls[1][0]).toBe('https://claude.ai/api/organizations/tracked/usage');
  });
  it('honors explicit choice over the previous organization', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json([{ uuid: 'chosen' }, { uuid: 'tracked' }]))
      .mockResolvedValueOnce(json(fixture));
    expect((await fetchClaude('chosen', f, 'tracked')).account).toBe('chosen');
  });
  it('does not reuse a previous organization that is no longer a membership', async () => {
    const f = vi.fn().mockResolvedValue(json([{ uuid: 'one' }, { uuid: 'two' }]));
    await expect(fetchClaude('', f, 'removed')).rejects.toThrow('Multiple');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
describe('Codex adapter', () => {
  it('reads primary/secondary windows without assuming plan duration', () => {
    const q = parseCodex({
      rate_limit: {
        primary_window: { used_percent: 62, reset_at: 1800000000, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 36, reset_at: null, limit_window_seconds: 604800 },
      },
    });
    expect(q.map((p) => p.remaining)).toEqual([38, 64]);
    expect(q[0].label).toBe('5-hour allowance');
    expect(q[0].resetAt).toBe(1800000000000);
    expect(parseCodex({ rate_limit: { primary_window: null } })).toEqual([]);
  });
  it('does not mislabel other plan windows as five hours', () =>
    expect(
      parseCodex({
        rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 3600 } },
      })[0].label,
    ).toBe('Primary allowance'));
  it('authenticates with a memory-only token scoped to the usage request', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          accessToken: 'fixture-secret',
          account: { id: 'account-test' },
          user: { email: 'not-retained@example.test' },
        }),
      )
      .mockResolvedValueOnce(
        json({ rate_limit: { primary_window: { used_percent: 62, limit_window_seconds: 18000 } } }),
      );
    const result = await fetchCodex(f);
    expect(f.mock.calls[0][0]).toBe('https://chatgpt.com/api/auth/session');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(f.mock.calls[1][1].headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer fixture-secret',
      'ChatGPT-Account-Id': 'account-test',
    });
    expect(f.mock.calls[1][1].redirect).toBe('error');
    expect(result.account).toBe('account-test');
    expect(JSON.stringify(result)).not.toMatch(/fixture-secret|not-retained/);
  });
  it('does not request usage for logged-out or expired sessions', async () => {
    const f = vi.fn().mockResolvedValue(json({}));
    await expect(fetchCodex(f)).rejects.toMatchObject({ status: 'auth' });
    expect(f).toHaveBeenCalledTimes(1);
    await expect(
      fetchCodex(
        vi
          .fn()
          .mockResolvedValue(
            json({ accessToken: 'fixture-secret', expires: '2000-01-01T00:00:00Z' }),
          ),
      ),
    ).rejects.toMatchObject({ status: 'auth' });
  });
  it('gracefully rejects missing quota data after session authentication', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: 'fixture-secret' }))
      .mockResolvedValueOnce(json({}));
    await expect(fetchCodex(f)).rejects.toMatchObject({ status: 'unavailable' });
  });
  it('reacquires session tokens on every collection and sanitizes errors', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: 'fixture-one' }))
      .mockRejectedValueOnce(new Error('fixture-one'))
      .mockResolvedValueOnce(json({ accessToken: 'fixture-two' }))
      .mockResolvedValueOnce(json({ rate_limit: { primary_window: { used_percent: 10 } } }));
    await expect(fetchCodex(f)).rejects.toThrow(/^Network request failed\.$/);
    expect((await fetchCodex(f)).quotas[0].remaining).toBe(90);
    expect(f.mock.calls[3][1].headers.Authorization).toBe('Bearer fixture-two');
  });
  it('routes account selection from recognized token claims without persisting the token', async () => {
    const token =
      'fixture.' +
      btoa(
        JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-claim' } }),
      ) +
      '.signature';
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: token }))
      .mockResolvedValueOnce(json({ rate_limit: { primary_window: { used_percent: 10 } } }));
    expect((await fetchCodex(f)).account).toBe('account-claim');
    expect(f.mock.calls[1][1].headers['ChatGPT-Account-Id']).toBe('account-claim');
  });
  it('leaves regular ChatGPT unavailable', async () =>
    await expect(fetchChatGPT()).rejects.toMatchObject({ status: 'unavailable' }));
});
describe('HTTP failures', () => {
  const endpoint = 'https://chatgpt.com/backend-api/wham/usage';
  it('honors numeric and date Retry-After', async () => {
    const now = 1800000000000;
    await expect(
      getJson(endpoint, vi.fn().mockResolvedValue(json({}, 429, { 'retry-after': '120' })), now),
    ).rejects.toMatchObject({ status: 'rate-limit', retryAt: now + 120000 });
    const date = new Date(now + 3600000).toUTCString();
    await expect(
      getJson(endpoint, vi.fn().mockResolvedValue(json({}, 429, { 'retry-after': date })), now),
    ).rejects.toMatchObject({ retryAt: now + 3600000 });
  });
  it('distinguishes denial from generic server errors', async () => {
    await expect(getJson(endpoint, vi.fn().mockResolvedValue(json({}, 403)))).rejects.toMatchObject(
      { status: 'blocked' },
    );
    await expect(getJson(endpoint, vi.fn().mockResolvedValue(json({}, 503)))).rejects.toMatchObject(
      { status: 'network' },
    );
  });
  it('sanitizes network errors so secrets never reach diagnostics', async () =>
    await expect(
      getJson(endpoint, vi.fn().mockRejectedValue(new Error('secret session data'))),
    ).rejects.toThrow(/^Network request failed\.$/));
  it('rejects HTML challenges and malformed JSON', async () => {
    await expect(
      getJson(endpoint, vi.fn().mockResolvedValue(new Response('<html>challenge</html>'))),
    ).rejects.toMatchObject({ status: 'blocked' });
    await expect(
      getJson(
        endpoint,
        vi
          .fn()
          .mockResolvedValue(
            new Response('{', { headers: { 'content-type': 'application/json' } }),
          ),
      ),
    ).rejects.toMatchObject({ status: 'unavailable' });
  });
  it('blocks unrelated service endpoints', async () => {
    const f = vi.fn();
    await expect(getJson('https://chatgpt.com/api/auth/session/extra', f)).rejects.toThrow(
      'allowlist',
    );
    expect(f).not.toHaveBeenCalled();
  });
  it('aborts requests after 15 seconds', async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('abort'))),
        ),
    ) as unknown as typeof fetch;
    const pending = expect(getJson(endpoint, f)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    vi.useRealTimers();
  });
});
it('never sends the session bearer token to discovery or other origins', async () => {
  const f = vi.fn();
  for (const url of [
    'https://claude.ai/api/organizations',
    'https://chatgpt.com/api/auth/session',
    'https://example.test/backend-api/wham/usage',
  ])
    await expect(getJson(url, f, Date.now(), { token: 'fixture-secret' })).rejects.toThrow();
  expect(f).not.toHaveBeenCalled();
});
