import { getJson, object, ProviderError } from './http';
import { quota } from '../calculations/quota';
import type { ProviderResult, Quota } from './types';
export function parseCodex(data: unknown): Quota[] {
  const root = object(data);
  const rate = object(root.rate_limit);
  const result: Quota[] = [];
  for (const [key, fallback] of [
    ['primary_window', 'Primary allowance'],
    ['secondary_window', 'Secondary allowance'],
  ]) {
    const w = object(rate[key]);
    const seconds =
      typeof w.limit_window_seconds === 'number' && w.limit_window_seconds > 0
        ? w.limit_window_seconds
        : null;
    const label =
      seconds === 18000 ? '5-hour allowance' : seconds === 604800 ? 'Weekly allowance' : fallback;
    const q = quota(
      key,
      label,
      w.used_percent,
      w.reset_at,
      seconds === null ? null : seconds * 1000,
      'Codex WHAM endpoint',
    );
    if (q) result.push(q);
  }
  return result;
}
// Only recognized account-selection fields are retained; session payloads never leave this call.
function accountId(session: Record<string, unknown>, token: string): string | undefined {
  let claims: Record<string, unknown> = {};
  try {
    const payload = token.split('.')[1];
    if (payload)
      claims = object(
        JSON.parse(
          atob(
            payload
              .replaceAll('-', '+')
              .replaceAll('_', '/')
              .padEnd(Math.ceil(payload.length / 4) * 4, '='),
          ),
        ),
      );
  } catch {
    /* Opaque tokens can still authenticate; account routing is optional. */
  }
  const account = object(session.account);
  const auth = object(claims['https://api.openai.com/auth']);
  const id = session.account_id ?? session.accountId ?? account.id ?? auth.chatgpt_account_id;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id) ? id : undefined;
}
export async function fetchCodex(fetcher: typeof fetch = fetch): Promise<ProviderResult> {
  // Reacquire on every refresh. Never cache credentials, return them, log them, or write them to storage.
  const session = object(await getJson('https://chatgpt.com/api/auth/session', fetcher));
  const token = session.accessToken;
  if (typeof token !== 'string' || !token || token.length > 32768 || /\s/.test(token))
    throw new ProviderError(
      'auth',
      'Sign in at chatgpt.com in a regular Firefox tab, then refresh. No active ChatGPT session token was returned.',
    );
  if (
    typeof session.expires === 'string' &&
    Number.isFinite(Date.parse(session.expires)) &&
    Date.parse(session.expires) <= Date.now()
  )
    throw new ProviderError(
      'auth',
      'Your ChatGPT session has expired. Sign in again, then refresh.',
    );
  const selectedAccount = accountId(session, token);
  const data = await getJson('https://chatgpt.com/backend-api/wham/usage', fetcher, Date.now(), {
    token,
    accountId: selectedAccount,
  });
  const quotas = parseCodex(data);
  if (!quotas.length)
    throw new ProviderError(
      'unavailable',
      'Codex returned no supported percentage windows. No limit is assumed for missing windows.',
    );
  const reportedId = object(data).account_id;
  const id =
    typeof reportedId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(reportedId)
      ? reportedId
      : selectedAccount;
  return {
    quotas,
    ...(id ? { account: id } : {}),
    detail: 'Codex subscription quota; session authentication is used in memory only.',
  };
}
