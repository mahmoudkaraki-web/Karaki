// Calls on the phone: one to one and group (a mesh: one WebRTC connection to each other person
// on the call), voice or video, ringing through CallKit.
//
// Every call goes through CallKit, outgoing ones too: WebRTC runs on manual audio and may only
// use the microphone and speaker once CallKit has activated the audio session.
//
// Mesh rule, the same as the server's tests: whoever joins sends an offer to everyone already
// on the call, so two phones never offer to each other at the same time.
import { useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import * as Crypto from 'expo-crypto';
import { mediaDevices, MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { KarakiCalls, callKitAvailable, type CallInfo } from '../modules/karaki-calls';
import { api, type CallRecord } from './api';
import { getState, liveRequest, liveSend, onCallEvent, setKeepLive } from './store';
import { navRef } from './nav';
import { chatTitle } from './ui';

export type PeerView = { memberId: number; stream: MediaStream | null; connection: string; audio: boolean; video: boolean };
export type CallView = {
  id: string;
  chatId: number;
  kind: 'voice' | 'video';
  title: string;
  group: boolean;
  direction: 'out' | 'in';
  phase: 'ringing' | 'connecting' | 'active' | 'ended';
  startedAt: number | null;
  peers: Record<number, PeerView>;
  ringing: number[];        // people still being rung
  local: MediaStream | null;
  muted: boolean;
  speaker: boolean;
  cameraOn: boolean;
  front: boolean;
  endedWords?: string;
};

// ---------- the view screens read ----------
let view: CallView | null = null;
const listeners = new Set<() => void>();
function setView(next: CallView | null) {
  view = next;
  for (const l of listeners) l();
}
function patch(p: Partial<CallView>) {
  if (view) setView({ ...view, ...p });
}
function patchPeer(memberId: number, p: Partial<PeerView>) {
  if (!view) return;
  const old = view.peers[memberId] || { memberId, stream: null, connection: 'new', audio: true, video: view.kind === 'video' };
  setView({ ...view, peers: { ...view.peers, [memberId]: { ...old, ...p } } });
}
export function useCall() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => view);
}
export const currentCall = () => view;

// ---------- inside ----------
const pcs = new Map<number, RTCPeerConnection>();
const pendingIce = new Map<number, any[]>();
const ringingIn = new Map<string, CallInfo>(); // rung on this phone, not answered yet
let iceServers: any[] = [];
let localStream: MediaStream | null = null;

const ENDED_WORDS: Record<string, string> = {
  ended: 'Call ended', cancelled: 'Call ended', declined: 'Declined', busy: 'Busy', missed: 'No answer',
};

function showCallScreen() {
  if (navRef.isReady() && navRef.getCurrentRoute()?.name !== 'Call') navRef.navigate('Call');
}

async function getMedia(kind: 'voice' | 'video') {
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video' ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 } : false,
    });
    localStream = stream as MediaStream;
    patch({ local: localStream });
    return localStream;
  } catch {
    Alert.alert('Karaki needs the microphone' + (kind === 'video' ? ' and camera' : ''), 'Allow them for Karaki in Settings, then try the call again.');
    throw new Error('no_media');
  }
}

function makePc(peerId: number) {
  const callId = view!.id;
  const pc = new RTCPeerConnection({ iceServers });
  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream!));
  pc.addEventListener('icecandidate', (e: any) => {
    if (e.candidate) liveSend({ type: 'call.ice', callId, to: peerId, candidate: typeof e.candidate.toJSON === 'function' ? e.candidate.toJSON() : e.candidate });
  });
  pc.addEventListener('track', (e: any) => {
    const stream = e.streams?.[0];
    if (stream) patchPeer(peerId, { stream });
  });
  pc.addEventListener('connectionstatechange', () => {
    const st = pc.connectionState;
    patchPeer(peerId, { connection: st });
    if (st === 'connected' && view && view.phase !== 'active') {
      patch({ phase: 'active', startedAt: view.startedAt || Date.now() });
      if (view.direction === 'out') KarakiCalls.reportConnected(view.id);
    }
  });
  pcs.set(peerId, pc);
  patchPeer(peerId, { connection: 'connecting' });
  return pc;
}

async function offerTo(peerId: number) {
  const pc = pcs.get(peerId) || makePc(peerId);
  const offer = await pc.createOffer({});
  await pc.setLocalDescription(offer);
  liveSend({ type: 'call.offer', callId: view!.id, to: peerId, sdp: offer.sdp });
}

async function flushIce(peerId: number) {
  const pc = pcs.get(peerId);
  if (!pc) return;
  for (const c of pendingIce.get(peerId) || []) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
  pendingIce.delete(peerId);
}

