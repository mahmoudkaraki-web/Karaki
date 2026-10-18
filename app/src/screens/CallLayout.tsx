// What the call screen looks like, with no call logic in it (Call.tsx feeds it), so the layout
// can be checked on its own at every iPhone size. Always the night table, whatever the theme.
//
// From top to bottom: the title and status; the people (video tiles, or seals in a voice call);
// the control tiles in their own row; the End bar under them. The End bar stays at least 16 px
// clear of the tiles and of the home indicator (the bottom safe area).
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import type { SFSymbol } from 'expo-symbols';
import type { CallView } from '../calls';
import type { Member } from '../api';
import { serif, space, type } from '../theme';
import { Icon, Seal, firstName } from '../ui';

export const night = {
  bg: '#15130F', tile: '#1F1C17', ink: '#F2EADF', soft: '#BDB2A4', faint: '#8C8275',
  button: 'rgba(255,240,220,0.10)', buttonOn: '#F2EADF', danger: '#C2493A', answer: '#3F8F5C',
};

const GAP_ABOVE_END = 20;   // tiles to End bar (at least 16)
const GAP_BELOW_END = 16;   // End bar to the home indicator

export type CallActions = {
  hangup: () => void;
  answer: () => void;
  mute: () => void;
  speaker: () => void;
  camera: () => void;
  flip: () => void;
};

function clockOf(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function CallLayout({ call, who, insets, actions, now = Date.now() }: {
  call: CallView;
  who: (id: number) => Pick<Member, 'id' | 'name' | 'color'>;
  insets: { top: number; bottom: number };
  actions: CallActions;
  now?: number;
}) {
  const peers = Object.values(call.peers);
  const incoming = call.direction === 'in' && call.phase === 'ringing';
  const ended = call.phase === 'ended';
  const peerVideo = peers.some((p) => p.video && p.stream);
  const videoLayout = !ended && (peerVideo || call.cameraOn);

  const status = ended ? call.endedWords || 'Call ended'
    : incoming ? `Incoming ${call.kind === 'video' ? 'video' : 'voice'} call`
    : call.phase === 'ringing' ? 'Ringing...'
    : call.phase === 'connecting' ? 'Connecting...'
    : call.startedAt ? clockOf(now - call.startedAt) : '';

  // who is shown: the people connected, or while ringing the people being rung
  const faces = peers.length ? peers.map((p) => ({ id: p.memberId, peer: p })) : call.ringing.map((id) => ({ id, peer: undefined }));
  const bottomPad = insets.bottom > 0 ? insets.bottom + GAP_BELOW_END : 24;

  const shadow = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: videoLayout ? 6 : 0 };

  return (
    <View style={{ flex: 1, backgroundColor: night.bg }}>
      {/* the stage: everything above the controls, so nothing in it can ever sit under them */}
      <View style={{ flex: 1 }}>
        {videoLayout ? (
          <View style={{ flex: 1 }}>
            {faces.map(({ id, peer }, i) => (
              <View key={id} style={{ flex: 1, backgroundColor: night.tile, borderTopWidth: i ? 1 : 0, borderColor: night.bg }}>
                {peer?.stream && peer.video ? (
                  <RTCView streamURL={peer.stream.toURL()} objectFit="cover" style={{ flex: 1 }} zOrder={0} />
                ) : (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingTop: i === 0 ? insets.top + 56 : 0 }}>
                    <Seal member={who(id)} size={faces.length > 1 ? 48 : 72} />
                    <Text style={{ color: night.soft, fontSize: type.caption }}>{peer ? 'Camera off' : 'Ringing...'}</Text>
                  </View>
                )}
                {faces.length > 1 ? (
                  <Text style={{ position: 'absolute', left: space.md, bottom: space.sm, color: night.ink, fontSize: type.caption, fontWeight: '600', ...shadow }}>
                    {firstName(who(id).name)}{peer && !peer.audio ? ', muted' : ''}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, paddingHorizontal: space.xl, paddingTop: insets.top + 72 }}>
            {faces.map(({ id, peer }) => (
              <View key={id} style={{ alignItems: 'center', gap: space.sm, width: faces.length > 1 ? 100 : 160 }}>
                <Seal member={who(id)} size={72} />
                <Text style={{ color: night.ink, fontSize: type.body, fontWeight: '600' }}>{firstName(who(id).name)}</Text>
                <Text style={{ color: night.faint, fontSize: type.caption }}>
                  {peer ? (peer.connection === 'connected' ? (peer.audio ? 'On the call' : 'Muted') : 'Connecting...') : 'Ringing...'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* title and status, laid over the top of the stage */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, alignItems: 'center', gap: 4 }}>
          <Text numberOfLines={1} style={{ fontFamily: serif.semibold, fontSize: type.heading, color: night.ink, ...shadow }}>{call.title}</Text>
          <Text style={{ color: night.soft, fontSize: type.secondary, fontVariant: ['tabular-nums'], ...shadow }}>{status}</Text>
        </View>

        {/* me, small, top right, while my camera is on */}
        {call.cameraOn && call.local && !ended ? (
          <View style={{ position: 'absolute', top: insets.top + 84, right: space.lg, width: 100, height: 142, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,240,220,0.18)', backgroundColor: night.tile }}>
            <RTCView streamURL={call.local.toURL()} objectFit="cover" mirror={call.front} style={{ flex: 1 }} zOrder={1} />
          </View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: bottomPad }}>
        {incoming ? (
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Bar label="Decline" color={night.danger} icon="phone.down.fill" onPress={actions.hangup} grow />
            <Bar label="Answer" color={night.answer} icon={call.kind === 'video' ? 'video.fill' : 'phone.fill'} onPress={actions.answer} grow />
          </View>
        ) : !ended ? (
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.md }}>
              <Tile label={call.muted ? 'Unmute' : 'Mute'} icon={call.muted ? 'mic.slash.fill' : 'mic.fill'} on={call.muted} onPress={actions.mute} />
              <Tile label="Speaker" icon={call.speaker ? 'speaker.wave.3.fill' : 'speaker.fill'} on={call.speaker} onPress={actions.speaker} />
              <Tile label={call.cameraOn ? 'Camera on' : 'Camera'} icon={call.cameraOn ? 'video.fill' : 'video.slash.fill'} on={call.cameraOn} onPress={actions.camera} />
              {call.cameraOn ? <Tile label="Flip" icon="arrow.triangle.2.circlepath.camera" onPress={actions.flip} /> : null}
            </View>
            <View style={{ height: GAP_ABOVE_END }} />
            <Bar label="End" color={night.danger} icon="phone.down.fill" onPress={actions.hangup} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// a control: a squared tile with its label under it, never a round pill
function Tile({ label, icon, on, onPress }: { label: string; icon: SFSymbol; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }}
      style={({ pressed }) => ({ width: 64, alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 60, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? night.buttonOn : night.button }}>
        <Icon name={icon} size={22} color={on ? night.bg : night.ink} />
      </View>
      <Text numberOfLines={1} style={{ color: night.soft, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}

// End, Answer, Decline: a slim full width bar (grow: shares a row with another bar)
function Bar({ label, color, icon, onPress, grow }: { label: string; color: string; icon: SFSymbol; onPress: () => void; grow?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ ...(grow ? { flex: 1 } : { alignSelf: 'stretch' as const }), height: 48, borderRadius: 10, backgroundColor: color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, opacity: pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={18} color="#FBF5EC" weight="semibold" />
      <Text style={{ color: '#FBF5EC', fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
