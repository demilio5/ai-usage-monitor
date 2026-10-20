import {
  PROVIDERS,
  type Settings,
  type Store,
  type ProviderData,
  type ProviderState,
  type Quota,
  type Observation,
} from '../providers/types';
import { percentage } from '../calculations/quota';
export const defaults: Settings = {
  enabled: { claude: true, chatgpt: true, codex: true },
  badge: 'auto',
  display: 'remaining',
  interval: 5,
  theme: 'auto',
  forecastHours: 3,
  retentionDays: 30,
  alerts: false,
  thresholds: [50, 25, 10, 5],
  resetAlerts: false,
  dualIcon: false,
  idleAware: false,
  claudeOrg: '',
};
export function validateSettings(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {};
  const s = { ...defaults, enabled: { ...defaults.enabled }, thresholds: [...defaults.thresholds] };
  for (const p of PROVIDERS) if (typeof r.enabled?.[p] === 'boolean') s.enabled[p] = r.enabled[p];
  if (['auto', ...PROVIDERS].includes(r.badge!)) s.badge = r.badge!;
  if (r.display === 'used' || r.display === 'remaining') s.display = r.display;
  if ([1, 5, 10, 15, 30, 45, 60, 720, 1440].includes(r.interval!)) s.interval = r.interval!;
  if (['auto', 'light', 'dark'].includes(r.theme!)) s.theme = r.theme!;
  if ([1, 3, 6, 12, 24].includes(r.forecastHours!)) s.forecastHours = r.forecastHours!;
  if ([1, 7, 30].includes(r.retentionDays!)) s.retentionDays = r.retentionDays!;
  for (const key of ['alerts', 'resetAlerts', 'dualIcon', 'idleAware'] as const)
    if (typeof r[key] === 'boolean') s[key] = r[key]!;
  if (Array.isArray(r.thresholds))
    s.thresholds = [...new Set(r.thresholds.filter((n) => [50, 25, 10, 5].includes(n)))].sort(
      (a, b) => b - a,
    );
  if (typeof r.claudeOrg === 'string' && /^[a-zA-Z0-9_-]{0,100}$/.test(r.claudeOrg))
    s.claudeOrg = r.claudeOrg;
  return s;
}
export function emptyProvider(
  provider: ProviderData['provider'],
  rateLimitedUntil?: number,
): ProviderData {
  const cooldown =
    timestamp(rateLimitedUntil) && rateLimitedUntil > Date.now() ? rateLimitedUntil : 0;
  return {
    provider,
    status: 'unavailable',
    detail: 'Not checked yet.',
    quotas: [],
    lastSuccess: null,
    lastAttempt: null,
    nextAttempt: cooldown,
    failures: 0,
    ...(cooldown ? { rateLimitedUntil: cooldown } : {}),
  };
}
export function emptyStore(): Store {
  return {
    version: 1,
    settings: validateSettings({}),
    providers: Object.fromEntries(PROVIDERS.map((p) => [p, emptyProvider(p)])) as ProviderState,
    history: [],
    alerts: {},
  };
}
const statuses = [
  'ok',
  'auth',
  'blocked',
  'unavailable',
  'offline',
  'network',
  'rate-limit',
  'disabled',
  'permission',
];
const timestamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8640000000000000;
function validQuota(value: unknown): value is Quota {
  const q = value as Partial<Quota> | null;
  return (
    !!q &&
    typeof q.id === 'string' &&
    typeof q.label === 'string' &&
    typeof q.source === 'string' &&
    percentage(q.used) !== null &&
    percentage(q.remaining) !== null &&
    (q.resetAt === null || timestamp(q.resetAt)) &&
    (q.durationMs === null ||
      (typeof q.durationMs === 'number' && Number.isFinite(q.durationMs) && q.durationMs > 0))
  );
}
function validProvider(value: unknown, id: ProviderData['provider']): value is ProviderData {
  const p = value as Partial<ProviderData> | null;
  return (
    !!p &&
    p.provider === id &&
    statuses.includes(p.status!) &&
    typeof p.detail === 'string' &&
    Array.isArray(p.quotas) &&
    p.quotas.every(validQuota) &&
    (p.lastSuccess === null || timestamp(p.lastSuccess)) &&
    (p.lastAttempt === null || timestamp(p.lastAttempt)) &&
    timestamp(p.nextAttempt) &&
    typeof p.failures === 'number' &&
    Number.isInteger(p.failures) &&
    p.failures >= 0 &&
    (p.account === undefined || typeof p.account === 'string') &&
    (p.rateLimitedUntil === undefined || timestamp(p.rateLimitedUntil))
  );
}
function validObservation(value: unknown): value is Observation {
  const p = value as Partial<Observation> | null;
  return (
    validQuota(value) &&
    !!p &&
    PROVIDERS.includes(p.provider!) &&
    statuses.includes(p.status!) &&
    timestamp(p.timestamp) &&
    (p.account === undefined || typeof p.account === 'string')
  );
}
export async function readStore(): Promise<Store> {
  const raw = (await browser.storage.local.get('monitor')).monitor as Partial<Store> | undefined;
  if (!raw || raw.version !== 1) return emptyStore();
  return {
    version: 1,
    settings: validateSettings(raw.settings),
    providers: Object.fromEntries(
      PROVIDERS.map((id) => {
        const provider = raw.providers?.[id];
        const cooldown = provider?.rateLimitedUntil;
        return [id, validProvider(provider, id) ? provider : emptyProvider(id, cooldown)];
      }),
    ) as ProviderState,
    history: Array.isArray(raw.history) ? raw.history.filter(validObservation) : [],
    alerts: Object.fromEntries(
      Object.entries(raw.alerts && typeof raw.alerts === 'object' ? raw.alerts : {}).filter(
        ([, value]) => timestamp(value),
      ),
    ),
  };
}
export async function writeStore(s: Store): Promise<void> {
  await browser.storage.local.set({ monitor: s });
}
