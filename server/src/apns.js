// Push to iPhones through Apple Push Notification service with token auth:
// a short JWT signed with the .p8 key MAK made on developer.apple.com (key id + team id).
// Only the file path is configured; the key is read from that file when the server starts.
import http2 from 'node:http2';
import crypto from 'node:crypto';
import fs from 'node:fs';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function makeApnsSender({ keyPath, keyId, teamId, production, topic, log = console, host: hostOverride }) {
  if (!keyPath || !keyId || !teamId) {
    log.warn?.('[push] APNS_KEY_PATH / APNS_KEY_ID / APNS_TEAM_ID not set: push is off');
    return null;
  }
  let key;
  try {
    key = crypto.createPrivateKey(fs.readFileSync(keyPath));
  } catch (e) {
    log.error?.(`[push] cannot read the APNs key at ${keyPath}: ${e.message}. Push is off`);
    return null;
  }
  const host = hostOverride || (production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
  let jwt = null;
  let jwtAt = 0;
  let session = null;

  function token() {
    // Apple wants a fresh token at most every 20 minutes and refuses ones older than an hour
    const now = Math.floor(Date.now() / 1000);
    if (jwt && now - jwtAt < 40 * 60) return jwt;
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = b64url(JSON.stringify({ iss: teamId, iat: now }));
    const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
    jwt = `${header}.${claims}.${b64url(sig)}`;
    jwtAt = now;
    return jwt;
  }

  function connect() {
    if (session && !session.closed && !session.destroyed) return session;
    session = http2.connect(host);
    session.on('error', (e) => log.error?.(`[push] connection: ${e.message}`));
    session.on('goaway', () => session?.close());
    session.setTimeout(10 * 60_000, () => session?.close());
    return session;
  }

  // pushType 'alert' for messages; phase 2 adds 'voip' (topic + '.voip') for ringing calls
  return function send(deviceToken, payload, { pushType = 'alert', collapseId, expiration = 0, priority = 10 } = {}) {
    return new Promise((resolve) => {
      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${token()}`,
        'apns-topic': pushType === 'voip' ? `${topic}.voip` : topic,
        'apns-push-type': pushType,
        'apns-priority': String(priority),
        'apns-expiration': String(expiration),
      };
      if (collapseId) headers['apns-collapse-id'] = collapseId;
      let req;
      try {
        req = connect().request(headers);
      } catch (e) {
        return resolve({ ok: false, status: 0, reason: e.message });
      }
      let status = 0;
      let body = '';
      req.setEncoding('utf8');
      req.on('response', (h) => (status = h[':status']));
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let reason = '';
        try { reason = body ? JSON.parse(body).reason : ''; } catch { /* empty */ }
        resolve({ ok: status === 200, status, reason });
      });
      req.on('error', (e) => resolve({ ok: false, status: 0, reason: e.message }));
      req.end(JSON.stringify(payload));
    });
  };
}
