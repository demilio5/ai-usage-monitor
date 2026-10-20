export type ProviderId = 'claude' | 'chatgpt' | 'codex';
export const PROVIDERS: ProviderId[] = ['claude', 'chatgpt', 'codex'];
export const NAMES: Record<ProviderId, string> = {
  claude: 'Claude + Claude Code',
  chatgpt: 'ChatGPT',
  codex: 'Codex',
};
export type Status =
  | 'ok'
  | 'auth'
  | 'blocked'
  | 'unavailable'
  | 'offline'
  | 'network'
  | 'rate-limit'
  | 'disabled'
  | 'permission';
export interface Quota {
  id: string;
  label: string;
  used: number;
  remaining: number;
  resetAt: number | null;
  durationMs: number | null;
  source: string;
}
export interface ProviderData {
  provider: ProviderId;
  status: Status;
  detail: string;
  quotas: Quota[];
  lastSuccess: number | null;
  lastAttempt: number | null;
  nextAttempt: number;
  failures: number;
  account?: string;
  rateLimitedUntil?: number;
}
export type ProviderState = Record<ProviderId, ProviderData>;
export interface Observation extends Quota {
  provider: ProviderId;
  timestamp: number;
  status: Status;
  account?: string;
}
export interface Settings {
  enabled: Record<ProviderId, boolean>;
  badge: 'auto' | ProviderId;
  display: 'remaining' | 'used';
  interval: number;
  theme: 'auto' | 'light' | 'dark';
  forecastHours: number;
  retentionDays: number;
  alerts: boolean;
  thresholds: number[];
  resetAlerts: boolean;
  dualIcon: boolean;
  idleAware: boolean;
  claudeOrg: string;
}
export interface Store {
  version: 1;
  settings: Settings;
  providers: ProviderState;
  history: Observation[];
  alerts: Record<string, number>;
}
export interface ProviderResult {
  quotas: Quota[];
  account?: string;
  detail: string;
}
