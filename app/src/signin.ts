// Signing in: the invite code alone (MAK, 18 Oct 2026). A new member's code makes the member;
// a sign in code from an admin puts this phone into an existing member's account. The server
// answers with a session for this phone. (The server still accepts Sign in with Apple for the
// accounts that were made with it; the app no longer offers it.)
import * as Device from 'expo-device';
import { api, type Member } from './api';
import { saveSession } from './store';

export async function codeSignIn(code: string, name?: string) {
  const out = await api<{ token: string; member: Member }>('POST', '/auth/code', {
    code,
    name: name?.trim() || undefined,
    deviceLabel: Device.modelName || 'iPhone',
  });
  await saveSession(out.token, out.member);
  return out.member;
}
