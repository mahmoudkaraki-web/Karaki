// One message: ink for mine, paper for theirs; photo, voice note or text; time and ticks inside.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { authHeaders, mediaUrl } from '../api';
import type { LocalMessage } from '../store';
import { radius, space, type, useTheme } from '../theme';
import { Icon, Ticks, clock, type TickState } from '../ui';

type Props = {
  m: LocalMessage;
  mine: boolean;
  senderName?: string;   // groups: shown on the first bubble of a run
  senderColor?: string;
  lastInRun: boolean;
  tick: TickState;
  onPhoto: (m: LocalMessage) => void;
  onFailedPress: (m: LocalMessage) => void;
};

export function Bubble({ m, mine, senderName, senderColor, lastInRun, tick, onPhoto, onFailedPress }: Props) {
  const { c } = useTheme();
  const fg = mine ? c.walnutText : c.ink;
  const meta = mine ? c.walnutMeta : c.inkFaint;
  const corner = lastInRun ? radius.tail : radius.bubble;
  const shape = {
    borderRadius: radius.bubble,
    borderBottomRightRadius: mine ? corner : radius.bubble,
    borderBottomLeftRadius: mine ? radius.bubble : corner,
  };
  const isPhoto = m.kind === 'photo';
  const metaRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 2 }}>
      <Text style={{ color: isPhoto && !m.body ? '#FBF5EC' : meta, fontSize: 11, fontVariant: ['tabular-nums'] }}>{clock(m.createdAt)}</Text>
      {mine ? <Ticks state={m.failed ? 'failed' : tick} color={isPhoto && !m.body ? '#FBF5EC' : meta} readColor={mine ? '#E9A27C' : c.terracotta} failColor={c.danger} /> : null}
    </View>
  );

  return (
    <Pressable
      disabled={!m.failed}
      onPress={() => onFailedPress(m)}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}
    >
      {senderName ? (
        <Text style={{ color: senderColor, fontSize: type.caption, fontWeight: '600', marginLeft: space.md, marginBottom: 3 }}>{senderName}</Text>
      ) : null}
      <View
        style={[
          shape,
          {
            backgroundColor: mine ? c.walnut : c.paper,
            borderWidth: mine ? 0 : 1, borderColor: c.hairlineSoft,
            padding: isPhoto ? 3 : 0, overflow: 'hidden',
          },
        ]}
      >
        {isPhoto ? <Photo m={m} onPress={() => onPhoto(m)} cornerShape={shape} /> : null}
        {m.kind === 'voice' ? <Voice m={m} mine={mine} /> : null}
        {m.kind === 'text' || (isPhoto && m.body) ? (
          <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 6 }}>
            <Text style={{ color: fg, fontSize: type.body, lineHeight: 21 }} selectable>{m.body}</Text>
            {metaRow}
          </View>
        ) : (
          <View style={isPhoto ? { position: 'absolute', right: 10, bottom: 8, backgroundColor: 'rgba(20,16,12,0.45)', borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 1 } : { paddingHorizontal: space.md, paddingBottom: 6 }}>
            {metaRow}
          </View>
        )}
      </View>
      {m.failed ? <Text style={{ color: c.danger, fontSize: type.caption, marginTop: 3, alignSelf: 'flex-end' }}>Not sent. Tap to try again</Text> : null}
    </Pressable>
  );
}

function Photo({ m, onPress, cornerShape }: { m: LocalMessage; onPress: () => void; cornerShape: object }) {
  const { c } = useTheme();
  const w = m.media?.width || 4;
  const h = m.media?.height || 3;
  const ratio = Math.min(Math.max(w / h, 0.6), 1.8);
  const width = 236;
  const source = m.localUri ? { uri: m.localUri } : m.media?.id ? { uri: mediaUrl(m.media.id), headers: authHeaders() } : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel="Photo, tap to open">
      <Image
        source={source}
        style={[cornerShape, { width, height: Math.round(width / ratio), backgroundColor: c.inset, borderRadius: radius.bubble - 3 }]}
        contentFit="cover"
        cachePolicy="disk"
        transition={120}
      />
    </Pressable>
  );
}

// ---------- voice notes ----------
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// a fixed little wave drawn from the message id, so every note looks a bit different and never jumps
function bars(seed: string, n = 28) {
  let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => { x = (x * 1103515245 + 12345) >>> 0; return 0.25 + ((x >>> 16) % 1000) / 1333; });
}

function Voice({ m, mine }: { m: LocalMessage; mine: boolean }) {
  const [active, setActive] = useState(false);
  const duration = m.media?.durationMs || m.localDurationMs || 0;
  const source = m.localUri ? { uri: m.localUri } : m.media?.id ? { uri: mediaUrl(m.media.id), headers: authHeaders() } : null;
  if (active && source) return <VoicePlaying source={source} mine={mine} seed={m.clientId || String(m.id)} duration={duration} />;
  return <VoiceFace mine={mine} seed={m.clientId || String(m.id)} duration={duration} progress={0} playing={false} onPress={() => setActive(true)} disabled={!source} />;
}

function VoicePlaying({ source, mine, seed, duration }: { source: { uri: string; headers?: Record<string, string> }; mine: boolean; seed: string; duration: number }) {
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const started = useRef(false);
  useEffect(() => {
    if (status.isLoaded && !started.current) { started.current = true; player.play(); }
  }, [status.isLoaded, player]);
  const total = (status.duration || duration / 1000) * 1000;
  const progress = total ? (status.currentTime * 1000) / total : 0;
  const ended = status.didJustFinish;
  return (
    <VoiceFace
      mine={mine} seed={seed} duration={status.playing ? status.currentTime * 1000 : total}
      progress={ended ? 0 : progress} playing={status.playing}
      onPress={() => {
        if (status.playing) player.pause();
        else { if (ended || progress >= 0.99) player.seekTo(0); player.play(); }
      }}
    />
  );
}

function VoiceFace({ mine, seed, duration, progress, playing, onPress, disabled }: { mine: boolean; seed: string; duration: number; progress: number; playing: boolean; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  const wave = useMemo(() => bars(seed), [seed]);
  const fg = mine ? c.walnutText : c.ink;
  const faint = mine ? 'rgba(245,238,227,0.35)' : c.inkGhost;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.sm, paddingRight: space.md, paddingTop: space.sm, width: 236 }}>
      <View style={{ width: 32, height: 32, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? 'rgba(245,238,227,0.12)' : c.inset }}>
        <Icon name={playing ? 'pause.fill' : 'play.fill'} size={14} color={fg} />
      </View>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 24, gap: 2 }}>
        {wave.map((v, i) => (
          <View key={i} style={{ flex: 1, height: Math.round(v * 22), borderRadius: 1, backgroundColor: i / wave.length <= progress && progress > 0 ? (mine ? '#E9A27C' : c.terracotta) : faint }} />
        ))}
      </View>
      <Text style={{ color: mine ? c.walnutMeta : c.inkFaint, fontSize: type.caption, fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'right' }}>{fmt(duration)}</Text>
    </Pressable>
  );
}
