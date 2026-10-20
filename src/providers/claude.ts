import { getJson, object, ProviderError } from './http';
import { quota } from '../calculations/quota';
import type { ProviderResult, Quota } from './types';
export function parseClaude(data: unknown): Quota[] {
  const root = object(data);
  const usage = object(root.usage ?? data);
  const result: Quota[] = [];
  for (const [key, value] of Object.entries(usage)) {
    if (!/^five_hour$|^seven_day(?:_[a-z0-9_]+)?$/.test(key)) continue;
    const v = object(value);
    const label =
      key === 'five_hour'
        ? '5-hour allowance'
        : key === 'seven_day'
          ? 'Weekly allowance'
          : `Weekly · ${key.slice(10).replaceAll('_', ' ')}`;
    const q = quota(
      key,
      label,
      v.utilization,
      v.resets_at,
      key === 'five_hour' ? 18000000 : 604800000,
      'Claude usage endpoint',
    );
    if (q) result.push(q);
  }
  return result;
}
export async function fetchClaude(
  orgPreference = '',
  fetcher: typeof fetch = fetch,
  previousOrg = '',
): Promise<ProviderResult> {
  const data = await getJson('https://claude.ai/api/organizations', fetcher);
  const root = object(data);
  const orgs = (
    Array.isArray(data) ? data : Array.isArray(root.organizations) ? root.organizations : []
  ).map(object);
  const ids = orgs
    .map((o) => o.uuid ?? o.id)
    .filter((v): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]+$/.test(v));
  // Keep the last successfully tracked organization if it is still a membership.
  // Explicit settings take priority; a new ambiguous account still requires a choice.
  const id =
    orgPreference || (ids.includes(previousOrg) ? previousOrg : ids.length === 1 ? ids[0] : '');
  if (!id || !ids.includes(id))
    throw new ProviderError(
      'unavailable',
      ids.length > 1
        ? 'Multiple Claude organizations. Enter the organization ID in Settings to choose the allowance to track.'
        : 'No matching Claude organization. Check sign-in and organization settings.',
    );
  const quotas = parseClaude(
    await getJson(`https://claude.ai/api/organizations/${encodeURIComponent(id)}/usage`, fetcher),
  );
  if (!quotas.length)
    throw new ProviderError(
      'unavailable',
      'No supported quotas reported. Free, flexible, or changed plans may not expose percentages.',
    );
  return {
    quotas,
    account: id,
    detail: 'Subscription allowances shared by Claude and Claude Code.',
  };
}
