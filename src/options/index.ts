import { chart } from '../ui/chart';
import { forecast, forecastText } from '../calculations/forecasting';
import { stale } from '../background/scheduler';
import { current } from '../calculations/quota';
import { countdown } from '../utils/time';
import { PROVIDERS, NAMES, type Store, type Settings } from '../providers/types';
import { el, button, theme, download } from '../ui/dom';
import { exportCSV } from '../storage/history';
import { age } from '../utils/time';
let state: Store;
const app = document.querySelector<HTMLElement>('#app')!;
function select<K extends keyof Settings>(
  title: string,
  key: K,
  values: readonly (readonly [string | number, string])[],
) {
  const row = el('label', 'setting');
  row.append(el('span', '', title));
  const s = el('select');
  for (const [v, l] of values) {
    const o = el('option', '', l);
    o.value = String(v);
    s.append(o);
  }
  s.value = String(state.settings[key]);
  s.name = key;
  row.append(s);
  return row;
}
function check(label: string, checked: boolean, name: string) {
  const row = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.name = name;
  row.append(input, el('span', '', label));
  return row;
}
function render() {
  theme(state.settings.theme);
  app.replaceChildren();
  app.append(
    el('div', 'eyebrow', 'AI USAGE MONITOR'),
    el('h1', '', 'Make it yours'),
    el('p', 'muted', 'Subscription quotas, stored only in this Firefox profile.'),
  );
  const readings = el('section', 'card');
  readings.id = 'readings';
  readings.append(el('h2', '', 'Current readings & forecasts'));
  for (const id of PROVIDERS) {
    if (!state.settings.enabled[id]) continue;
    const p = state.providers[id];
    readings.append(el('h3', '', NAMES[id]), el('p', 'muted', `${p.status} · ${p.detail}`));
    for (const q of p.quotas) {
      const row = el('div', 'reading-window');
      const f =
        stale(p, state.settings) || !current(q)
          ? null
          : forecast(
              state.history,
              id,
              q,
              state.settings.forecastHours,
              Date.now(),
              p.account,
              state.settings.interval,
              state.settings.idleAware,
            );
      row.append(
        el(
          'p',
          '',
          `${q.label}: ${q.remaining.toFixed(1)}% remaining · ${q.used.toFixed(1)}% consumed`,
        ),
        el('p', 'muted', `Reset ${countdown(q.resetAt)} · Source: ${q.source}`),
        el(
          'p',
          'muted',
          f && f.rate !== null && f.rate > 0
            ? `${forecastText(f)} · ${f.message}${f.usedAtReset === null ? '' : ` Estimated consumption at reset ${f.usedAtReset.toFixed(0)}%.`}`
            : forecastText(f),
        ),
      );
      readings.append(row);
    }
  }
  app.append(readings);
  const form = el('form');
  const connections = el('section', 'card');
  connections.append(el('h2', '', 'Connections'));
  for (const p of PROVIDERS)
    connections.append(check(NAMES[p], state.settings.enabled[p], `enabled-${p}`));
  connections.append(
    el(
      'p',
      'muted',
      'Claude Code shares Claude subscription limits. For Codex, sign in at chatgpt.com in a regular Firefox tab; its session token is used in memory only. General ChatGPT quotas remain unavailable.',
    ),
  );
  const org = el('label', 'setting');
  org.append(el('span', '', 'Claude organization ID (optional)'));
  const orgInput = el('input');
  orgInput.name = 'claudeOrg';
  orgInput.value = state.settings.claudeOrg;
  orgInput.maxLength = 100;
  orgInput.pattern = '[a-zA-Z0-9_-]*';
  org.append(orgInput);
  connections.append(
    org,
    el(
      'p',
      'muted',
      'Leave blank for accounts with one organization. With multiple organizations, find the ID in the URL of the usage request in Firefox Developer Tools → Network on claude.ai/settings/usage. Switching organizations clears Claude history.',
    ),
  );
  form.append(connections);
  const display = el('section', 'card');
  display.append(
    el('h2', '', 'Toolbar & appearance'),
    select('Badge metric', 'badge', [
      ['auto', 'Closest to exhaustion'],
      ['claude', 'Claude + Claude Code'],
      ['chatgpt', 'ChatGPT'],
      ['codex', 'Codex'],
    ]),
    select('Percentage display', 'display', [
      ['remaining', 'Remaining'],
      ['used', 'Used'],
    ]),
    select('Theme', 'theme', [
      ['auto', 'Follow Firefox / system'],
      ['light', 'Light'],
      ['dark', 'Dark'],
    ]),
    check(
      'Show both percentages: Claude weekly on top, Codex below',
      state.settings.dualIcon,
      'dualIcon',
    ),
    el(
      'p',
      'muted',
      'Two large numeric rows show both percentages: Claude’s shared weekly allowance is on top, Codex below. Background colors indicate remaining allowance. Codex shows its most constrained current quota; a dash means unavailable. The standard badge is hidden in this mode. Turn this off to use one larger badge.',
    ),
  );
  form.append(display);
  const collection = el('section', 'card');
  collection.append(
    el('h2', '', 'Collection & forecasts'),
    select('Refresh every', 'interval', [
      [1, '1 minute'],
      [5, '5 minutes'],
      [10, '10 minutes'],
      [15, '15 minutes'],
      [30, '30 minutes'],
      [45, '45 minutes'],
      [60, '1 hour'],
      [720, '12 hours'],
      [1440, '24 hours'],
    ]),
    select('Forecast lookback', 'forecastHours', [
      [1, '1 hour'],
      [3, '3 hours'],
      [6, '6 hours'],
      [12, '12 hours'],
      [24, '24 hours'],
    ]),
    select('History retention', 'retentionDays', [
      [1, '24 hours'],
      [7, '7 days'],
      [30, '30 days'],
    ]),
    el(
      'p',
      'muted',
      'A 15-minute sample span and three readings are required. Older history uses 15-minute samples; up to 18,000 observations are retained. Forecasts describe observed net consumption, not guaranteed future availability.',
    ),
  );
  const idleChoice = check(
    'Reduce refresh while idle (after 10 minutes)',
    state.settings.idleAware,
    'idleAware',
  );
  const idleInput = idleChoice.querySelector('input')!;
  idleInput.addEventListener('change', async () => {
    if (idleInput.checked) {
      try {
        idleInput.checked = await browser.permissions.request({ permissions: ['idle'] });
      } catch {
        idleInput.checked = false;
      }
    }
  });
  collection.append(
    idleChoice,
    el(
      'p',
      'muted',
      'Optional idle permission detects inactivity only, not what you type or which app you use. While idle or locked, network polling is no more frequent than every 60 minutes; longer configured intervals remain in effect. Activity resumes normal scheduling.',
    ),
  );
  form.append(collection);
  const alerts = el('section', 'card');
  const enabled = check('Enable Firefox notifications', state.settings.alerts, 'alerts');
  const alertInput = enabled.querySelector('input')!;
  alertInput.addEventListener('change', async () => {
    if (alertInput.checked) {
      try {
        alertInput.checked = await browser.permissions.request({ permissions: ['notifications'] });
      } catch {
        alertInput.checked = false;
      }
      if (!alertInput.checked)
        notice.textContent = 'Firefox notification permission was not granted.';
    }
  });
  alerts.append(
    el('h2', '', 'Optional alerts'),
    enabled,
    el(
      'p',
      'muted',
      'Notify once per threshold per reported quota cycle. Notifications are off by default.',
    ),
  );
  for (const n of [50, 25, 10, 5])
    alerts.append(
      check(`Below ${n}% remaining`, state.settings.thresholds.includes(n), `threshold-${n}`),
    );
  alerts.append(
    check(
      'Notify on a reported reset or substantial replenishment',
      state.settings.resetAlerts,
      'resetAlerts',
    ),
  );
  form.append(alerts);
  const notice = el('p', 'notice');
  notice.setAttribute('role', 'status');
  const save = el('button', 'primary', 'Save settings');
  save.type = 'submit';
  form.append(save, notice);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      const f = new FormData(form);
      const settings: Settings = {
        ...state.settings,
        enabled: Object.fromEntries(
          PROVIDERS.map((p) => [p, f.has(`enabled-${p}`)]),
        ) as Settings['enabled'],
        badge: String(f.get('badge')) as Settings['badge'],
        display: String(f.get('display')) as Settings['display'],
        theme: String(f.get('theme')) as Settings['theme'],
        interval: Number(f.get('interval')),
        forecastHours: Number(f.get('forecastHours')),
        retentionDays: Number(f.get('retentionDays')),
        dualIcon: f.has('dualIcon'),
        idleAware: f.has('idleAware'),
        alerts: f.has('alerts'),
        resetAlerts: f.has('resetAlerts'),
        thresholds: [50, 25, 10, 5].filter((n) => f.has(`threshold-${n}`)),
        claudeOrg: String(f.get('claudeOrg') || '').trim(),
      };
      if (
        settings.alerts &&
        !(await browser.permissions.contains({ permissions: ['notifications'] }))
      ) {
        notice.textContent = 'Enable notification permission first.';
        return;
      }
      state = await browser.runtime.sendMessage({ type: 'settings', settings });
      theme(state.settings.theme);
      notice.textContent = 'Settings saved.';
    } catch {
      notice.textContent = 'Could not save settings. Please retry.';
    } finally {
      save.disabled = false;
    }
  });
  app.append(form);
  const history = el('section', 'card');
  history.id = 'history';
  const graphs = el('div');
  const range = el('select');
  range.setAttribute('aria-label', 'History time range');
  for (const [days, label] of [
    [1, '24 hours'],
    [7, '7 days'],
    [30, '30 days'],
  ] as const) {
    const o = el('option', '', label);
    o.value = String(days);
    range.append(o);
  }
  function drawHistory() {
    graphs.replaceChildren();
    let any = false;
    for (const id of PROVIDERS)
      if (state.settings.enabled[id])
        for (const q of state.providers[id].quotas) {
          const points = state.history.filter(
            (p) => p.provider === id && p.id === q.id && p.account === state.providers[id].account,
          );
          if (!points.length) continue;
          any = true;
          graphs.append(
            el('h3', '', `${NAMES[id]} · ${q.label}`),
            chart(points, Number(range.value)),
          );
        }
    if (!any) graphs.append(el('p', 'muted', 'History starts with your first successful reading.'));
  }
  range.addEventListener('change', drawHistory);
  drawHistory();
  history.append(range, graphs);
  history.append(
    el('h2', '', 'Your local data'),
    el('p', 'muted', `${state.history.length.toLocaleString()} observations saved.`),
    button('Export history as CSV', async () => {
      const latest: Store = await browser.runtime.sendMessage({ type: 'read' });
      download(exportCSV(latest.history), 'ai-usage-history.csv');
    }),
    button(
      'Clear usage history',
      async () => {
        if (
          confirm(
            'Permanently clear usage history in this Firefox profile? Current readings and alert deduplication will remain.',
          )
        ) {
          state = await browser.runtime.sendMessage({ type: 'clear' });
          render();
        }
      },
      'danger',
    ),
  );
  app.append(history);
  const diagnostics = el('section', 'card');
  diagnostics.append(el('h2', '', 'Connection diagnostics'));
  for (const p of PROVIDERS) {
    const d = state.providers[p];
    diagnostics.append(
      el('h3', '', NAMES[p]),
      el('p', '', `${d.status} · ${d.detail}`),
      el(
        'p',
        'muted',
        `Last success: ${age(d.lastSuccess)} · Consecutive failures: ${d.failures} · Next eligible automatic attempt: ${d.nextAttempt ? new Date(d.nextAttempt).toLocaleString() : 'Now'}`,
      ),
    );
  }
  diagnostics.append(
    button('Retry connections', async () => {
      state = await browser.runtime.sendMessage({ type: 'refresh' });
      render();
    }),
    el(
      'p',
      'muted',
      'Manual retry is limited to once a minute. HTTP 429 Retry-After always applies. Missing host access can be granted in Firefox → Extensions → AI Usage Monitor → Permissions.',
    ),
  );
  app.append(diagnostics);
  if (location.hash)
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  app.append(
    el(
      'footer',
      'muted',
      `v${browser.runtime.getManifest().version} · Read-only requests to claude.ai and chatgpt.com. Session tokens stay in memory; no telemetry or account billing requests.`,
    ),
  );
}
void (async () => {
  state = await browser.runtime.sendMessage({ type: 'read' });
  render();
})().catch(() => {
  app.textContent = 'Could not load settings. Reload the extension.';
});
