// Joining with an invite: type (or open a link with) the code, see who invited you, give your
// name, and sign in with Apple once. The code is shaped as XXXX-XXXX while typing.
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, sayError } from '../api';
import { appleSignIn, finishSignIn, type AppleAnswer } from '../signin';
import { radius, serif, space, type, useTheme } from '../theme';
import { Button } from '../ui';
import type { ScreenProps } from '../nav';

const shape = (v: string) => {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

export function Join({ route }: ScreenProps<'Join'>) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState(shape(route.params?.code || ''));
  const [name, setName] = useState(route.params?.apple?.name || '');
  const [apple, setApple] = useState<AppleAnswer | undefined>(route.params?.apple);
  const [invite, setInvite] = useState<{ invitedBy: string | null; nameHint: string | null } | null>(null);
  const [checkError, setCheckError] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = code.replace('-', '').length === 8;

  useEffect(() => {
    setInvite(null);
    setCheckError('');
    if (!complete) return;
    let live = true;
    api<{ invitedBy: string | null; nameHint: string | null }>('GET', `/invites/${code}/check`)
      .then((r) => { if (!live) return; setInvite(r); if (r.nameHint) setName((n) => n || r.nameHint || ''); })
      .catch((e) => { if (live) setCheckError(sayError(e)); });
    return () => { live = false; };
  }, [code, complete]);

  async function join(withApple?: AppleAnswer) {
    setBusy(true);
    try {
      const a = withApple || apple || (await appleSignIn());
      if (!a) return;
      setApple(a);
      await finishSignIn(a, { inviteCode: code, name: name.trim() || undefined });
    } catch (e) {
      // Apple's answer lasts ten minutes; after that, sign in with Apple again
      if (e instanceof ApiError && (e.code === 'bad_token' || e.code === 'bad_nonce')) setApple(undefined);
      Alert.alert('Could not join', sayError(e));
    } finally {
      setBusy(false);
    }
  }

  const field = {
    height: 48, borderRadius: radius.field, backgroundColor: c.inset, paddingHorizontal: space.lg,
    color: c.ink, fontSize: type.body,
  } as const;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.linen }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontFamily: serif.semibold, fontSize: type.heading, color: c.ink, letterSpacing: -0.3 }}>Join the family</Text>
        <Text style={{ color: c.inkSoft, fontSize: type.body, lineHeight: 22 }}>
          Type the invite code you were sent. It looks like K7QX-M2PA and works once.
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
              {invite.invitedBy ? `Invited by ${invite.invitedBy}. ` : ''}The code is good.
            </Text>
          ) : checkError ? <Text style={{ color: c.danger, fontSize: type.secondary }}>{checkError}</Text> : null}
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={{ color: c.inkFaint, fontSize: type.caption, fontWeight: '600', letterSpacing: 0.6 }}>YOUR NAME</Text>
          <TextInput value={name} onChangeText={setName} placeholder="The name the family knows you by" placeholderTextColor={c.inkGhost} maxLength={40} style={field} />
        </View>

        <View style={{ marginTop: space.sm }}>
          {apple ? (
            <Button label="Join the family" onPress={() => void join()} busy={busy} disabled={!invite} />
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={8}
              style={{ height: 44, opacity: !invite || busy ? 0.4 : 1 }}
              onPress={() => { if (invite && !busy) void join(); }}
            />
          )}
        </View>
        <Text style={{ color: c.inkFaint, fontSize: type.caption, lineHeight: 17 }}>
          Apple confirms it is you. Karaki keeps only your name and an Apple number that means nothing outside this app.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
