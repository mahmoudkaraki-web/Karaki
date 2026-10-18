// Sign in with Apple, the app's half: a fresh nonce per try (Apple puts its hash in the token,
// the server checks it), the identity token goes to our server, which answers with a session.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { api, type Member } from './api';
import { saveSession } from './store';

export type AppleAnswer = { identityToken: string; nonce: string; name?: string };

export async function appleSignIn(): Promise<AppleAnswer | null> {
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
      nonce: hashed,
    });
    if (!cred.identityToken) return null;
    // Apple gives the name only the very first time someone signs in to the app
    const name = cred.fullName ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(' ') : '';
    return { identityToken: cred.identityToken, nonce, name: name || undefined };
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

export async function finishSignIn(apple: AppleAnswer, { inviteCode, name }: { inviteCode?: string; name?: string }) {
  const out = await api<{ token: string; member: Member }>('POST', '/auth/apple', {
    identityToken: apple.identityToken,
    nonce: apple.nonce,
    inviteCode,
    name: name || apple.name,
    deviceLabel: Device.modelName || 'iPhone',
  });
  await saveSession(out.token, out.member);
  return out.member;
}
