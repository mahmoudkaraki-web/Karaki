// Karaki, the family's iPhone app. Signed out: the welcome screen and joining with an invite.
// Signed in: the chat list, chats, the people in a chat, the family, a new chat, a photo.
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { setAudioModeAsync } from 'expo-audio';
import { useFonts } from 'expo-font';
// only the two weights used, so the app does not carry all eighteen
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot, getState, useFamily } from './src/store';
import { onNotificationTap } from './src/push';
import { navRef, type Screens } from './src/nav';
import { serif, useTheme } from './src/theme';
import { Welcome } from './src/screens/Welcome';
import { Join } from './src/screens/Join';
import { Chats } from './src/screens/Chats';
import { Chat } from './src/screens/Chat';
import { ChatInfo } from './src/screens/ChatInfo';
import { Family } from './src/screens/Family';
import { NewChat } from './src/screens/NewChat';
import { Photo } from './src/screens/Photo';
import { Call } from './src/screens/Call';
import { startCallEngine } from './src/calls';

SplashScreen.preventAutoHideAsync().catch(() => {});
// voice notes play even when the ring/silent switch is on silent
setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});

const Stack = createNativeStackNavigator<Screens>();

// karaki://join/K7QX-M2PA opens the join screen with the code filled in
function inviteCodeFrom(url: string | null) {
  if (!url) return undefined;
  const m = /join\/([A-Za-z0-9-]{8,9})/.exec(url);
  return m ? m[1] : undefined;
}

export default function App() {
  const { c, dark } = useTheme();
  const status = useFamily((s) => s.status);
  const [fontsLoaded] = useFonts({ Fraunces_500Medium, Fraunces_600SemiBold });
  const [navReady, setNavReady] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | undefined>();

  useEffect(() => { void boot(); }, []);

  // calls: CallKit, VoIP pushes and the call signalling, once someone is signed in
  useEffect(() => (status === 'signedIn' ? startCallEngine() : undefined), [status]);

  useEffect(() => {
    Linking.getInitialURL().then((u) => setPendingCode(inviteCodeFrom(u))).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => setPendingCode(inviteCodeFrom(url)));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (fontsLoaded && status !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, status]);

  // an invite link while signed out goes straight to joining
  useEffect(() => {
    if (navReady && pendingCode && status === 'signedOut' && navRef.isReady()) {
      navRef.navigate('Join', { code: pendingCode });
      setPendingCode(undefined);
    }
  }, [navReady, pendingCode, status]);

  // a tapped notification opens its chat
  useEffect(() => {
    if (!navReady || status !== 'signedIn') return undefined;
    return onNotificationTap((chatId) => {
      if (navRef.isReady() && getState().chats[chatId] !== undefined) navRef.navigate('Chat', { chatId });
      else if (navRef.isReady()) navRef.navigate('Chats');
    });
  }, [navReady, status]);

  if (!fontsLoaded || status === 'loading') return null;

  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: c.linen, card: c.linen, text: c.ink, border: c.hairline, primary: c.terracotta },
  };
  const header = {
    headerStyle: { backgroundColor: c.linen },
    headerShadowVisible: false,
    headerTintColor: c.terracotta,
    headerTitleStyle: { fontFamily: serif.semibold, fontSize: 17, color: c.ink },
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: c.linen },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <NavigationContainer ref={navRef} theme={navTheme} onReady={() => setNavReady(true)}>
        <Stack.Navigator screenOptions={header}>
          {status === 'signedIn' ? (
            <>
              <Stack.Screen
                name="Chats"
                component={Chats}
                options={{
                  title: 'Karaki',
                  headerLargeTitleEnabled: true,
                  headerLargeTitleShadowVisible: false,
                  headerLargeTitleStyle: { fontFamily: serif.semibold, color: c.ink },
                }}
              />
              <Stack.Screen name="Chat" component={Chat} options={{ title: '' }} />
              <Stack.Screen name="ChatInfo" component={ChatInfo} options={{ title: '' }} />
              <Stack.Screen name="Family" component={Family} options={{ title: 'The family' }} />
              <Stack.Screen name="NewChat" component={NewChat} options={{ title: 'New conversation', presentation: 'modal' }} />
              <Stack.Screen name="Photo" component={Photo} options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
              <Stack.Screen name="Call" component={Call} options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }} />
            </>
          ) : (
            <>
              <Stack.Screen name="Welcome" component={Welcome} options={{ headerShown: false }} />
              <Stack.Screen name="Join" component={Join} options={{ title: '' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
