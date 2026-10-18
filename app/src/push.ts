// Notifications: asking once (from a quiet card, not at first launch), giving the server this
// phone's APNs token, hiding banners for the chat already on screen, opening a chat from a tap,
// and keeping the app icon's badge equal to what is unread.
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { api } from './api';
import { getState } from './store';

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const chatId = Number((n.request.content.data as { chatId?: number } | undefined)?.chatId);
    const onScreen = chatId && getState().openChatId === chatId;
    return { shouldShowBanner: !onScreen, shouldShowList: !onScreen, shouldPlaySound: !onScreen, shouldSetBadge: true };
  },
});

const DISMISSED_KEY = 'family.pushCardDismissed';

export type PushState = 'granted' | 'denied' | 'undetermined';

export async function pushState(): Promise<PushState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

// ask: true only when the person tapped "Turn on"
export async function registerForPush(ask: boolean): Promise<PushState> {
  let p = await Notifications.getPermissionsAsync();
  if (!p.granted && ask && p.canAskAgain) {
    p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  }
  if (!p.granted) return p.canAskAgain ? 'undetermined' : 'denied';
  try {
    const t = await Notifications.getDevicePushTokenAsync(); // the raw APNs token, which the server sends to directly
    await api('POST', '/me/push', { pushToken: String(t.data) });
  } catch { /* tried again on the next start */ }
  return 'granted';
}

export const pushCardDismissed = async () => (await SecureStore.getItemAsync(DISMISSED_KEY)) === '1';
export const dismissPushCard = () => SecureStore.setItemAsync(DISMISSED_KEY, '1');

export function onNotificationTap(open: (chatId: number) => void) {
  const pick = (r: Notifications.NotificationResponse | null) => {
    const chatId = Number((r?.notification.request.content.data as { chatId?: number } | undefined)?.chatId);
    if (chatId) open(chatId);
  };
  Notifications.getLastNotificationResponseAsync().then(pick).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(pick);
  return () => sub.remove();
}

export function setBadge(n: number) {
  Notifications.setBadgeCountAsync(n).catch(() => {});
}
