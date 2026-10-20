import type { Status } from './types';
export class ProviderError extends Error {
  constructor(
    public status: Status,
    message: string,
    public retryAt = 0,
  ) {
    super(message);
  }
}
export async function getJson(
  url: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  auth?: { token: string; accountId?: string },
): Promise<unknown> {
  if (
    !/^https:\/\/(claude\.ai\/api\/organizations(?:\/[^/?#]+\/usage)?|chatgpt\.com\/(?:backend-api\/wham\/usage|api\/auth\/session))$/.test(
      url,
    )
  )
    throw new ProviderError('unavailable', 'Request outside the quota endpoint allowlist.');
  if (auth && url !== 'https://chatgpt.com/backend-api/wham/usage')
    throw new ProviderError(
      'unavailable',
      'Session authorization is restricted to the Codex usage endpoint.',
    );
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth) {
    headers.Authorization = `Bearer ${auth.token}`;
    if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetcher(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    if (r.status === 429) {
      const v = r.headers.get('retry-after');
      const delay = v && /^\d+$/.test(v) ? now + Number(v) * 1000 : v ? Date.parse(v) : NaN;
      throw new ProviderError(
        'rate-limit',
        'Service rate limit. Waiting before retrying.',
        Number.isFinite(delay) ? Math.max(now + 60000, delay) : now + 15 * 60000,
      );
    }
    if (r.status === 401)
      throw new ProviderError('auth', 'Session not accepted. Sign in on the service website.');
    if (r.status === 403)
      throw new ProviderError(
        'blocked',
        'Service denied the request. Open its website to check your session; challenges are never bypassed.',
      );
    if (!r.ok) throw new ProviderError('network', `Service returned HTTP ${r.status}.`);
    if (!(r.headers.get('content-type') || '').includes('application/json'))
      throw new ProviderError('blocked', 'Service returned a sign-in page or browser challenge.');
    try {
      return await r.json();
    } catch {
      throw new ProviderError('unavailable', 'Invalid quota response.');
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(
      'network',
      controller.signal.aborted ? 'Request timed out after 15 seconds.' : 'Network request failed.',
    );
  } finally {
    clearTimeout(timer);
  }
}
export function object(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