function dropPeer(memberId: number) {
  pcs.get(memberId)?.close();
  pcs.delete(memberId);
  pendingIce.delete(memberId);
  if (view) {
    const peers = { ...view.peers };
    delete peers[memberId];
    setView({ ...view, peers });
  }
}

// closes everything on this phone; the screen shows the words for a moment, then goes away
function finish(words: string) {
  for (const pc of pcs.values()) pc.close();
  pcs.clear();
  pendingIce.clear();
  localStream?.getTracks().forEach((t) => t.stop());
  localStream?.release?.();
  localStream = null;
  if (ringingIn.size === 0) setKeepLive(false);
  if (!view) return;
  const id = view.id;
  setView({ ...view, phase: 'ended', endedWords: words, local: null, peers: {} });
  setTimeout(() => { if (view?.id === id) setView(null); }, 1400);
}

// ---------- starting, answering, joining ----------
export async function startCall(chatId: number, kind: 'voice' | 'video') {
  if (view && view.phase !== 'ended') return Alert.alert('You are already on a call');
  const chat = getState().chats[chatId];
  const me = getState().me;
  if (!chat || !me) return;
  if (chat.activeCall) return joinCall(chat.activeCall.id);
  const callId = Crypto.randomUUID();
  const title = chatTitle(chat, me.id);
  setView({
    id: callId, chatId, kind, title, group: chat.kind === 'group', direction: 'out', phase: 'ringing', startedAt: null,
    peers: {}, ringing: chat.members.filter((m) => m.id !== me.id).map((m) => m.id), local: null,
    muted: false, speaker: kind === 'video', cameraOn: kind === 'video', front: true,
  });
  setKeepLive(true);
  showCallScreen();
  KarakiCalls.startOutgoing(callId, title, kind === 'video');
  try {
    await getMedia(kind);
    const res = await liveRequest<{ call: CallRecord; iceServers: any[] }>({ type: 'call.start', chatId, kind, callId });
    iceServers = res.iceServers || [];
    if (res.call.endedAt) {
      KarakiCalls.reportEnded(callId, 'remote');
      return finish(ENDED_WORDS[res.call.endReason || 'ended'] || 'Call ended');
    }
    patch({ ringing: res.call.members.filter((m) => m.state === 'ringing').map((m) => m.id) });
  } catch (e: any) {
    KarakiCalls.endCall(callId);
    if (e?.code === 'call_in_progress' && e.call) { finish(''); setView(null); return joinCall(e.call.id); }
    finish(e?.message === 'no_media' ? 'Call ended' : 'The call could not start');
  }
}

// joining a group call that is already going on (the chat's "Join" button)
export async function joinCall(callId: string) {
  if (view && view.phase !== 'ended') return Alert.alert('You are already on a call');
  const chat = Object.values(getState().chats).find((c) => c.activeCall?.id === callId);
  const me = getState().me;
  if (!chat || !me || !chat.activeCall) return;
  const kind = chat.activeCall.kind;
  const title = chatTitle(chat, me.id);
  setView({
    id: callId, chatId: chat.id, kind, title, group: chat.kind === 'group', direction: 'out', phase: 'connecting', startedAt: null,
    peers: {}, ringing: [], local: null, muted: false, speaker: kind === 'video', cameraOn: kind === 'video', front: true,
  });
  setKeepLive(true);
  showCallScreen();
  KarakiCalls.startOutgoing(callId, title, kind === 'video'); // through CallKit, for the audio session
  await connectAsJoiner(callId, kind);
}

async function connectAsJoiner(callId: string, kind: 'voice' | 'video') {
  try {
    await getMedia(kind);
    const res = await liveRequest<{ call: CallRecord; peers: number[]; iceServers: any[] }>({ type: 'call.accept', callId });
    iceServers = res.iceServers || [];
    patch({ ringing: res.call.members.filter((m) => m.state === 'ringing').map((m) => m.id) });
    for (const peer of res.peers) await offerTo(peer);
  } catch (e: any) {
    KarakiCalls.endCall(callId);
    const words = e?.code === 'answered_on_another_phone' ? 'Answered on another phone' : e?.code === 'call_ended' ? 'Call ended' : 'Could not join the call';
    finish(words);
  }
}

