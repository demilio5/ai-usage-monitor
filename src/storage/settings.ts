import {
  PROVIDERS,
  type Settings,
  type Store,
  type ProviderData,
  type ProviderState,
} from '../providers/types';
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
export function emptyProvider(provider: ProviderData['provider']): ProviderData {
  return {
    provider,
    status: 'unavailable',
    detail: 'Not checked yet.',
    quotas: [],
    lastSuccess: null,
    lastAttempt: null,
    nextAttempt: 0,
    failures: 0,
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
export async function readStore(): Promise<Store> {
  const raw = (await browser.storage.local.get('monitor')).monitor as Store | undefined;
  if (!raw || raw.version !== 1) return emptyStore();
  return { ...raw, settings: validateSettings(raw.settings) };
}
export async function writeStore(s: Store): Promise<void> {
  await browser.storage.local.set({ monitor: s });
}
