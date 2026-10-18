// The family: who is in it, your own name, invites (admins), notifications, the server, sign out.
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { api, getServerUrl, sayError, type Invite } from '../api';
import { renameMe, signOut, useFamily } from '../store';
import { pushState, registerForPush, type PushState } from '../push';
import { radius, serif, space, type, useTheme } from '../theme';
import { Button, Divider, Seal, SectionLabel, fullDate } from '../ui';
import type { ScreenProps } from '../nav';

export function Family({ navigation }: ScreenProps<'Family'>) {
  const { c } = useTheme();
  const me = useFamily((s) => s.me);
  const members = useFamily((s) => s.members);
  const online = useFamily((s) => s.online);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [fresh, setFresh] = useState<Invite | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInvites = useCallback(() => {
    if (me?.isAdmin) api<{ invites: Invite[] }>('GET', '/invites').then((r) => setInvites(r.invites)).catch(() => {});
  }, [me?.isAdmin]);

  useEffect(() => { loadInvites(); pushState().then(setPush).catch(() => {}); }, [loadInvites]);

  function invite() {
    Alert.prompt('Invite someone', 'Their first name, so you know which code is whose.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Make code',
        onPress: async (name?: string) => {
          setBusy(true);
          try {
            const inv = await api<Invite>('POST', '/invites', { nameHint: name?.trim() || undefined });
            setFresh(inv);
            loadInvites();
          } catch (e) { Alert.alert('No invite made', sayError(e)); } finally { setBusy(false); }
        },
      },
    ], 'plain-text');
  }

  function shareInvite(inv: Invite) {
    void Share.share({
      message: `You are invited to Karaki, our private family app for messages. Install Karaki, choose "I have an invite code" and type ${inv.code}. Or open ${inv.link}. The code works once and ends on ${fullDate(inv.expiresAt)}.`,
    });
  }

  function revoke(inv: Invite) {
    Alert.alert('Cancel this invite?', inv.nameHint ? `The code for ${inv.nameHint} will stop working.` : 'The code will stop working.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel invite', style: 'destructive', onPress: () => { api('DELETE', `/invites/${inv.id}`).then(loadInvites).catch(() => {}); if (fresh?.id === inv.id) setFresh(null); } },
    ]);
  }

  function changeName() {
    Alert.prompt('Your name', 'How the family sees you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: (v?: string) => { if (v?.trim()) renameMe(v.trim()).catch((e) => Alert.alert('Not saved', sayError(e))); } },
    ], 'plain-text', me?.name || '');
  }

  function removeMember(id: number, name: string) {
    Alert.alert(`Remove ${name} from the family?`, `${name} will be signed out on every phone and taken out of every group. You can invite them again later.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => api('DELETE', `/members/${id}`).catch((e) => Alert.alert('Not removed', sayError(e))) },
    ]);
  }

  function confirmSignOut() {
    Alert.alert('Sign out of Karaki on this iPhone?', 'Your messages stay on the family server. Sign in with Apple again to come back.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  if (!me) return null;
  const row = { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 56 } as const;
  const group = { backgroundColor: c.paper, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hairlineSoft } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.linen }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <SectionLabel>{`The family, ${members.length}`}</SectionLabel>
      <View style={group}>
        {members.map((m, i) => (
          <View key={m.id}>
            {i ? <Divider inset={space.lg + 36 + space.md} /> : null}
            <Pressable
              style={({ pressed }) => [row, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => (m.id === me.id ? changeName() : undefined)}
              onLongPress={() => (me.isAdmin && m.id !== me.id ? removeMember(m.id, m.name) : undefined)}
            >
              <Seal member={m} online={online.includes(m.id)} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: type.body, fontWeight: '500' }}>{m.id === me.id ? `${m.name} (you)` : m.name}</Text>
                <Text style={{ color: c.inkFaint, fontSize: type.caption }}>
                  {[m.isAdmin ? 'Admin' : null, online.includes(m.id) ? 'Here now' : null, m.id === me.id ? 'Tap to change your name' : null].filter(Boolean).join(' · ') || 'Member'}
                </Text>
              </View>
            </Pressable>
          </View>
        ))}
      </View>
      {me.isAdmin ? <Text style={{ color: c.inkGhost, fontSize: type.caption, marginHorizontal: space.lg, marginTop: space.sm }}>Press and hold someone to remove them from the family.</Text> : null}

      {me.isAdmin ? (
        <>
          <SectionLabel>Invites</SectionLabel>
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            {fresh ? (
              <View style={{ padding: space.lg, borderRadius: radius.bubble, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairlineSoft, gap: space.md }}>
                <Text style={{ color: c.inkSoft, fontSize: type.secondary }}>{fresh.nameHint ? `Code for ${fresh.nameHint}` : 'New invite code'}</Text>
                <Text selectable style={{ fontFamily: serif.semibold, fontSize: type.display, letterSpacing: 4, color: c.ink }}>{fresh.code}</Text>
                <Text style={{ color: c.inkFaint, fontSize: type.caption }}>Works once. Ends on {fullDate(fresh.expiresAt)}.</Text>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button small label="Share" icon="square.and.arrow.up" onPress={() => shareInvite(fresh)} />
                  <Button small kind="quiet" label="Copy code" onPress={() => { void Clipboard.setStringAsync(fresh.code || ''); }} />
                </View>
              </View>
            ) : null}
            <Button kind="quiet" label="Invite someone" icon="person.badge.plus" busy={busy} onPress={invite} />
            {invites.filter((x) => x.id !== fresh?.id).map((inv) => (
              <Pressable key={inv.id} onPress={() => revoke(inv)} style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: c.inkSoft, fontSize: type.secondary }}>{inv.nameHint || 'Invite'}{inv.isAdmin ? ' (admin)' : ''}</Text>
                <Text style={{ color: c.inkFaint, fontSize: type.caption }}>open until {fullDate(inv.expiresAt)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <SectionLabel>This iPhone</SectionLabel>
      <View style={group}>
        <Pressable
          style={({ pressed }) => [row, { opacity: pressed ? 0.6 : 1 }]}
          onPress={async () => {
            if (push === 'denied') return Linking.openSettings();
            if (push !== 'granted') setPush(await registerForPush(true));
          }}
        >
          <Text style={{ flex: 1, color: c.ink, fontSize: type.body }}>Notifications</Text>
          <Text style={{ color: push === 'granted' ? c.inkFaint : c.terracotta, fontSize: type.secondary, fontWeight: '500' }}>
            {push === 'granted' ? 'On' : push === 'denied' ? 'Off, open Settings' : 'Turn on'}
          </Text>
        </Pressable>
        <Divider inset={space.lg} />
        <View style={row}>
          <Text style={{ flex: 1, color: c.ink, fontSize: type.body }}>Server</Text>
          <Text numberOfLines={1} style={{ color: c.inkFaint, fontSize: type.caption, maxWidth: 220 }}>{getServerUrl().replace(/^https?:\/\//, '')}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
        <Button kind="danger" label="Sign out" onPress={confirmSignOut} />
      </View>
      <Text style={{ color: c.inkGhost, fontSize: type.caption, textAlign: 'center', marginTop: space.lg }} onPress={() => navigation.goBack()}>
        Karaki 0.1
      </Text>
    </ScrollView>
  );
}
