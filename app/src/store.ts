// The app's memory: who is signed in, the family, the chats, the messages of the chats that
// were opened, ticks, typing and who has the app open. One store, read by screens through
// useFamily(); everything that changes it lives here so screens stay simple.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { api, setToken, uploadMedia, whenSignedOut, loadServerUrl, type Chat, type Media, type Member, type Message } from './api';
import { Live } from './live';

export type LocalMessage = Message & { pending?: boolean; failed?: boolean; localUri?: string; localDurationMs?: number };
type Thread = { items: LocalMessage[]; hasMore: boolean; loaded: boolean; loading: boolean };

export type State = {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Member | null;
  members: Member[];
  online: number[];
  connected: boolean;
  chats: Record<number, Chat>;
  threads: Record<number, Thread>;
  typing: Record<number, Record<number, number>>; // chatId -> memberId -> until (ms)
  openChatId: number | null;
};

const SESSION_KEY = 'family.session';

let state: State = {
  status: 'loading', me: null, members: [], online: [], connected: false,
  chats: {}, threads: {}, typing: {}, openChatId: null,
};
const listeners = new Set<() => void>();
let live: Live | null = null;
let appActive = AppState.currentState === 'active';

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const l of listeners) l();
}

export function useFamily<T>(pick: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => pick(state));
}
export const getState = () => state;

// ---------- helpers ----------
const topId = (items: LocalMessage[]) => {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].id > 0) return items[i].id;
  return 0;
};

function mergeIntoThread(chatId: number, incoming: LocalMessage[]) {
  const t = state.threads[chatId];
  if (!t) return;
  const byKey = new Map<string, LocalMessage>();
  for (const m of t.items) byKey.set(m.id > 0 ? `i${m.id}` : `c${m.clientId}`, m);
  for (const m of incoming) {
    // a confirmed message replaces its pending copy (same clientId), keeping the local file for instant display
    if (m.clientId && byKey.has(`c${m.clientId}`)) {
      const local = byKey.get(`c${m.clientId}`)!;
      byKey.delete(`c${m.clientId}`);
      byKey.set(`i${m.id}`, { ...m, localUri: local.localUri, localDurationMs: local.localDurationMs });
    } else byKey.set(m.id > 0 ? `i${m.id}` : `c${m.clientId}`, m);
  }
  const items = [...byKey.values()].sort((a, b) => (a.id > 0 ? a.id : Infinity) - (b.id > 0 ? b.id : Infinity) || a.createdAt - b.createdAt);
  set((s) => ({ threads: { ...s.threads, [chatId]: { ...t, items } } }));
}

function patchChat(chatId: number, fn: (c: Chat) => Chat) {
  const c = state.chats[chatId];
  if (c) set((s) => ({ chats: { ...s.chats, [chatId]: fn(c) } }));
}

// ---------- live events ----------
function onEvent(ev: any) {
  const me = state.me;
  switch (ev.type) {
    case 'ready':
      set({ me: ev.member, online: ev.online });
      afterConnect();
      break;
    case 'message': {
      const m: Message = ev.message;
      mergeIntoThread(m.chatId, [m]);
      const mine = m.senderId === me?.id;
      const isOpen = state.openChatId === m.chatId && appActive;
      patchChat(m.chatId, (c) => ({
        ...c, last: m, updatedAt: m.createdAt,
        unread: mine || m.kind === 'system' || isOpen ? (mine ? 0 : c.unread) : c.unread + 1,
      }));
      if (!mine) {
        if (isOpen) live?.send({ type: 'read', chatId: m.chatId, upTo: m.id });
        else live?.send({ type: 'delivered', chatId: m.chatId, upTo: m.id });
        clearTyping(m.chatId, m.senderId);
      }
      break;
    }
    case 'chat':
      set((s) => ({ chats: { ...s.chats, [ev.chat.id]: ev.chat } }));
      break;
    case 'chat_removed':
      set((s) => {
        const chats = { ...s.chats };
        delete chats[ev.chatId];
        return { chats };
      });
      break;
    case 'receipt':
      patchChat(ev.chatId, (c) => ({
        ...c,
        receipts: { ...c.receipts, [ev.memberId]: { delivered: ev.delivered, read: ev.read } },
        unread: ev.memberId === me?.id && c.last && ev.read >= c.last.id ? 0 : c.unread,
      }));
      break;
    case 'typing': {
      const until = ev.on ? Date.now() + 6000 : 0;
      set((s) => {
        const forChat = { ...(s.typing[ev.chatId] || {}) };
        if (until) forChat[ev.memberId] = until; else delete forChat[ev.memberId];
        return { typing: { ...s.typing, [ev.chatId]: forChat } };
      });
      if (until) setTimeout(() => sweepTyping(), 6100);
      break;
    }
    case 'members':
      set({ members: ev.members });
      break;
    case 'presence':
      set((s) => ({ online: ev.online ? [...new Set([...s.online, ev.memberId])] : s.online.filter((x) => x !== ev.memberId) }));
      break;
    case 'signed_out':
      void forgetSession();
      break;
    default:
      break;
  }
}

