export const groups = ['Added', 'Changed', 'Fixed', 'Removed'];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a, b) {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
function validateChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    throw new Error('Invalid changelog changes.');
  for (const [group, notes] of Object.entries(changes))
    if (
      !groups.includes(group) ||
      !Array.isArray(notes) ||
      notes.some((note) => typeof note !== 'string' || !note.trim())
    )
      throw new Error('Invalid changelog group or description.');
}
export function versionHistory(history, version) {
  if (!semver.test(version)) throw new Error('Version must use MAJOR.MINOR.PATCH.');
  validateChanges(history.unreleased);
  if (!Array.isArray(history.releases) || !history.releases.length)
    throw new Error('Changelog needs released history.');
  const seen = new Set();
  for (const entry of history.releases) {
    if (!semver.test(entry.version) || seen.has(entry.version))
      throw new Error('Invalid or duplicate changelog version.');
    seen.add(entry.version);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      new Date(`${entry.date}T12:00:00Z`).toISOString().slice(0, 10) !== entry.date
    )
      throw new Error('Invalid changelog release date.');
    validateChanges(entry.changes);
    if (!Object.values(entry.changes).some((notes) => notes.length))
      throw new Error('Release needs change descriptions.');
  }
  const releases = [...history.releases].sort(
    (a, b) => b.date.localeCompare(a.date) || compareVersions(b.version, a.version),
  );
  if (
    releases[0].version !== version ||
    releases.some((entry) => compareVersions(entry.version, version) > 0)
  )
    throw new Error('Package version must match the latest released changelog entry.');
  return { version, unreleased: history.unreleased, releases };
}
export function nextVersion(version, level) {
  if (!semver.test(version) || !['major', 'minor', 'patch'].includes(level))
    throw new Error('Choose major, minor or patch.');
  const parts = version.split('.').map(Number),
    index = ['major', 'minor', 'patch'].indexOf(level);
  parts[index]++;
  for (let n = index + 1; n < 3; n++) parts[n] = 0;
  return parts.join('.');
}
export function releaseNotes(entry) {
  return (
    `## ${entry.version} — ${entry.date}\n\n` +
    groups
      .filter((group) => entry.changes[group]?.length)
      .map(
        (group) => `### ${group}\n\n${entry.changes[group].map((note) => `- ${note}`).join('\n')}`,
      )
      .join('\n\n') +
    '\n'
  );
}
export function prepareRelease(history, version, level, date) {
  versionHistory(history, version);
  if (!Object.values(history.unreleased).some((notes) => notes.length))
    throw new Error('Add Unreleased changes before preparing a release.');
  const next = nextVersion(version, level);
  const updated = {
    unreleased: {},
    releases: [
      {
        version: next,
        date,
        source: 'Release preparation date (US Eastern)',
        changes: history.unreleased,
      },
      ...history.releases,
    ],
  };
  versionHistory(updated, next);
  return { version: next, history: updated };
}
