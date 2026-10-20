import { createHmac, randomUUID } from 'node:crypto';

export const amoBase = 'https://addons.mozilla.org/api/v5/';
export function createJwt(issuer, secret, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`;
}
export function mozillaClient({ issuer, secret, fetcher = fetch }) {
  if (!issuer || !secret) throw new Error('Mozilla signing credentials are missing.');
  return async (path, options = {}, allowMissing = false) => {
    const url = new URL(path, amoBase);
    if (url.origin !== new URL(amoBase).origin || !url.pathname.startsWith('/api/v5/'))
      throw new Error('Mozilla credentials may only be sent to the production signing API.');
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        headers: { ...options.headers, Authorization: `JWT ${createJwt(issuer, secret)}` },
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error('Mozilla API network request failed.');
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      let details = '';
      try {
        const body = await response.json();
        const fields = Object.fromEntries(
          [
            'upload',
            'source',
            'license',
            'approval_notes',
            'compatibility',
            'version',
            'detail',
            'non_field_errors',
          ]
            .filter((key) => body[key] !== undefined)
            .map((key) => [key, body[key]]),
        );
        details = JSON.stringify(fields)
          .replaceAll(secret, '[redacted]')
          .replaceAll(issuer, '[redacted]')
          .replace(
            /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
            '[redacted-token]',
          )
          .slice(0, 1200);
      } catch {
        /* Only static status is reported for malformed error bodies. */
      }
      const error = new Error(
        `Mozilla API returned HTTP ${response.status}${details && details !== '{}' ? `: ${details}` : '; check Developer Hub for details.'}`,
      );
      error.status = response.status;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      throw new Error('Mozilla API returned invalid JSON.');
    }
  };
}