function clearTyping(chatId: number, memberId: number | null) {
  if (memberId == null || !state.typing[chatId]?.[memberId]) return;
  set((s) => {
    const forChat = { ...(s.typing[chatId] || {}) };
    delete forChat[memberId];
    return { typing: { ...s.typing, [chatId]: forChat } };
  });
}

function sweepTyping() {
  const now = Date.now();
  let changed = false;
  const typing: State['typing'] = {};
  for (const [cid, who] of Object.entries(state.typing)) {
    const keep: Record<number, number> = {};
    for (const [mid, until] of Object.entries(who)) if (until > now) keep[Number(mid)] = until; else changed = true;
    typing[Number(cid)] = keep;
  }
  if (changed) set({ typing });
}

// after every (re)connect: catch up on what was missed and send what is waiting
async function afterConnect() {
  live?.send({ type: 'delivered' });
  try {
    await refreshChats();
    for (const [cid, t] of Object.entries(state.threads)) {
      if (!t.loaded) continue;
      const after = topId(t.items);
      const page = await api<{ messages: Message[] }>('GET', `/chats/${cid}/messages?after=${after}&limit=200`);
      mergeIntoThread(Number(cid), page.messages);
    }
    if (state.openChatId) markRead(state.openChatId);
  } catch { /* the next reconnect tries again */ }
  for (const t of Object.values(state.threads)) for (const m of t.items) if (m.pending && !m.failed) void deliver(m);
}

export async function refreshChats() {
  const [{ chats }, me] = await Promise.all([
    api<{ chats: Chat[] }>('GET', '/chats'),
    api<{ member: Member; members: Member[] }>('GET', '/me'),
  ]);
  const map: Record<number, Chat> = {};
  for (const c of chats) map[c.id] = c;
  set({ chats: map, me: me.member, members: me.members });
}

// ---------- session ----------
async function startSession(token: string, me: Member) {
  setToken(token);
  set({ status: 'signedIn', me });
  live?.close();
  live = new Live(token, onEvent, (connected) => set({ connected }));
  if (appActive) live.open();
  try { await refreshChats(); } catch { /* offline: the socket catches up later */ }
}

export async function boot() {
  await loadServerUrl();
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return set({ status: 'signedOut' });
  try {
    const s = JSON.parse(raw) as { token: string; member: Member };
    await startSession(s.token, s.member);
  } catch {
    set({ status: 'signedOut' });
  }
}

export async function saveSession(token: string, member: Member) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ token, member }));
  await startSession(token, member);
}

async function forgetSession() {
  live?.close();
  live = null;
  setToken(null);
  await SecureStore.deleteItemAsync(SESSION_KEY);
  set({ status: 'signedOut', me: null, members: [], online: [], chats: {}, threads: {}, typing: {}, openChatId: null, connected: false });
}
whenSignedOut(() => void forgetSession());

export async function signOut() {
  try { await api('POST', '/auth/signout'); } catch { /* signed out here either way */ }
  await forgetSession();
}

AppState.addEventListener('change', (s) => {
  const active = s === 'active';
  if (active === appActive) return;
  appActive = active;
  if (!live) return;
  if (active) live.open(); else live.close();
});

