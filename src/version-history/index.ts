import { el, theme } from '../ui/dom';
import { applicationTitle } from '../ui/version';
type Changes = Record<string, string[]>;
interface History {
  version: string;
  unreleased: Changes;
  releases: { version: string; date: string; source?: string; changes: Changes }[];
}
function changeGroups(changes: Changes, parent: HTMLElement) {
  for (const group of ['Added', 'Changed', 'Fixed', 'Removed']) {
    if (!changes[group]?.length) continue;
    parent.append(el('h3', '', group));
    const list = el('ul');
    for (const note of changes[group]) list.append(el('li', '', note));
    parent.append(list);
  }
}
void (async () => {
  const app = document.querySelector<HTMLElement>('#app')!;
  const response = await fetch(browser.runtime.getURL('version-history.json'));
  if (!response.ok) throw new Error('History unavailable');
  const history: History = await response.json();
  if (
    history.version !== browser.runtime.getManifest().version ||
    history.releases[0]?.version !== history.version
  )
    throw new Error('Version history mismatch');
  const state = await browser.storage.local.get('monitor');
  theme(state.monitor?.settings?.theme ?? 'auto');
  app.replaceChildren(applicationTitle());
  const nav = el('nav', 'history-nav');
  const settings = el('a', '', '← Settings');
  settings.href = browser.runtime.getURL('options.html');
  nav.append(settings);
  app.append(
    nav,
    el('h2', '', 'Version History'),
    el(
      'p',
      'muted',
      'Dates use US Eastern time. Earlier unlisted releases use the recorded Mozilla review date. Git references below identify implementation dates; the repository begins with the 1.0.5 snapshot.',
    ),
  );
  if (Object.values(history.unreleased).some((notes) => notes.length)) {
    const upcoming = el('section', 'card upcoming');
    upcoming.append(
      el('h2', '', 'Unreleased'),
      el('p', 'muted', 'Changes being prepared for a future release.'),
    );
    changeGroups(history.unreleased, upcoming);
    app.append(upcoming);
  }
  for (const release of history.releases) {
    const entry = el('article', 'card release-entry');
    entry.id = `v${release.version}`;
    const heading = el('div', 'spread release-heading');
    const date = el(
      'time',
      'muted',
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      }).format(new Date(`${release.date}T12:00:00Z`)),
    );
    date.dateTime = release.date;
    if (release.source) date.title = release.source;
    heading.append(el('h2', '', `v${release.version}`), date);
    entry.append(heading);
    changeGroups(release.changes, entry);
    if (release.source) entry.append(el('p', 'muted history-source', release.source));
    app.append(entry);
  }
})().catch(() => {
  document.querySelector('#app')!.textContent =
    'Could not load version history. Reload the extension.';
});
