// Joining with an invite: the code (filled in when the invite link opened the app, or typed, or
// pasted with the whole link), your name for a new member, then one tap on Join.
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, sayError } from '../api';
import { codeSignIn } from '../signin';
import { radius, serif, space, type, useTheme } from '../theme';
import { Button } from '../ui';
import type { ScreenProps } from '../nav';

// XXXX-XXXX while typing; a pasted link (…/join/K7QX-M2PA) gives just its code
const shape = (v: string) => {
  const fromLink = /join\/([A-Za-z0-9-]{8,9})/.exec(v);
  const raw = (fromLink ? fromLink[1] : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

type Check = { invitedBy: string | null; nameHint: string | null; kind: 'new' | 'device' };

export function Join({ route }: ScreenProps<'Join'>) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(shape(route.params?.code || ''));
  const [name, setName] = useState('');
  const [invite, setInvite] = useState<Check | null>(null);
  const [checkError, setCheckError] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = code.replace('-', '').length === 8;

  // a new link opened while this screen is up
  useEffect(() => {
    if (route.params?.code) setCode(shape(route.params.code));
  }, [route.params?.code]);

  useEffect(() => {
    setInvite(null);
    setCheckError('');
    if (!complete) return;
    let live = true;
    api<Check>('GET', `/invites/${code}/check`)
      .then((r) => { if (!live) return; setInvite(r); if (r.nameHint && r.kind !== 'device') setName((n) => n || r.nameHint || ''); })
      .catch((e) => { if (live) setCheckError(sayError(e)); });
    return () => { live = false; };
  }, [code, complete]);

  async function join() {
    setBusy(true);
    try {
      await codeSignIn(code, invite?.kind === 'device' ? undefined : name);
    } catch (e) {
      Alert.alert('Could not join', sayError(e));
    } finally {
      setBusy(false);
    }
  }

  const field = {
    height: 48, borderRadius: radius.field, backgroundColor: c.inset, paddingHorizontal: space.lg,
    color: c.ink, fontSize: type.body,
  } as const;
  const device = invite?.kind === 'device';

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.linen }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontFamily: serif.semibold, fontSize: type.heading, color: c.ink, letterSpacing: -0.3 }}>
          {device ? 'Sign in on this iPhone' : 'Join the family'}
        </Text>
        <Text style={{ color: c.inkSoft, fontSize: type.body, lineHeight: 22 }}>
          {route.params?.code ? 'Your invite code is filled in.' : 'Type the invite code you were sent. It looks like K7QX-M2PA and works once.'}
        </Text>

        <View style={{ gap: space.sm }}>
          <Text style={{ color: c.inkFaint, fontSize: type.caption, fontWeight: '600', letterSpacing: 0.6 }}>INVITE CODE</Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(shape(v))}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="XXXX-XXXX"
            placeholderTextColor={c.inkGhost}
            style={[field, { fontFamily: serif.medium, fontSize: 24, letterSpacing: 3, height: 56 }]}
          />
          {invite ? (
            <Text style={{ color: c.inkSoft, fontSize: type.secondary }}>
              {device ? `This code signs you in as ${invite.nameHint}, with your chats.` : `${invite.invitedBy ? `Invited by ${invite.invitedBy}. ` : ''}The code is good.`}
            </Text>
          ) : checkError ? <Text style={{ color: c.danger, fontSize: type.secondary }}>{checkError}</Text> : null}
        </View>

        {!device ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ color: c.inkFaint, fontSize: type.caption, fontWeight: '600', letterSpacing: 0.6 }}>YOUR NAME</Text>
            <TextInput value={name} onChangeText={setName} placeholder="The name the family knows you by" placeholderTextColor={c.inkGhost} maxLength={40} style={field} />
          </View>
        ) : null}

        <Button label={device ? 'Sign in' : 'Join'} onPress={() => void join()} busy={busy} disabled={!invite} style={{ marginTop: space.sm }} />
        <Text style={{ color: c.inkFaint, fontSize: type.caption, lineHeight: 17 }}>
          Karaki keeps only your name, your messages and calls, inside the family. Nothing is shared with anyone.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
