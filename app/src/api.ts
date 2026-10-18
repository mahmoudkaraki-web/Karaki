// Talking to the family server over HTTPS. The address comes from app.json (extra.serverUrl);
// for testing before the server is online it can be changed on the welcome screen (long press
// the word Karaki), and the change is kept on this phone only.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export type Member = { id: number; name: string; color: string; isAdmin: boolean; removed?: boolean };
export type Media = { id: string; kind: 'photo' | 'voice'; mime: string; bytes: number; width: number | null; height: number | null; durationMs: number | null };
export type Message = {
  id: number; chatId: number; senderId: number | null; kind: 'text' | 'photo' | 'voice' | 'system' | 'call';
  body: string | null; media: Media | null; clientId: string | null; createdAt: number;
};
export type Receipt = { delivered: number; read: number };
export type Chat = {
  id: number; kind: 'direct' | 'group'; title: string | null; createdBy: number; createdAt: number; updatedAt: number;
  members: Member[]; receipts: Record<string, Receipt>; unread: number; last: Message | null;
  activeCall: { id: string; kind: 'voice' | 'video'; startedBy: number; joined: number[] } | null;
};
export type CallMember = { id: number; state: 'ringing' | 'joined' | 'left' | 'declined' | 'missed' | 'busy' };
export type CallRecord = {
  id: string; chatId: number; kind: 'voice' | 'video'; startedBy: number; createdAt: number;
  answeredAt: number | null; endedAt: number | null; endReason: string | null; ringUntil: number; members: CallMember[];
};
export type Invite = { id: number; code?: string; link?: string; appLink?: string; nameHint: string | null; isAdmin?: boolean; expiresAt: number; forMember?: number | null };

const SERVER_KEY = 'family.server';
let serverUrl: string = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl || 'https://karaki.besmart-me.com';
let token: string | null = null;

export async function loadServerUrl() {
  const saved = await SecureStore.getItemAsync(SERVER_KEY);
  if (saved) serverUrl = saved;
  return serverUrl;
}

export async function setServerUrl(url: string | null) {
  const clean = (url || '').trim().replace(/\/+$/, '');
  if (clean) { serverUrl = clean; await SecureStore.setItemAsync(SERVER_KEY, clean); } else {
    await SecureStore.deleteItemAsync(SERVER_KEY);
    serverUrl = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl || 'https://karaki.besmart-me.com';
  }
  return serverUrl;
}

export const getServerUrl = () => serverUrl;
export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;
export const socketUrl = () => serverUrl.replace(/^http/, 'ws') + '/ws';
export const mediaUrl = (id: string) => `${serverUrl}/media/${id}`;
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

let onSignedOut: (() => void) | null = null;
export const whenSignedOut = (fn: () => void) => { onSignedOut = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(serverUrl + path, {
      method,
      headers: { ...authHeaders(), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const code = data?.error || `http_${res.status}`;
    if (res.status === 401 && code === 'signed_out' && token) onSignedOut?.();
    throw new ApiError(res.status, code);
  }
  return data as T;
}

export async function uploadMedia(kind: 'photo' | 'voice', uri: string, meta: { width?: number; height?: number; durationMs?: number }) {
  const fd = new FormData();
  fd.append('kind', kind);
  for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, String(Math.round(v)));
  const name = kind === 'photo' ? 'photo.jpg' : 'voice.m4a';
  const typeGuess = kind === 'photo' ? 'image/jpeg' : 'audio/mp4';
  // React Native's FormData takes a file as { uri, name, type }
  fd.append('file', { uri, name, type: typeGuess } as unknown as Blob);
  const out = await api<{ media: Media }>('POST', '/media', fd);
  return out.media;
}

// words a person can read for each error the server or network gives
export function sayError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'unknown';
  const words: Record<string, string> = {
    offline: 'The family server cannot be reached. Check the connection and try again.',
    invite_invalid: 'That invite code is not valid any more. Ask for a new one.',
    invite_required: 'You need an invite code the first time.',
    bad_token: 'Apple sign in did not go through. Please try again.',
    bad_nonce: 'Apple sign in did not go through. Please try again.',
    removed: 'This person is no longer part of the family.',
    too_many_tries: 'Too many tries. Wait a few minutes and try again.',
    file_too_big: 'That file is too big to send.',
    voice_too_long: 'That voice note is too long.',
    unsupported_file: 'That kind of file cannot be sent.',
    not_allowed: 'Only the person who started the group can do that.',
    admins_only: 'Only a family admin can do that.',
    not_a_member: 'You are not in this chat any more.',
  };
  return words[code] || 'Something went wrong. Please try again.';
}
