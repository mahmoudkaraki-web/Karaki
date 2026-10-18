// The front door: the wordmark, one line, and the one way in: the invite code.
// Long press the wordmark to point the app at another server (for testing).
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getServerUrl, setServerUrl } from '../api';
import { serif, space, type, useTheme } from '../theme';
import { Button } from '../ui';
import type { ScreenProps } from '../nav';

export function Welcome({ navigation }: ScreenProps<'Welcome'>) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [serverUp, setServerUp] = useState<boolean | null>(null);

  // the server may be down for a moment: say so plainly
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
          A private place for us. Messages, photos, voice notes and calls, only between the family.
        </Text>
      </View>

      <View style={{ gap: space.md }}>
        {serverUp === false ? (
          <Pressable onPress={() => void checkServer()} accessibilityRole="button" accessibilityHint="Checks again"
            style={{ padding: space.md, borderRadius: 8, backgroundColor: c.inset, gap: 2 }}>
            <Text style={{ color: c.ink, fontSize: type.secondary, fontWeight: '600' }}>Karaki is not online right now</Text>
            <Text style={{ color: c.inkSoft, fontSize: type.caption, lineHeight: 17 }}>The family server is not answering, so joining will not work for the moment. Tap to check again.</Text>
          </Pressable>
        ) : null}
        <Button label="I have an invite code" onPress={() => navigation.navigate('Join')} />
        <Text style={{ color: c.inkFaint, fontSize: type.caption, textAlign: 'center', lineHeight: 17 }}>
          Karaki is invite only. Open the invite link you were sent, or type its code.
        </Text>
      </View>
    </View>
  );
}
