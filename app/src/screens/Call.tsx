// The call screen: always on the night table (dark, warm), whatever the phone's theme.
// Video: the others fill the screen (split when there are two or three), you in a small tile.
// Voice: the others' seals. Controls: squared buttons, never round pills.
import React, { useEffect, useState } from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { answerHere, flipCamera, hangup, toggleCamera, toggleMute, toggleSpeaker, useCall, type PeerView } from '../calls';
import { useFamily } from '../store';
import { serif, space, type } from '../theme';
import { Icon, Seal, firstName } from '../ui';
import type { SFSymbol } from 'expo-symbols';
import type { ScreenProps } from '../nav';

const night = {
  bg: '#15130F', tile: '#1F1C17', ink: '#F2EADF', soft: '#BDB2A4', faint: '#8C8275',
  button: 'rgba(255,240,220,0.10)', buttonOn: '#F2EADF', danger: '#C2493A', answer: '#3F8F5C', terracotta: '#D27A4E',
};

function clockOf(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function Call({ navigation }: ScreenProps<'Call'>) {
  const call = useCall();
  const insets = useSafeAreaInsets();
  const members = useFamily((s) => s.members);
  const me = useFamily((s) => s.me);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!call && navigation.canGoBack()) navigation.goBack();
  }, [call, navigation]);

  if (!call) return <View style={{ flex: 1, backgroundColor: night.bg }} />;

  const who = (id: number) => members.find((m) => m.id === id) || { id, name: 'Family', color: '#8C5A3C', isAdmin: false };
  const peers = Object.values(call.peers);
  const video = call.kind === 'video';
  const incoming = call.direction === 'in' && call.phase === 'ringing';

  const status = call.phase === 'ended' ? call.endedWords || 'Call ended'
    : incoming ? `Incoming ${video ? 'video' : 'voice'} call`
    : call.phase === 'ringing' ? 'Ringing...'
    : call.phase === 'connecting' ? 'Connecting...'
    : call.startedAt ? clockOf(Date.now() - call.startedAt) : '';

  // the people shown: those connected, or while ringing those being rung
  const faces: { id: number; peer?: PeerView }[] = peers.length
    ? peers.map((p) => ({ id: p.memberId, peer: p }))
    : (call.ringing.length ? call.ringing : []).map((id) => ({ id }));

  const showVideoTiles = video && peers.some((p) => p.stream && p.video);

  return (
    <View style={{ flex: 1, backgroundColor: night.bg }}>
      <StatusBar barStyle="light-content" />

      {showVideoTiles ? (
        <View style={{ ...StyleSheetFill, flexDirection: 'column' }}>
          {peers.map((p) => (
            <View key={p.memberId} style={{ flex: 1, backgroundColor: night.tile, borderBottomWidth: peers.length > 1 ? 1 : 0, borderColor: night.bg }}>
              {p.stream && p.video ? (
                <RTCView streamURL={p.stream.toURL()} objectFit="cover" style={{ flex: 1 }} zOrder={0} />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
                  <Seal member={who(p.memberId)} size={72} />
                  <Text style={{ color: night.soft, fontSize: type.caption }}>Camera off</Text>
                </View>
              )}
              {peers.length > 1 ? (
                <Text style={{ position: 'absolute', left: space.md, bottom: space.sm, color: night.ink, fontSize: type.caption, fontWeight: '600' }}>
                  {firstName(who(p.memberId).name)}{p.audio ? '' : ', muted'}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* title and status */}
      <View style={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, alignItems: 'center', gap: 4 }}>
        <Text numberOfLines={1} style={{ fontFamily: serif.semibold, fontSize: type.heading, color: night.ink, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: showVideoTiles ? 6 : 0 }}>
          {call.title}
        </Text>
        <Text style={{ color: night.soft, fontSize: type.secondary, fontVariant: ['tabular-nums'] }}>{status}</Text>
      </View>

      {!showVideoTiles ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, paddingHorizontal: space.xl }}>
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
      ) : <View style={{ flex: 1 }} />}

      {/* me, small, top right */}
      {video && call.local && call.cameraOn && call.phase !== 'ended' ? (
        <View style={{ position: 'absolute', top: insets.top + 96, right: space.lg, width: 100, height: 142, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,240,220,0.18)' }}>
          <RTCView streamURL={call.local.toURL()} objectFit="cover" mirror={call.front} style={{ flex: 1 }} zOrder={1} />
        </View>
      ) : null}

      {/* controls */}
      <View style={{ paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.xl, gap: space.lg }}>
        {incoming ? (
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <WideButton label="Decline" color={night.danger} icon="phone.down.fill" onPress={hangup} />
            <WideButton label="Answer" color={night.answer} icon={video ? 'video.fill' : 'phone.fill'} onPress={answerHere} />
          </View>
        ) : call.phase !== 'ended' ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.md }}>
              <Control label={call.muted ? 'Unmute' : 'Mute'} icon={call.muted ? 'mic.slash.fill' : 'mic.fill'} on={call.muted} onPress={toggleMute} />
              <Control label="Speaker" icon={call.speaker ? 'speaker.wave.3.fill' : 'speaker.fill'} on={call.speaker} onPress={toggleSpeaker} />
              {video ? <Control label={call.cameraOn ? 'Camera' : 'Camera off'} icon={call.cameraOn ? 'video.fill' : 'video.slash.fill'} on={!call.cameraOn} onPress={toggleCamera} /> : null}
              {video ? <Control label="Flip" icon="arrow.triangle.2.circlepath.camera" onPress={() => void flipCamera()} disabled={!call.cameraOn} /> : null}
            </View>
            <WideButton label="End" color={night.danger} icon="phone.down.fill" onPress={hangup} />
          </>
        ) : null}
        {me && call.group && call.phase === 'active' ? (
          <Text style={{ color: night.faint, fontSize: type.caption, textAlign: 'center' }}>Others in the group can join from the chat.</Text>
        ) : null}
      </View>
    </View>
  );
}

const StyleSheetFill = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

function Control({ label, icon, on, onPress, disabled }: { label: string; icon: SFSymbol; on?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }}
      style={({ pressed }) => ({ alignItems: 'center', gap: 6, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      <View style={{ width: 60, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? night.buttonOn : night.button }}>
        <Icon name={icon} size={22} color={on ? night.bg : night.ink} />
      </View>
      <Text style={{ color: night.soft, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}

function WideButton({ label, color, icon, onPress }: { label: string; color: string; icon: SFSymbol; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: 10, backgroundColor: color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, opacity: pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={18} color="#FBF5EC" weight="semibold" />
      <Text style={{ color: '#FBF5EC', fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
