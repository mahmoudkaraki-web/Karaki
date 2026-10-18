// One conversation, one to one or a group: messages newest at the bottom, day lines, sender
// names in groups, ticks, "seen by" seals, who is writing, the composer. The call buttons are
// already in the header for phase 2 and say so when tapped.
import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authHeaders, mediaUrl } from '../api';
import { discard, loadOlder, loadThread, openChat, retry, useFamily, type LocalMessage } from '../store';
import { Bubble } from '../chat/Bubble';
import { Composer } from '../chat/Composer';
import { radius, serif, space, type, useTheme } from '../theme';
import { HeaderButton, Seal, chatTitle, dayWords, firstName, sameDay, tickFor } from '../ui';
import type { ScreenProps } from '../nav';

type Row =
  | { kind: 'day'; key: string; t: number }
  | { kind: 'msg'; key: string; m: LocalMessage; firstInRun: boolean; lastInRun: boolean };

const RUN_GAP_MS = 5 * 60_000;
const EMPTY: LocalMessage[] = [];

export function callsComingSoon() {
  Alert.alert('Calls are coming soon', 'Voice and video calls between the family arrive in the next version of Karaki.');
}

export function Chat({ route, navigation }: ScreenProps<'Chat'>) {
  const { chatId } = route.params;
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const me = useFamily((s) => s.me);
  const chat = useFamily((s) => s.chats[chatId]);
  const thread = useFamily((s) => s.threads[chatId]);
  const typingMap = useFamily((s) => s.typing[chatId]);
  const online = useFamily((s) => s.online);
  const items = thread?.items || EMPTY;

  useEffect(() => {
    openChat(chatId);
    void loadThread(chatId);
    return () => openChat(null);
  }, [chatId]);

  // removed from the group while looking at it
  useEffect(() => {
    if (me && !chat) navigation.goBack();
  }, [chat, me, navigation]);

  const typers = useMemo(() => {
    if (!chat || !typingMap) return [];
    const now = Date.now();
    return Object.entries(typingMap).filter(([, until]) => until > now)
      .map(([id]) => chat.members.find((m) => m.id === Number(id))).filter(Boolean).map((m) => firstName(m!.name));
  }, [typingMap, chat]);

  const other = chat?.kind === 'direct' ? chat.members.find((m) => m.id !== me?.id) : undefined;
  const subline = typers.length
    ? `${typers.join(' and ')} ${typers.length > 1 ? 'are' : 'is'} writing...`
    : chat?.kind === 'group'
      ? chat.members.map((m) => (m.id === me?.id ? 'You' : firstName(m.name))).join(', ')
      : other && online.includes(other.id) ? 'Here now' : '';

  useLayoutEffect(() => {
    if (!chat) return;
    navigation.setOptions({
      headerTitle: () => (
        <Pressable onPress={() => navigation.navigate('ChatInfo', { chatId })} hitSlop={8} accessibilityRole="button" accessibilityHint="Opens the people in this chat"
          style={{ alignItems: 'center', maxWidth: 220 }}>
          <Text numberOfLines={1} style={{ fontFamily: serif.semibold, fontSize: 17, color: c.ink }}>{chatTitle(chat, me?.id)}</Text>
          {subline ? <Text numberOfLines={1} style={{ fontSize: 11, color: typers.length ? c.terracotta : c.inkFaint, marginTop: 1 }}>{subline}</Text> : null}
        </Pressable>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: space.lg }}>
          <HeaderButton icon="phone" onPress={callsComingSoon} accessibilityLabel="Voice call, coming soon" />
          <HeaderButton icon="video" onPress={callsComingSoon} accessibilityLabel="Video call, coming soon" />
        </View>
      ),
    });
  }, [navigation, chat, me, subline, typers.length, c, chatId]);

  // rows for an inverted list: newest first, with a day line above the first message of each day
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      const prev = items[i - 1];
      const next = items[i + 1];
      const joins = (a?: LocalMessage, b?: LocalMessage) => !!a && !!b && a.kind !== 'system' && b.kind !== 'system'
        && a.senderId === b.senderId && sameDay(a.createdAt, b.createdAt) && Math.abs(b.createdAt - a.createdAt) < RUN_GAP_MS;
      out.push({ kind: 'msg', key: m.id ? `m${m.id}` : `c${m.clientId}`, m, firstInRun: !joins(prev, m), lastInRun: !joins(m, next) });
      if (!prev || !sameDay(prev.createdAt, m.createdAt)) out.push({ kind: 'day', key: `d${m.createdAt}`, t: m.createdAt });
    }
    return out;
  }, [items]);

  // "seen by": in a group, under my latest message, the seals of those who have read it
  const seenBy = useMemo(() => {
    if (!chat || !me || chat.kind !== 'group') return null;
    const last = [...items].reverse().find((m) => m.kind !== 'system');
    if (!last || last.senderId !== me.id || !last.id) return null;
    const readers = chat.members.filter((m) => m.id !== me.id && (chat.receipts[m.id]?.read || 0) >= last.id);
    return { id: last.id, readers };
  }, [chat, me, items]);

  function onFailedPress(m: LocalMessage) {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Try again', 'Delete this message', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2, title: 'This message was not sent' },
      (i) => { if (i === 0) retry(m); if (i === 1) discard(m); },
    );
  }

  function onPhoto(m: LocalMessage) {
    if (m.localUri) navigation.navigate('Photo', { uri: m.localUri });
    else if (m.media?.id) navigation.navigate('Photo', { uri: mediaUrl(m.media.id), headers: authHeaders() });
  }

  if (!chat || !me) return <View style={{ flex: 1, backgroundColor: c.linen }} />;

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1, backgroundColor: c.linen }}>
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.md }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadOlder(chatId)}
        ListFooterComponent={thread?.loading ? <ActivityIndicator style={{ margin: space.lg }} color={c.inkFaint} /> : null}
        ListEmptyComponent={thread?.loaded ? (
          <View style={{ transform: [{ scaleY: -1 }], alignItems: 'center', padding: space.xxl, gap: space.md }}>
            {other ? <Seal member={other} size={72} /> : null}
            <Text style={{ color: c.inkSoft, fontSize: type.secondary, textAlign: 'center', lineHeight: 20 }}>
              Only the people in this chat can read it.
            </Text>
          </View>
        ) : null}
        renderItem={({ item: r }) => {
          if (r.kind === 'day') {
            return (
              <View style={{ alignItems: 'center', marginVertical: space.md }}>
                <Text style={{ color: c.inkFaint, fontSize: type.caption, fontWeight: '600', letterSpacing: 0.3 }}>{dayWords(r.t)}</Text>
              </View>
            );
          }
          const m = r.m;
          if (m.kind === 'system') {
            return (
              <View style={{ alignItems: 'center', marginVertical: space.sm, paddingHorizontal: space.xl }}>
                <Text style={{ color: c.inkFaint, fontSize: type.caption, textAlign: 'center' }}>{m.body}</Text>
              </View>
            );
          }
          const mine = m.senderId === me.id;
          const sender = chat.kind === 'group' && !mine && r.firstInRun ? chat.members.find((x) => x.id === m.senderId) : undefined;
          return (
            <View style={{ marginTop: r.firstInRun ? 10 : 2 }}>
              <Bubble
                m={m} mine={mine} lastInRun={r.lastInRun}
                senderName={sender ? firstName(sender.name) : undefined} senderColor={sender?.color}
                tick={mine ? tickFor(chat, me.id, m.id) : 'sent'}
                onPhoto={onPhoto} onFailedPress={onFailedPress}
              />
              {seenBy && m.id === seenBy.id && seenBy.readers.length ? (
                <View style={{ flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4, marginTop: 4 }} accessibilityLabel={`Seen by ${seenBy.readers.map((x) => x.name).join(' and ')}`}>
                  <Text style={{ color: c.inkFaint, fontSize: 11 }}>Seen by</Text>
                  {seenBy.readers.map((x) => <Seal key={x.id} member={x} size={24} />)}
                </View>
              ) : null}
            </View>
          );
        }}
      />
      {typers.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingBottom: 6 }}>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {[0, 1, 2].map((i) => <View key={i} style={{ width: 5, height: 5, borderRadius: radius.chip, backgroundColor: c.inkGhost }} />)}
          </View>
          <Text style={{ color: c.inkFaint, fontSize: type.caption }}>{typers.join(' and ')} {typers.length > 1 ? 'are' : 'is'} writing</Text>
        </View>
      ) : null}
      <Composer chatId={chatId} bottomInset={insets.bottom} />
    </KeyboardAvoidingView>
  );
}
