// The front door: the wordmark, one line, Sign in with Apple, and the way in with an invite.
// Long press the wordmark to point the app at another server (for testing before it is online).
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, getServerUrl, sayError, setServerUrl } from '../api';
import { appleSignIn, finishSignIn } from '../signin';
import { serif, space, type, useTheme } from '../theme';
import type { ScreenProps } from '../nav';

export function Welcome({ navigation }: ScreenProps<'Welcome'>) {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [serverUp, setServerUp] = useState<boolean | null>(null);

  // the server may not be running yet (it goes online after the demo freeze): say so plainly
  async function checkServer() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(`${getServerUrl()}/health`, { signal: ctl.signal });
      setServerUp(r.ok);
    } catch {
      setServerUp(false);
    } finally {
      clearTimeout(t);
    }
  }
  useEffect(() => { void checkServer(); }, []);

  async function signIn() {
    setBusy(true);
    try {
      const apple = await appleSignIn();
      if (!apple) return;
      try {
        await finishSignIn(apple, {});
      } catch (e) {
        // a new Apple ID: they need the invite code; keep the Apple answer so they sign in only once
        if (e instanceof ApiError && e.code === 'invite_required') navigation.navigate('Join', { apple });
        else Alert.alert('Could not sign in', sayError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  function changeServer() {
    Alert.prompt('Server address', `Now: ${getServerUrl()}\nLeave empty to go back to the normal one.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: (v?: string) => { void setServerUrl(v || null).then((u) => { Alert.alert('Server address', u); void checkServer(); }); } },
    ], 'plain-text', '', 'url');
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.linen, paddingTop: insets.top, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.xl }}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Pressable onLongPress={changeServer} delayLongPress={1200} accessibilityRole="header">
          <Text style={{ fontFamily: serif.semibold, fontSize: type.wordmark, color: c.ink, letterSpacing: -0.8 }}>Karaki</Text>
        </Pressable>
        <View style={{ width: 32, height: 3, backgroundColor: c.terracotta, borderRadius: 2, marginTop: space.md, marginBottom: space.lg }} />
        <Text style={{ fontSize: type.title, lineHeight: 28, color: c.inkSoft, maxWidth: 300 }}>
          A private place for us. Messages, photos and voice notes, only between the family.
        </Text>
      </View>

      <View style={{ gap: space.md }}>
        {serverUp === false ? (
          <Pressable onPress={() => void checkServer()} accessibilityRole="button" accessibilityHint="Checks again"
            style={{ padding: space.md, borderRadius: 8, backgroundColor: c.inset, gap: 2 }}>
            <Text style={{ color: c.ink, fontSize: type.secondary, fontWeight: '600' }}>Karaki is not online yet</Text>
            <Text style={{ color: c.inkSoft, fontSize: type.caption, lineHeight: 17 }}>The family server is not running yet, so signing in will not work for now. Tap to check again.</Text>
          </Pressable>
        ) : null}
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8}
          style={{ height: 44, opacity: busy ? 0.5 : 1 }}
          onPress={() => { if (!busy) void signIn(); }}
        />
        <Pressable
          onPress={() => navigation.navigate('Join')}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({ height: 40, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: c.terracotta, fontSize: 15, fontWeight: '600' }}>I have an invite code</Text>
        </Pressable>
        <Text style={{ color: c.inkFaint, fontSize: type.caption, textAlign: 'center', lineHeight: 17 }}>
          Karaki is invite only. Nobody can find you or write to you here unless the family let them in.
        </Text>
      </View>
    </View>
  );
}
