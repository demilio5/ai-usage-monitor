import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { unzipSync, strFromU8 } from 'fflate';

export function verifySignedXpi(bytes, unsigned, manifest, expectedHash) {
  if (
    !/^sha256:[a-f0-9]{64}$/i.test(expectedHash) ||
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== expectedHash.toLowerCase()
  )
    throw new Error('Signed download does not match the Mozilla SHA-256 hash.');
  const signed = unzipSync(bytes),
    original = unzipSync(unsigned);
  const metadata = JSON.parse(strFromU8(signed['manifest.json']));
  if (
    metadata.version !== manifest.version ||
    metadata.browser_specific_settings?.gecko?.id !== manifest.browser_specific_settings.gecko.id ||
    metadata.browser_specific_settings?.gecko?.update_url !==
      manifest.browser_specific_settings.gecko.update_url
  )
    throw new Error('Signed extension identity, version, or update URL differs from this release.');
  for (const [name, content] of Object.entries(original))
    if (
      !signed[name] ||
      (name === 'manifest.json'
        ? !isDeepStrictEqual(JSON.parse(strFromU8(content)), metadata)
        : !Buffer.from(content).equals(Buffer.from(signed[name])))
    )
      throw new Error(`Signed package differs from the local build: ${name}`);
  if (!Object.keys(signed).some((name) => /^META-INF\/.*\.(rsa|p7s)$/i.test(name)))
    throw new Error('Downloaded extension has no Mozilla signature files.');
}

export function updateFeed(manifest, repository, hash) {
  if (
    !/^[-\w]+\/[-.\w]+$/.test(repository) ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw new Error('Invalid release metadata.');
  const gecko = manifest.browser_specific_settings.gecko;
  return {
    addons: {
      [gecko.id]: {
        updates: [
          {
            version: manifest.version,
            update_link: `https://github.com/${repository}/releases/download/v${manifest.version}/ai-usage-monitor-${manifest.version}.xpi`,
            update_hash: `sha256:${hash}`,
            applications: { gecko: { strict_min_version: gecko.strict_min_version } },
          },
        ],
      },
    },
  };
}
