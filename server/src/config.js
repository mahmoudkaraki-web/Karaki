// Settings come from the environment (or an env file passed with node --env-file).
// Nothing secret lives in the repo: the APNs key is a file path, the data folder is outside git.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// APNS_KEY_PATH may name the .p8 file itself or the folder it sits in (MAK keeps it in
// "Karaki APP\Push Key"). In a folder, the one AuthKey_XXXXXXXXXX.p8 there is used, and when
// APNS_KEY_ID is not set the key id is taken from that file NAME (the contents are not looked at here).
export function resolveApnsKey(keyPath, keyId) {
  if (!keyPath) return { keyPath: '', keyId: keyId || '' };
  let file = keyPath;
  try {
    if (fs.statSync(keyPath).isDirectory()) {
      const found = fs.readdirSync(keyPath).filter((f) => /^AuthKey_[A-Z0-9]{10}\.p8$/.test(f));
      file = found.length === 1 ? path.join(keyPath, found[0]) : '';
    }
  } catch { /* missing: push stays off and the log says so */ }
  const fromName = /AuthKey_([A-Z0-9]{10})\.p8$/.exec(path.basename(file || ''));
  return { keyPath: file || keyPath, keyId: keyId || (fromName ? fromName[1] : '') };
}

const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : fallback;
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    production,
    host: env.HOST || '127.0.0.1', // behind Caddy in production: Caddy holds the certificate and talks HTTPS to the world
    port: num(env.PORT, 4100),
    dataDir: path.resolve(env.DATA_DIR || path.join(here, '..', 'data')),
    publicUrl: env.PUBLIC_URL || 'http://localhost:4100',
    bundleId: env.APPLE_BUNDLE_ID || 'com.besmart.karaki',
    // Sign in with Apple: tokens are checked against Apple's published keys
    appleJwksUrl: env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys',
    appleIssuer: 'https://appleid.apple.com',
    // APNs token auth: MAK places the .p8 file and points APNS_KEY_PATH at it; push is off until then
    apns: {
      ...resolveApnsKey(env.APNS_KEY_PATH || '', env.APNS_KEY_ID || ''),
      teamId: env.APNS_TEAM_ID || '5TV89KGJVR',
      production: env.APNS_PRODUCTION === '1' || env.APNS_PRODUCTION === 'true',
      showPreview: env.PUSH_PREVIEW !== '0', // 0 hides message text on the lock screen
    },
    // calls: STUN and TURN addresses and the TURN secret come from the environment only
    calls: {
      ringMs: num(env.CALL_RING_SECONDS, 45) * 1000,
      reconnectGraceMs: num(env.CALL_RECONNECT_SECONDS, 20) * 1000,
      maxParticipants: num(env.CALL_MAX_PEOPLE, 4),
      stunUrls: list(env.STUN_URLS),
      turnUrls: list(env.TURN_URLS),
      turnSecret: env.TURN_SECRET || '',
      // about two hours per call; coturn checks the expiry when a phone asks for or refreshes a relay
      turnTtlSeconds: num(env.TURN_TTL_SECONDS, 2 * 3600),
    },
    limits: {
      textChars: num(env.LIMIT_TEXT_CHARS, 8000),
      photoBytes: num(env.LIMIT_PHOTO_MB, 15) * 1024 * 1024,
      voiceBytes: num(env.LIMIT_VOICE_MB, 12) * 1024 * 1024,
      voiceSeconds: num(env.LIMIT_VOICE_SECONDS, 600),
      groupTitleChars: 60,
      nameChars: 40,
      pageSize: 50,
      inviteDays: num(env.INVITE_DAYS, 7),
    },
  };
}
