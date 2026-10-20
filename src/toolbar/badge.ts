import {
  NAMES,
  PROVIDERS,
  type ProviderData,
  type Settings,
  type ProviderState,
  type Quota,
} from '../providers/types';
import { color, current } from '../calculations/quota';
import { stale } from '../background/scheduler';
import { countdown } from '../utils/time';
export function selectQuota(
  providers: ProviderState,
  settings: Settings,
  now = Date.now(),
): { p: ProviderData; q: Quota } | null {
  const candidates = PROVIDERS.filter(
    (id) => settings.enabled[id] && (settings.badge === 'auto' || settings.badge === id),
  ).flatMap((id) => {
    const p = providers[id];
    return stale({ ...p, quotas: [] }, settings, now)
      ? []
      : p.quotas
          .filter((q) => current(q, now) && (id !== 'claude' || q.id === 'seven_day'))
          .map((q) => ({ p, q }));
  });
  return candidates.sort((a, b) => a.q.remaining - b.q.remaining)[0] || null;
}
export function badge(providers: ProviderState, settings: Settings, now = Date.now()) {
  const selected = selectQuota(providers, settings, now);
  return {
    text: selected ? `${Math.round(selected.q[settings.display])}%` : '—',
    color: color(selected?.q.remaining ?? null),
    selected,
  };
}
export function tooltip(providers: ProviderState, settings: Settings, now = Date.now()): string {
  return [
    settings.dualIcon
      ? `AI Usage Monitor · ${settings.display} % · Claude = top row (weekly), Codex = bottom row`
      : 'AI Usage Monitor',
    ...PROVIDERS.map((id) => {
      const p = providers[id];
      if (!settings.enabled[id]) return `${NAMES[id]}: disabled`;
      return `${NAMES[id]}${stale(p, settings, now) ? ' [stale / unavailable]' : ''}: ${p.quotas.length ? p.quotas.map((q) => `${q.label} ${Math.round(q.remaining)}% left · reset ${countdown(q.resetAt, now)}`).join('; ') : p.detail}`;
    }),
  ].join('\n');
}