// CallKit's answer (lock screen, banner, or the app's own Answer button)
async function onAnswer(info: CallInfo) {
  const known = ringingIn.get(info.callId) || info;
  ringingIn.delete(info.callId);
  const kind = known.kind === 'video' ? 'video' : 'voice';
  setView({
    id: info.callId, chatId: Number(known.chatId), kind, title: known.title || 'Karaki', group: !!known.group, direction: 'in',
    phase: 'connecting', startedAt: null, peers: {}, ringing: [], local: null,
    muted: false, speaker: kind === 'video', cameraOn: kind === 'video', front: true,
  });
  setKeepLive(true);
  showCallScreen();
  await connectAsJoiner(info.callId, kind);
}

// a ring reported to CallKit (by a VoIP push, or by the live socket below)
function onIncoming(info: CallInfo) {
  if (view && view.phase !== 'ended' && view.id !== info.callId) {
    // already on a Karaki call: say busy and take the ring away
    liveSend({ type: 'call.busy', callId: info.callId });
    KarakiCalls.reportEnded(info.callId, 'remote');
    return;
  }
  ringingIn.set(info.callId, info);
  setKeepLive(true); // hear call.ended or call.taken while it rings
  const wait = Math.max(5000, (Number(info.ringUntil) || Date.now() + 45000) - Date.now() + 3000);
  setTimeout(() => {
    if (ringingIn.has(info.callId)) {
      ringingIn.delete(info.callId);
      KarakiCalls.reportEnded(info.callId, 'unanswered');
      if (!view) setKeepLive(false);
    }
  }, wait);
  if (!callKitAvailable) {
    // no CallKit (Expo Go): the app's own call screen rings instead
    setView({
      id: info.callId, chatId: Number(info.chatId), kind: info.kind === 'video' ? 'video' : 'voice', title: info.title || 'Karaki',
      group: !!info.group, direction: 'in', phase: 'ringing', startedAt: null, peers: {}, ringing: [], local: null,
      muted: false, speaker: info.kind === 'video', cameraOn: info.kind === 'video', front: true,
    });
    showCallScreen();
  }
}

// CallKit ended a call: the person tapped the red button (lock screen, CallKit, or the app)
function onNativeEnd(callId: string) {
  if (ringingIn.has(callId)) {
    ringingIn.delete(callId);
    liveSend({ type: 'call.decline', callId });
    if (!view) setKeepLive(false);
    return;
  }
  if (view && view.id === callId && view.phase !== 'ended') {
    liveSend({ type: 'call.hangup', callId });
    finish('Call ended');
  }
}

// ---------- buttons on the call screen ----------
export function hangup() {
  if (!view || view.phase === 'ended') return;
  const id = view.id;
  if (view.direction === 'in' && view.phase === 'ringing') liveSend({ type: 'call.decline', callId: id });
  else liveSend({ type: 'call.hangup', callId: id });
  ringingIn.delete(id);
  KarakiCalls.endCall(id);
  finish('Call ended');
}

export function answerHere() {
  if (!view) return;
  if (callKitAvailable) KarakiCalls.answer(view.id);
  else void onAnswer({ callId: view.id, chatId: view.chatId, kind: view.kind, title: view.title, group: view.group });
}

function applyMute(muted: boolean) {
  localStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  patch({ muted });
  if (view) liveSend({ type: 'call.media', callId: view.id, audio: !muted, video: view.cameraOn });
}

export function toggleMute() {
  if (!view) return;
  const muted = !view.muted;
  applyMute(muted);
  KarakiCalls.setMuted(view.id, muted);
}

export function toggleSpeaker() {
  if (!view) return;
  KarakiCalls.setSpeaker(!view.speaker);
  patch({ speaker: !view.speaker });
}

export function toggleCamera() {
  if (!view || view.kind !== 'video') return;
  const cameraOn = !view.cameraOn;
  localStream?.getVideoTracks().forEach((t) => { t.enabled = cameraOn; });
  patch({ cameraOn });
  liveSend({ type: 'call.media', callId: view.id, audio: !view.muted, video: cameraOn });
}

export async function flipCamera() {
  if (!view || view.kind !== 'video') return;
  const front = !view.front;
  const track: any = localStream?.getVideoTracks()[0];
  if (!track) return;
  try { await track.applyConstraints({ facingMode: front ? 'user' : 'environment' }); } catch { track._switchCamera?.(); }
  patch({ front });
}

