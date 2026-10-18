// CallKit and PushKit for Karaki (the Swift side is in ios/). On a build without the native
// module (Expo Go, a web preview) every function quietly does nothing, so the rest of the app
// still runs; calls then simply cannot ring like a phone call.
import { requireOptionalNativeModule } from 'expo';

export type CallInfo = {
  callId: string;
  chatId?: number;
  kind?: 'voice' | 'video';
  title?: string;
  group?: boolean;
  fromId?: number;
  fromName?: string;
  ringUntil?: number;
};

type Events = {
  voipToken: (e: { token: string }) => void;
  incoming: (e: CallInfo) => void;
  incomingFailed: (e: { callId: string; reason: string }) => void;
  startFailed: (e: { callId: string; reason: string }) => void;
  answer: (e: CallInfo) => void;
  end: (e: { callId: string; reason: 'local' | 'late' }) => void;
  mute: (e: { callId: string; muted: boolean }) => void;
  audioActivated: (e: Record<string, never>) => void;
  audioError: (e: { reason: string }) => void;
  reset: (e: Record<string, never>) => void;
};

type Native = {
  ready(): string | null;
  voipToken(): string | null;
  reportIncoming(callId: string, title: string, video: boolean, info: Record<string, unknown>): void;
  startOutgoing(callId: string, title: string, video: boolean): void;
  answer(callId: string): void;
  reportConnected(callId: string): void;
  endCall(callId: string): void;
  reportEnded(callId: string, reason: 'remote' | 'unanswered' | 'answeredElsewhere' | 'declinedElsewhere' | 'failed'): void;
  setMuted(callId: string, muted: boolean): void;
  setVideo(callId: string, video: boolean): void;
  setSpeaker(on: boolean): void;
  addListener<K extends keyof Events>(event: K, listener: Events[K]): { remove(): void };
};

const native = requireOptionalNativeModule<Native>('KarakiCalls');

export const callKitAvailable = !!native;

export const KarakiCalls = {
  ready: () => native?.ready() ?? null,
  voipToken: () => native?.voipToken() ?? null,
  reportIncoming: (callId: string, title: string, video: boolean, info: Record<string, unknown>) => native?.reportIncoming(callId, title, video, info),
  startOutgoing: (callId: string, title: string, video: boolean) => native?.startOutgoing(callId, title, video),
  answer: (callId: string) => native?.answer(callId),
  reportConnected: (callId: string) => native?.reportConnected(callId),
  endCall: (callId: string) => native?.endCall(callId),
  reportEnded: (callId: string, reason: Parameters<Native['reportEnded']>[1]) => native?.reportEnded(callId, reason),
  setMuted: (callId: string, muted: boolean) => native?.setMuted(callId, muted),
  setVideo: (callId: string, video: boolean) => native?.setVideo(callId, video),
  setSpeaker: (on: boolean) => native?.setSpeaker(on),
  on<K extends keyof Events>(event: K, listener: Events[K]) {
    return native ? native.addListener(event, listener) : { remove() {} };
  },
};