// ---------- chats ----------
export function openChat(chatId: number | null) {
  set({ openChatId: chatId });
  if (chatId) markRead(chatId);
}

export async function loadThread(chatId: number) {
  const t = state.threads[chatId];
  if (t?.loaded || t?.loading) return;
  set((s) => ({ threads: { ...s.threads, [chatId]: { items: t?.items || [], hasMore: false, loaded: false, loading: true } } }));
  try {
    const page = await api<{ messages: Message[]; hasMore: boolean }>('GET', `/chats/${chatId}/messages?limit=50`);
    set((s) => ({ threads: { ...s.threads, [chatId]: { items: s.threads[chatId]?.items || [], hasMore: page.hasMore, loaded: true, loading: false } } }));
    mergeIntoThread(chatId, page.messages);
    markRead(chatId);
  } catch {
    set((s) => ({ threads: { ...s.threads, [chatId]: { ...s.threads[chatId], loading: false } } }));
  }
}

export async function loadOlder(chatId: number) {
  const t = state.threads[chatId];
  if (!t || !t.hasMore || t.loading) return;
  const first = t.items.find((m) => m.id > 0);
  if (!first) return;
  set((s) => ({ threads: { ...s.threads, [chatId]: { ...t, loading: true } } }));
  try {
    const page = await api<{ messages: Message[]; hasMore: boolean }>('GET', `/chats/${chatId}/messages?before=${first.id}&limit=50`);
    mergeIntoThread(chatId, page.messages);
    set((s) => ({ threads: { ...s.threads, [chatId]: { ...s.threads[chatId], hasMore: page.hasMore, loading: false } } }));
  } catch {
    set((s) => ({ threads: { ...s.threads, [chatId]: { ...s.threads[chatId], loading: false } } }));
  }
}

export function markRead(chatId: number) {
  const c = state.chats[chatId];
  const me = state.me;
  if (!c || !me || !appActive) return;
  const top = Math.max(c.last?.id || 0, topId(state.threads[chatId]?.items || []));
  const mine = c.receipts[me.id]?.read || 0;
  if (top <= mine && !c.unread) return;
  patchChat(chatId, (x) => ({ ...x, unread: 0, receipts: { ...x.receipts, [me.id]: { delivered: Math.max(top, x.receipts[me.id]?.delivered || 0), read: top } } }));
  if (!live?.send({ type: 'read', chatId, upTo: top })) api('POST', `/chats/${chatId}/read`, { upTo: top }).catch(() => {});
}

let lastTypingSent = 0;
export function sendTyping(chatId: number, on: boolean) {
  const now = Date.now();
  if (on && now - lastTypingSent < 3000) return;
  lastTypingSent = on ? now : 0;
  live?.send({ type: 'typing', chatId, on });
}

// ---------- sending ----------
function newClientId() {
  return Crypto.randomUUID().replace(/-/g, '');
}

function addPending(chatId: number, m: Partial<LocalMessage>): LocalMessage {
  const msg: LocalMessage = {
    id: 0, chatId, senderId: state.me!.id, kind: 'text', body: null, media: null,
    clientId: newClientId(), createdAt: Date.now(), pending: true, ...m,
  };
  set((s) => ({ threads: { ...s.threads, [chatId]: { ...(s.threads[chatId] || { hasMore: false, loaded: true, loading: false }), items: [...(s.threads[chatId]?.items || []), msg] } } }));
  return msg;
}

function updateLocal(m: LocalMessage, patch: Partial<LocalMessage>) {
  const t = state.threads[m.chatId];
  if (!t) return;
  set((s) => ({ threads: { ...s.threads, [m.chatId]: { ...t, items: t.items.map((x) => (x.clientId === m.clientId && x.id === 0 ? { ...x, ...patch } : x)) } } }));
}

const inFlight = new Set<string>();

