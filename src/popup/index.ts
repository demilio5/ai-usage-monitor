import { PROVIDERS, NAMES, type Store } from '../providers/types';
import { el, button, theme } from '../ui/dom';
import { color, current } from '../calculations/quota';
import { stale } from '../background/scheduler';
import { age, resetDisplay } from '../utils/time';
import { forecast, forecastText } from '../calculations/forecasting';
let state: Store;
let busy = false;
let connectionError = '';
const app = document.querySelector<HTMLElement>('#app')!;
async function details(anchor = '') {
  await browser.tabs.create({ url: browser.runtime.getURL('options.html' + anchor) });
}
function render() {
  theme(state.settings.theme);
  document.body.classList.toggle(
    'all-providers',
    PROVIDERS.every((id) => state.settings.enabled[id]),
  );
  app.replaceChildren();
  const header = el('header', 'spread popup-header');
  const brand = el('div', 'brand');
  brand.append(el('h1', '', 'AI Usage Monitor'));
  brand.append(el('span', 'local', '● Local only'));
  const settings = button('⚙', () => browser.runtime.openOptionsPage(), 'icon-button');
  settings.setAttribute('aria-label', 'Open settings');
  const actions = el('div', 'spread header-actions');
  const refreshButton = button(
    busy ? 'Refreshing…' : '↻ Refresh',
    () => refresh(true),
    'refresh-button',
  );
  refreshButton.disabled = busy;
  actions.append(refreshButton, settings);
  header.append(brand, actions);
  app.append(header);
  if (connectionError) app.append(el('p', 'warning', connectionError));
  let enabled = 0;
  for (const id of PROVIDERS) {
    if (!state.settings.enabled[id]) continue;
    enabled++;
    const p = state.providers[id];
    const isStale = stale(p, state.settings);
    const card = el('section', `card compact ${id}`);
    const top = el('div', 'spread');
    const title = el('div', 'provider-title');
    title.append(
      el('span', `provider-icon ${id}`, id === 'claude' ? '✳' : id === 'codex' ? '⌘' : '◎'),
      el('h2', '', NAMES[id]),
    );
    top.append(
      title,
      el(
        'span',
        `status ${!isStale && p.status === 'ok' ? 'connected' : 'muted'}`,
        p.status === 'ok' ? (isStale ? 'Stale' : 'Connected') : p.status.replaceAll('-', ' '),
      ),
    );
    card.append(top);
    // Two standard windows stay visible. Extra model caps have a concise summary and full details in settings.
    const standard = p.quotas.filter((q) =>
      ['five_hour', 'seven_day', 'primary_window', 'secondary_window'].includes(q.id),
    );
    const visible = (standard.length ? standard : p.quotas).slice(0, 2);
    if (visible.length) {
      const columns = el('div', 'muted quota-columns');
      columns.append(
        el('span', '', 'Window'),
        el('span', '', state.settings.display === 'used' ? 'Used' : 'Remaining'),
        el('span', '', 'Resets · time left'),
      );
      card.append(columns);
    }
    for (const q of visible) {
      const quotaStale = isStale || !current(q);
      const row = el('div', 'compact-quota');
      const name = el('span', 'quota-label', q.label.replace(' allowance', ''));
      const meter = el('progress');
      meter.max = 100;
      meter.value = q.remaining;
      meter.style.setProperty('--quota-color', quotaStale ? '#78858d' : color(q.remaining));
      meter.setAttribute(
        'aria-label',
        `${q.remaining.toFixed(1)}% remaining${quotaStale ? ', stale' : ''}`,
      );
      const amount = el('strong', '', `${Math.round(q[state.settings.display])}%`);
      amount.title = `${state.settings.display} · ${q.used.toFixed(1)}% reported used · ${q.remaining.toFixed(1)}% calculated remaining`;
      const resetInfo = resetDisplay(q.resetAt);
      const reset = el('span', 'muted reset');
      const resetDate = el('time', 'reset-date', resetInfo.date);
      if (resetInfo.iso) resetDate.dateTime = resetInfo.iso;
      reset.append(resetDate, el('span', 'reset-hours', resetInfo.remaining));
      reset.title = `${resetInfo.title} · ${q.used.toFixed(1)}% consumed`;
      row.append(name, meter, amount, reset);
      card.append(row);
    }
    if (p.quotas.length > visible.length) {
      const hidden = p.quotas.filter((q) => !visible.includes(q));
      const worst = hidden.reduce((a, b) => (a.remaining < b.remaining ? a : b));
      const extra = button(
        `+${hidden.length} model cap${hidden.length === 1 ? '' : 's'} · lowest ${Math.round(worst.remaining)}% left`,
        () => details('#readings'),
        'extra-caps quiet',
      );
      extra.title = hidden.map((q) => `${q.label}: ${q.remaining.toFixed(1)}% left`).join('\n');
      card.append(extra);
    }
    if (!p.quotas.length) {
      const detail = el(
        'p',
        'compact-detail muted',
        id === 'chatgpt'
          ? 'Overall quota unavailable'
          : p.status === 'auth'
            ? `Sign in at ${id === 'claude' ? 'claude.ai' : 'chatgpt.com'}, then refresh`
            : p.detail,
      );
      detail.title = p.detail;
      card.append(detail);
    }
    if (p.quotas.length) {
      const active = p.quotas.filter((q) => current(q));
      const limiting = (active.length ? active : p.quotas).reduce((a, b) =>
        a.remaining < b.remaining ? a : b,
      );
      const f =
        isStale || !current(limiting)
          ? null
          : forecast(
              state.history,
              id,
              limiting,
              state.settings.forecastHours,
              Date.now(),
              p.account,
              state.settings.interval,
              state.settings.idleAware,
            );
      const line = el('p', 'compact-detail muted', forecastText(f));
      line.classList.add('forecast-summary');
      line.title = f
        ? `${limiting.label}: ${f.message}${f.usedAtReset === null ? '' : ` Estimated used at reset: ${f.usedAtReset.toFixed(0)}%.`} Reported consumption; remaining is calculated.`
        : p.detail;
      card.append(line);
    }
    const footer = el('div', 'spread compact-footer');
    footer.append(
      el('span', 'muted', p.lastSuccess ? `Updated ${age(p.lastSuccess)}` : 'No reading yet'),
    );
    const link = button('Details ↗', () => details('#readings'), 'quiet');
    link.setAttribute('aria-label', `${NAMES[id]} connection details`);
    footer.append(link);
    card.append(footer);
    app.append(card);
  }
  if (!enabled)
    app.append(el('p', 'muted', 'All providers are disabled. Enable them in settings.'));
  const footer = el('footer', 'spread');
  footer.append(
    button('History & forecasts ↗', () => details('#history'), 'quiet'),
    el('span', 'muted', `v${browser.runtime.getManifest().version}`),
  );
  app.append(footer);
}
async function refresh(manual = false) {
  if (busy) return;
  busy = true;
  connectionError = '';
  if (state) render();
  try {
    state = await browser.runtime.sendMessage({ type: manual ? 'refresh' : 'popup' });
  } catch {
    connectionError = 'Connection unavailable. Reopen to retry.';
  } finally {
    busy = false;
    if (state) render();
  }
}
browser.storage.onChanged.addListener((changes) => {
  if (changes.monitor?.newValue) {
    state = changes.monitor.newValue as Store;
    render();
  }
});
void (async () => {
  state = await browser.runtime.sendMessage({ type: 'read' });
  render();
  await refresh();
})().catch(() => {
  app.textContent = 'Unable to load local storage. Reload the extension.';
});
setInterval(() => {
  if (state) render();
}, 30000);
