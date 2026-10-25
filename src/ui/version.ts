import { el } from './dom';
export function versionLink() {
  const link = el('a', 'version-link', `v${browser.runtime.getManifest().version}`);
  link.href = browser.runtime.getURL('history.html');
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute(
    'aria-label',
    `Version ${browser.runtime.getManifest().version} — Version History`,
  );
  return link;
}
export function applicationTitle() {
  const title = el('div', 'application-title');
  title.append(el('h1', '', 'AI Usage Monitor'), versionLink());
  return title;
}
