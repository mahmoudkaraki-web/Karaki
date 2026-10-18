// Small shared pieces: the household seal, slim buttons, the drawn ticks, an icon wrapper,
// and the date and time words. Values come from theme.ts (see .interface-design/system.md).
import React from 'react';
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle, ActivityIndicator } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { radius, serif, space, type, useTheme } from './theme';
import type { Chat, Member } from './api';

// ---------- seal ----------
export function Seal({ member, size = 36, online = false, ring }: { member: Pick<Member, 'name' | 'color'>; size?: 24 | 36 | 48 | 72; online?: boolean; ring?: string }) {
  const { c } = useTheme();
  const r = size <= 36 ? (size <= 24 ? 6 : 8) : size === 48 ? 12 : 18;
  const initial = (member.name || '?').trim().charAt(0).toUpperCase();
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size, height: size, borderRadius: r, backgroundColor: member.color,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: ring ? 2 : 0, borderColor: ring,
        }}
      >
        <Text style={{ color: c.sealText, fontFamily: serif.semibold, fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.6), marginTop: size > 30 ? 1 : 0 }}>{initial}</Text>
      </View>
      {online ? (
        <View style={{
          position: 'absolute', right: -2, bottom: -2, width: size >= 48 ? 12 : 10, height: size >= 48 ? 12 : 10,
          borderRadius: 6, backgroundColor: c.porch, borderWidth: 2, borderColor: c.linen,
        }} />
      ) : null}
    </View>
  );
}

// a group's seals, stacked and overlapping (the chat list's group avatar)
export function SealStack({ members, meId }: { members: Member[]; meId?: number }) {
  const { c } = useTheme();
  const others = members.filter((m) => m.id !== meId).slice(0, 3);
  if (others.length <= 1) return others[0] ? <Seal member={others[0]} /> : <View style={{ width: 36, height: 36 }} />;
  return (
    <View style={{ width: 36, height: 36 }}>
      {others.slice(0, 2).map((m, i) => (
        <View key={m.id} style={{ position: 'absolute', left: i * 12, top: i * 12 }}>
          <Seal member={m} size={24} ring={c.linen} />
        </View>
      ))}
    </View>
  );
}

// ---------- icon ----------
export function Icon({ name, size = 20, color, weight = 'regular' }: { name: SFSymbol; size?: number; color: string; weight?: 'regular' | 'medium' | 'semibold' }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}

// ---------- buttons: slim, squared, never pill shaped ----------
type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string; kind?: 'primary' | 'quiet' | 'danger'; small?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; icon?: SFSymbol;
};

export function Button({ label, kind = 'primary', small, busy, style, disabled, icon, ...rest }: ButtonProps) {
  const { c } = useTheme();
  const fill = kind === 'primary' ? c.terracotta : 'transparent';
  const text = kind === 'primary' ? c.onTerracotta : kind === 'danger' ? c.danger : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      hitSlop={small ? 6 : 2}
      style={({ pressed }) => [
        {
          height: small ? 32 : 40, paddingHorizontal: small ? space.md : space.lg, borderRadius: radius.control,
          backgroundColor: fill, borderWidth: kind === 'primary' ? 0 : StyleSheet.hairlineWidth * 2,
          borderColor: kind === 'danger' ? c.danger : c.hairline,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={text} size="small" /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={text} weight="medium" /> : null}
      <Text style={{ color: text, fontSize: small ? type.secondary : 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function HeaderButton({ label, icon, onPress, disabled, accessibilityLabel }: { label?: string; icon?: SFSymbol; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => ({ minWidth: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      {icon ? <Icon name={icon} size={20} color={c.terracotta} weight="medium" /> : <Text style={{ color: c.terracotta, fontSize: 15, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  );
}

// ---------- ticks: one stroke sent, two delivered, two in terracotta read ----------
export type TickState = 'waiting' | 'failed' | 'sent' | 'delivered' | 'read';

export function Ticks({ state, color, readColor, failColor }: { state: TickState; color: string; readColor: string; failColor: string }) {
  if (state === 'waiting') return <View accessibilityLabel="Sending"><Icon name="clock" size={11} color={color} /></View>;
  if (state === 'failed') return <View accessibilityLabel="Not sent"><Icon name="exclamationmark.circle.fill" size={13} color={failColor} /></View>;
  const tint = state === 'read' ? readColor : color;
  return (
    <View style={{ width: state === 'sent' ? 11 : 15, height: 11 }} accessibilityLabel={state === 'read' ? 'Read' : state === 'delivered' ? 'Delivered' : 'Sent'}>
      <View style={{ position: 'absolute', left: 0 }}><Icon name="checkmark" size={11} color={tint} weight="semibold" /></View>
      {state !== 'sent' ? <View style={{ position: 'absolute', left: 4.5 }}><Icon name="checkmark" size={11} color={tint} weight="semibold" /></View> : null}
    </View>
  );
}

// a message of mine: waiting, sent, delivered to all others, read by all others
export function tickFor(chat: Chat, meId: number, messageId: number): TickState {
  if (!messageId) return 'waiting';
  const others = chat.members.filter((m) => m.id !== meId);
  if (!others.length) return 'sent';
  const r = (id: number) => chat.receipts[id] || { delivered: 0, read: 0 };
  if (others.every((m) => r(m.id).read >= messageId)) return 'read';
  if (others.every((m) => r(m.id).delivered >= messageId)) return 'delivered';
  return 'sent';
}

// ---------- words for times and dates (18 Oct 2026, today, yesterday, 14:05) ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

export const clock = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fullDate = (t: number) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

function dayIndex(t: number) {
  const d = new Date(t);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
}

export function dayWords(t: number) {
  const diff = dayIndex(Date.now()) - dayIndex(t);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return DAYS[new Date(t).getDay()];
  return fullDate(t);
}

export function listTime(t: number) {
  const diff = dayIndex(Date.now()) - dayIndex(t);
  if (diff === 0) return clock(t);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return DAYS[new Date(t).getDay()].slice(0, 3);
  return fullDate(t);
}

export const sameDay = (a: number, b: number) => dayIndex(a) === dayIndex(b);

export function chatTitle(chat: Chat, meId?: number) {
  if (chat.kind === 'group') return chat.title || 'Group';
  const other = chat.members.find((m) => m.id !== meId);
  return other?.name || 'Just you';
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0];

export function previewOf(chat: Chat, meId?: number) {
  const m = chat.last;
  if (!m) return 'No messages yet';
  const what = m.kind === 'photo' ? (m.body ? `Photo: ${m.body}` : 'Photo') : m.kind === 'voice' ? 'Voice note' : m.body || '';
  if (m.kind === 'system' || chat.kind === 'direct' || m.senderId === meId) return what;
  const who = chat.members.find((x) => x.id === m.senderId);
  return who ? `${firstName(who.name)}: ${what}` : what;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.hairline, marginLeft: inset }} />;
}

export function SectionLabel({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <Text style={{ color: c.inkFaint, fontSize: type.caption, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginHorizontal: space.lg, marginTop: space.xl, marginBottom: space.sm }}>
      {children}
    </Text>
  );
}
