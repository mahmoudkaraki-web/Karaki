// Sign in with Apple: the phone gets an identity token (a JWT signed by Apple) and sends it here.
// We check the signature against Apple's published keys, the issuer, the audience (our bundle id),
// the expiry, and the nonce the phone made for this one sign in (so a token cannot be replayed).
import { createRemoteJWKSet, jwtVerify } from 'jose';
import crypto from 'node:crypto';

export function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// keySet: anything jose accepts as a key getter. In production the remote Apple set (cached by jose);
// tests pass a local set made from their own key so the very same checks run offline.
export function makeAppleVerifier({ jwksUrl, issuer, audience, keySet }) {
  const keys = keySet || createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 60_000, cacheMaxAge: 6 * 3600_000 });
  return async function verifyAppleToken(identityToken, rawNonce) {
    if (typeof identityToken !== 'string' || identityToken.length > 8192) throw new AuthError('bad_token');
    let payload;
    try {
      ({ payload } = await jwtVerify(identityToken, keys, { issuer, audience, algorithms: ['RS256', 'ES256'] }));
    } catch {
      throw new AuthError('bad_token');
    }
    if (!payload.sub) throw new AuthError('bad_token');
    // the phone sends Apple sha256(rawNonce) and sends us rawNonce; Apple puts the hash in the token
    if (payload.nonce !== undefined || rawNonce !== undefined) {
      if (typeof rawNonce !== 'string' || payload.nonce !== sha256Hex(rawNonce)) throw new AuthError('bad_nonce');
    }
    return { sub: String(payload.sub), email: payload.email ? String(payload.email) : null };
  };
}

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