// gets one waiting message to the server: upload its file first if it has one, then send.
// The server keeps only one copy per clientId, so trying again is always safe.
async function deliver(m: LocalMessage) {
  if (!m.clientId || inFlight.has(m.clientId)) return;
  inFlight.add(m.clientId);
  try {
    let mediaId = m.media?.id;
    if (!mediaId && m.localUri && (m.kind === 'photo' || m.kind === 'voice')) {
      const media = await uploadMedia(m.kind, m.localUri, { width: m.media?.width ?? undefined, height: m.media?.height ?? undefined, durationMs: m.localDurationMs });
      mediaId = media.id;
      updateLocal(m, { media });
      m = { ...m, media };
    }
    const payload = { chatId: m.chatId, kind: m.kind, body: m.body, mediaId, clientId: m.clientId };
    let sent: Message;
    if (live?.connected) sent = (await live.request<{ message: Message }>({ type: 'send', ...payload })).message;
    else sent = (await api<{ message: Message }>('POST', `/chats/${m.chatId}/messages`, payload)).message;
    mergeIntoThread(m.chatId, [sent]);
    patchChat(m.chatId, (c) => (c.last && c.last.id >= sent.id ? c : { ...c, last: sent, updatedAt: sent.createdAt }));
  } catch (e: any) {
    const status = e?.status ?? 0;
    const code = e?.code ?? e?.message;
    // a refusal (not a network drop) will not get better by waiting: show it as failed
    const permanent = (status >= 400 && status < 500) || ['bad_media', 'not_a_member', 'text_too_long', 'file_too_big', 'unsupported_file', 'voice_too_long'].includes(code);
    if (permanent) updateLocal(m, { failed: true });
  } finally {
    inFlight.delete(m.clientId!);
  }
}

export function sendText(chatId: number, text: string) {
  const body = text.trim();
  if (!body) return;
  void deliver(addPending(chatId, { kind: 'text', body }));
  sendTyping(chatId, false);
}

export function sendPhoto(chatId: number, asset: { uri: string; width: number; height: number }, caption?: string) {
  // the size travels with the pending copy so the bubble has its shape before the upload finishes
  const media: Media = { id: '', kind: 'photo', mime: 'image/jpeg', bytes: 0, width: asset.width, height: asset.height, durationMs: null };
  void deliver(addPending(chatId, { kind: 'photo', body: caption?.trim() || null, localUri: asset.uri, media }));
}

export function sendVoice(chatId: number, uri: string, durationMs: number) {
  void deliver(addPending(chatId, { kind: 'voice', localUri: uri, localDurationMs: durationMs }));
}

export function retry(m: LocalMessage) {
  updateLocal(m, { failed: false });
  void deliver({ ...m, failed: false });
}

export function discard(m: LocalMessage) {
  const t = state.threads[m.chatId];
  if (!t) return;
  set((s) => ({ threads: { ...s.threads, [m.chatId]: { ...t, items: t.items.filter((x) => !(x.id === 0 && x.clientId === m.clientId)) } } }));
}

// ---------- chat and family changes (plain HTTPS calls; the socket brings the result to everyone) ----------
function keepChat(c: Chat) {
  set((s) => ({ chats: { ...s.chats, [c.id]: c } }));
  return c;
}

export const openDirect = async (memberId: number) => keepChat((await api<{ chat: Chat }>('POST', '/chats/direct', { memberId })).chat);
export const createGroup = async (title: string, memberIds: number[]) => keepChat((await api<{ chat: Chat }>('POST', '/chats/group', { title, memberIds })).chat);
export const renameGroup = async (chatId: number, title: string) => keepChat((await api<{ chat: Chat }>('PATCH', `/chats/${chatId}`, { title })).chat);
export const addToGroup = async (chatId: number, memberId: number) => keepChat((await api<{ chat: Chat }>('POST', `/chats/${chatId}/members`, { memberId })).chat);
export async function removeFromGroup(chatId: number, memberId: number) {
  const out = await api<{ chat: Chat | null }>('DELETE', `/chats/${chatId}/members/${memberId}`);
  if (out.chat) keepChat(out.chat);
  else set((s) => { const chats = { ...s.chats }; delete chats[chatId]; return { chats }; });
}
export async function renameMe(name: string) {
  const out = await api<{ member: Member }>('PATCH', '/me', { name });
  set({ me: out.member });
}