// ---------- what the server says ----------
async function onServer(ev: any) {
  switch (ev.type) {
    case 'call.ring': {
      const id: string = ev.call.id;
      if (ringingIn.has(id) || view?.id === id) return;
      const info: CallInfo = {
        callId: id, chatId: ev.call.chatId, kind: ev.call.kind, title: ev.title, group: ev.group,
        fromId: ev.from?.id, fromName: ev.from?.name, ringUntil: ev.call.ringUntil,
      };
      if (callKitAvailable) KarakiCalls.reportIncoming(id, ev.title || 'Karaki', ev.call.kind === 'video', info as Record<string, unknown>);
      else onIncoming(info);
      return;
    }
    case 'call.connected':
      // the socket (re)connected, maybe after a VoIP push woke a closed app: a ring that already
      // ended while nobody was listening is taken off the screen now
      if (ringingIn.size) {
        api<{ call: CallRecord | null }>('GET', '/calls/current').then(({ call }) => {
          for (const id of [...ringingIn.keys()]) {
            if (!call || call.id !== id) {
              ringingIn.delete(id);
              KarakiCalls.reportEnded(id, 'unanswered');
            }
          }
          if (!ringingIn.size && !view) setKeepLive(false);
        }).catch(() => {});
      }
      return;
    case 'call.taken':
      // answered or declined on another of my phones
      if (ringingIn.has(ev.callId)) {
        ringingIn.delete(ev.callId);
        KarakiCalls.reportEnded(ev.callId, 'answeredElsewhere');
        if (!view) setKeepLive(false);
      }
      return;
    case 'call.ended':
      if (ringingIn.has(ev.callId)) {
        ringingIn.delete(ev.callId);
        KarakiCalls.reportEnded(ev.callId, 'unanswered');
        if (!view) setKeepLive(false);
      }
      if (view && view.id === ev.callId && view.phase !== 'ended') {
        KarakiCalls.reportEnded(ev.callId, ev.reason === 'ended' ? 'remote' : 'unanswered');
        finish(ENDED_WORDS[ev.reason] || 'Call ended');
      }
      return;
    case 'call.state':
      if (view && ev.call.id === view.id) {
        const ringing = (ev.call.members as CallRecord['members']).filter((m) => m.state === 'ringing').map((m) => m.id);
        const someoneIn = ev.call.members.some((m: any) => m.state === 'joined' && m.id !== getState().me?.id);
        patch({ ringing, phase: view.phase === 'ringing' && someoneIn ? 'connecting' : view.phase });
      }
      return;
    default:
      break;
  }
  if (!view || ev.callId !== view.id || view.phase === 'ended') return;
  try {
    if (ev.type === 'call.offer') {
      const pc = pcs.get(ev.from) || makePc(ev.from);
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: ev.sdp }));
      await flushIce(ev.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      liveSend({ type: 'call.answer', callId: view.id, to: ev.from, sdp: answer.sdp });
    } else if (ev.type === 'call.answer') {
      const pc = pcs.get(ev.from);
      if (pc) { await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: ev.sdp })); await flushIce(ev.from); }
    } else if (ev.type === 'call.ice') {
      const pc = pcs.get(ev.from);
      if (pc && pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(ev.candidate)).catch(() => {});
      else pendingIce.set(ev.from, [...(pendingIce.get(ev.from) || []), ev.candidate]);
    } else if (ev.type === 'call.left') {
      dropPeer(ev.memberId);
    } else if (ev.type === 'call.media') {
      patchPeer(ev.from, { audio: ev.audio, video: ev.video });
    }
  } catch { /* one bad message does not end the call */ }
}

// ---------- starting the engine (once signed in) ----------
let voipTokenSent: string | null = null;
function sendVoipToken(token: string | null) {
  if (!token || token === voipTokenSent) return;
  voipTokenSent = token;
  api('POST', '/me/push', { voipToken: token }).catch(() => { voipTokenSent = null; });
}

export function startCallEngine() {
  const subs = [
    KarakiCalls.on('voipToken', (e) => sendVoipToken(e.token || null)),
    KarakiCalls.on('incoming', onIncoming),
    KarakiCalls.on('answer', (e) => { void onAnswer(e); }),
    KarakiCalls.on('end', (e) => onNativeEnd(e.callId)),
    KarakiCalls.on('mute', (e) => { if (view && view.id === e.callId && view.muted !== e.muted) applyMute(e.muted); }),
    KarakiCalls.on('incomingFailed', (e) => { liveSend({ type: 'call.busy', callId: e.callId }); ringingIn.delete(e.callId); }),
    KarakiCalls.on('startFailed', (e) => { if (view?.id === e.callId) hangup(); }),
    KarakiCalls.on('reset', () => { if (view) hangup(); }),
  ];
  const offServer = onCallEvent((ev) => { void onServer(ev); });
  // listeners are in place: events queued while JavaScript was starting (a call answered from
  // the lock screen of a closed app) now arrive
  sendVoipToken(KarakiCalls.ready());
  return () => { subs.forEach((s) => s.remove()); offServer(); };
}
