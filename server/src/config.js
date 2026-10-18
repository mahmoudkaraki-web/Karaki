// Settings come from the environment (or an env file passed with node --env-file).
// Nothing secret lives in the repo: the APNs key is a file path, the data folder is outside git.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

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
    bundleId: env.APPLE_BUNDLE_ID || 'com.besmart.family',
    // Sign in with Apple: tokens are checked against Apple's published keys
    appleJwksUrl: env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys',
    appleIssuer: 'https://appleid.apple.com',
    // APNs token auth: MAK places the .p8 file and sets these three; push is off until then
    apns: {
      keyPath: env.APNS_KEY_PATH || '',
      keyId: env.APNS_KEY_ID || '',
      teamId: env.APNS_TEAM_ID || '5TV89KGJVR',
      production: env.APNS_PRODUCTION === '1' || env.APNS_PRODUCTION === 'true',
      showPreview: env.PUSH_PREVIEW !== '0', // 0 hides message text on the lock screen
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
