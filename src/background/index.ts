import { PROVIDERS, type Store, type ProviderId, type ProviderData } from '../providers/types';
import { readStore, writeStore, validateSettings, emptyProvider } from '../storage/settings';
import { appendHistory, pruneHistory } from '../storage/history';
import { fetchClaude } from '../providers/claude';
import { fetchCodex } from '../providers/codex';
import { fetchChatGPT } from '../providers/chatgpt';
import { ProviderError } from '../providers/http';
import { nextRetry, idleEligibleAt } from './scheduler';
import { badge, tooltip } from '../toolbar/badge';
import { dualIcon } from '../toolbar/icon';
import { evaluateAlerts } from '../notifications/alerts';
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}
async function toolbar(s: Store) {
  const b = badge(s.providers, s.settings);
  await Promise.all([
    browser.action.setBadgeText({ text: s.settings.dualIcon ? '' : b.text }),
    browser.action.setBadgeBackgroundColor({ color: b.color }),
    browser.action.setBadgeTextColor({ color: '#ffffff' }),
    browser.action.setTitle({ title: tooltip(s.providers, s.settings) }),
    s.settings.dualIcon
      ? browser.action.setIcon({
          imageData: {
            16: dualIcon(s.providers, s.settings, 16),
            32: dualIcon(s.providers, s.settings, 32),
          },
        })
      : browser.action.setIcon({ path: 'icons/monitor.svg' }),
  ]);
}
async function collect(
  id: ProviderId,
  s: Store,
  manual: boolean,
  isIdle = false,
): Promise<ProviderData> {
  const old = s.providers[id],
    now = Date.now();
  if (!s.settings.enabled[id])
    return { ...old, status: 'disabled', detail: 'Disabled in Settings.' };
  if ((old.rateLimitedUntil ?? 0) > now)
    return {
      ...old,
      status: 'rate-limit',
      detail: 'Service rate limit. Waiting before retrying.',
      nextAttempt: Math.max(old.nextAttempt, old.rateLimitedUntil!),
    };
  if (!manual && now < idleEligibleAt(old.lastAttempt, s.settings.interval, isIdle)) return old;
  const earliestManual =
    old.status === 'rate-limit' ? old.nextAttempt : (old.lastAttempt ?? 0) + 60000;
  if (now < (manual ? earliestManual : old.nextAttempt)) return old;
  try {
    if (!navigator.onLine) throw new ProviderError('offline', 'Firefox is offline.');
    const origin = id === 'claude' ? 'https://claude.ai/*' : 'https://chatgpt.com/*';
    if (id !== 'chatgpt' && !(await browser.permissions.contains({ origins: [origin] })))
      throw new ProviderError(
        'permission',
        'Website access has not been granted. Allow access from Firefox’s extension permissions.',
      );
    const result = await (id === 'claude'
      ? fetchClaude(s.settings.claudeOrg)
      : id === 'codex'
        ? fetchCodex()
        : fetchChatGPT());
    return {
      provider: id,
      status: 'ok',
      ...result,
      lastSuccess: Date.now(),
      lastAttempt: now,
      nextAttempt: Date.now() + s.settings.interval * 60000,
      failures: 0,
    };
  } catch (e) {
    const err =
      e instanceof ProviderError
        ? e
        : new ProviderError('network', 'Collection failed. Try again later.');
    return {
      ...old,
      status: err.status,
      detail: err.message,
      lastAttempt: now,
      failures: old.failures + 1,
      rateLimitedUntil: err.status === 'rate-limit' ? err.retryAt : old.rateLimitedUntil,
      nextAttempt: nextRetry(
        err.status,
        old.failures + 1,
        Date.now(),
        s.settings.interval,
        err.retryAt,
      ),
    };
  }
}
async function refresh(manual = false) {
  const s = await readStore();
  let isIdle = false;
  if (s.settings.idleAware && (await browser.permissions.contains({ permissions: ['idle'] }))) {
    try {
      configureIdle();
      isIdle = (await browser.idle.queryState(600)) !== 'active';
    } catch {
      /* Normal scheduling remains available if idle detection fails. */
    }
  }
  const results = await Promise.all(PROVIDERS.map((id) => collect(id, s, manual, isIdle)));
  let changed = results.some(
    (next) => JSON.stringify(next) !== JSON.stringify(s.providers[next.provider]),
  );
  for (const next of results) {
    const old = s.providers[next.provider];
    if (next.lastAttempt !== old.lastAttempt && next.status === 'ok') {
      if (old.account && old.account !== next.account)
        s.history = s.history.filter((p) => p.provider !== next.provider);
      s.history = appendHistory(s.history, next, next.lastSuccess!, s.settings.retentionDays);
      if (
        s.settings.alerts &&
        (await browser.permissions.contains({ permissions: ['notifications'] }))
      ) {
        const alerts = evaluateAlerts(old, next, s.settings, s.alerts);
        for (const a of alerts) {
          try {
            await browser.notifications.create({
              type: 'basic',
              title: 'AI Usage Monitor',
              message: a.message,
              iconUrl: browser.runtime.getURL('icons/monitor.svg'),
            });
            s.alerts[a.key] = Date.now();
          } catch {
            /* Retry unshown alerts on the next successful observation. */
          }
        }
      }
    }
    s.providers[next.provider] = next;
  }
  const history = pruneHistory(s.history, Date.now(), s.settings.retentionDays);
  changed ||= history.length !== s.history.length || history.some((p, i) => p !== s.history[i]);
  s.history = history;
  const alerts = Object.fromEntries(
    Object.entries(s.alerts).filter(([, ts]) => ts > Date.now() - 35 * 86400000),
  );
  changed ||= Object.keys(alerts).length !== Object.keys(s.alerts).length;
  s.alerts = alerts;
  if (changed) await writeStore(s);
  await toolbar(s);
  return s;
}
let idleListenerRegistered = false;
function configureIdle() {
  if (!browser.idle) return;
  browser.idle.setDetectionInterval(600);
  if (!idleListenerRegistered) {
    browser.idle.onStateChanged.addListener((state) => {
      if (state === 'active') void serialize(() => refresh()).catch(console.error);
    });
    idleListenerRegistered = true;
  }
}
async function initialize() {
  await browser.alarms.create('usage-tick', { periodInMinutes: 1 });
  await refresh();
}
// Register granted optional idle events synchronously so Firefox can wake this event page.
if (browser.idle) configureIdle();
// Register event listeners synchronously so Firefox can wake this event page.
browser.alarms.onAlarm.addListener((a) => {
  if (a.name === 'usage-tick') void serialize(() => refresh()).catch(console.error);
});
browser.runtime.onStartup.addListener(() => {
  void serialize(initialize).catch(console.error);
});
browser.runtime.onInstalled.addListener((details) => {
  void serialize(async () => {
    if (
      details.reason === 'install' ||
      (details.reason === 'update' && ['1.0.0', '1.0.1'].includes(details.previousVersion || ''))
    ) {
      const s = await readStore();
      s.settings.dualIcon = true;
      await writeStore(s);
    }
    await initialize();
  }).catch(console.error);
});
browser.permissions.onAdded.addListener(() => {
  void serialize(() => refresh(true)).catch(console.error);
});
browser.permissions.onRemoved.addListener(() => {
  void serialize(() => refresh(true)).catch(console.error);
});
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== browser.runtime.id || !message || typeof message !== 'object') return undefined;
  const m = message as { type?: string; settings?: unknown };
  // Storage reads are atomic snapshots; they need not wait for network collection.
  if (m.type === 'read') return readStore();
  if (m.type === 'refresh' || m.type === 'popup')
    return serialize(() => refresh(m.type === 'refresh'));
  if (m.type === 'settings')
    return serialize(async () => {
      const s = await readStore(),
        previous = s.settings;
      s.settings = validateSettings(m.settings);
      for (const id of PROVIDERS) {
        if (!s.settings.enabled[id])
          s.providers[id] = {
            ...s.providers[id],
            status: 'disabled',
            detail: 'Disabled in Settings.',
          };
        else if (!previous.enabled[id] || s.settings.interval !== previous.interval)
          s.providers[id] = { ...s.providers[id], nextAttempt: 0 };
      }
      if (s.settings.claudeOrg !== previous.claudeOrg) {
        s.providers.claude = emptyProvider('claude', s.providers.claude.rateLimitedUntil);
        s.history = s.history.filter((p) => p.provider !== 'claude');
      }
      s.history = pruneHistory(s.history, Date.now(), s.settings.retentionDays);
      await writeStore(s);
      await toolbar(s);
      return refresh();
    });
  if (m.type === 'clear')
    return serialize(async () => {
      const s = await readStore();
      s.history = [];
      await writeStore(s);
      return s;
    });
  return undefined;
});
void serialize(initialize).catch(console.error);
