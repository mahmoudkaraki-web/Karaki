import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNavigationContainerRef } from '@react-navigation/native';

export type Screens = {
  Welcome: undefined;
  Join: { code?: string } | undefined;
  Chats: undefined;
  Chat: { chatId: number };
  ChatInfo: { chatId: number };
  Family: undefined;
  NewChat: undefined;
  Photo: { uri: string; headers?: Record<string, string> };
  Call: undefined;
};

export type ScreenProps<K extends keyof Screens> = NativeStackScreenProps<Screens, K>;

export const navRef = createNavigationContainerRef<Screens>();
