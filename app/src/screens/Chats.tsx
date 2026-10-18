// Home: the household strip (everyone's seal; tap one to write to them) and the conversations.
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { sayError } from '../api';
import { openDirect, refreshChats, useFamily } from '../store';
import { dismissPushCard, pushCardDismissed, pushState, registerForPush, setBadge } from '../push';
import { radius, space, type, useTheme } from '../theme';
import { Button, Divider, HeaderButton, Seal, SealStack, Ticks, chatTitle, firstName, listTime, previewOf, tickFor } from '../ui';
import type { ScreenProps } from '../nav';

export function Chats({ navigation }: ScreenProps<'Chats'>) {
  const { c } = useTheme();
  const me = useFamily((s) => s.me);
  const members = useFamily((s) => s.members);
  const online = useFamily((s) => s.online);
  const chatsMap = useFamily((s) => s.chats);
  const connected = useFamily((s) => s.connected);
  const [refreshing, setRefreshing] = useState(false);
  const [showPushCard, setShowPushCard] = useState(false);

  const chats = useMemo(() => Object.values(chatsMap).sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id), [chatsMap]);
  const unreadTotal = chats.reduce((n, x) => n + x.unread, 0);
  useEffect(() => setBadge(unreadTotal), [unreadTotal]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderButton icon="person.2" onPress={() => navigation.navigate('Family')} accessibilityLabel="The family" />,
      headerRight: () => <HeaderButton label="New" onPress={() => navigation.navigate('NewChat')} />,
    });
  }, [navigation]);

  // notifications: register quietly if already allowed; otherwise offer once, from a card
  useEffect(() => {
    (async () => {
      const st = await pushState();
      if (st === 'granted') await registerForPush(false);
      else if (st === 'undetermined' && !(await pushCardDismissed())) setShowPushCard(true);
    })().catch(() => {});
  }, []);

  async function writeTo(memberId: number) {
    try {
      const chat = await openDirect(memberId);
      navigation.navigate('Chat', { chatId: chat.id });
    } catch (e) {
      Alert.alert('Could not open the chat', sayError(e));
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try { await refreshChats(); } catch { /* offline: the banner says so */ } finally { setRefreshing(false); }
  }

  const others = members.filter((m) => m.id !== me?.id);

  const header = (
    <View>
      {!connected ? (
        <View style={{ marginHorizontal: space.lg, marginTop: space.sm, paddingVertical: 6, paddingHorizontal: space.md, borderRadius: radius.chip, backgroundColor: c.inset }}>
          <Text style={{ color: c.inkSoft, fontSize: type.caption }}>Connecting to the family server...</Text>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.lg }}>
        {others.map((m) => (
          <Pressable key={m.id} onPress={() => void writeTo(m.id)} accessibilityRole="button" accessibilityLabel={`Write to ${m.name}`}
            style={({ pressed }) => ({ alignItems: 'center', width: 60, opacity: pressed ? 0.6 : 1 })}>
            <Seal member={m} size={48} online={online.includes(m.id)} />
            <Text numberOfLines={1} style={{ marginTop: 6, color: c.inkSoft, fontSize: type.caption, fontWeight: '500' }}>{firstName(m.name)}</Text>
          </Pressable>
        ))}
        {me?.isAdmin ? (
          <Pressable onPress={() => navigation.navigate('Family')} accessibilityRole="button" accessibilityLabel="Invite someone"
            style={({ pressed }) => ({ alignItems: 'center', width: 60, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.inkGhost, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.inkFaint, fontSize: 22, lineHeight: 26 }}>+</Text>
            </View>
            <Text style={{ marginTop: 6, color: c.inkFaint, fontSize: type.caption }}>Invite</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {showPushCard ? (
        <View style={{ marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, borderRadius: radius.bubble, backgroundColor: c.paper, borderWidth: 1, borderColor: c.hairlineSoft, gap: space.md }}>
          <Text style={{ color: c.ink, fontSize: type.body, fontWeight: '600' }}>Hear from the family</Text>
          <Text style={{ color: c.inkSoft, fontSize: type.secondary, lineHeight: 20 }}>Turn on notifications so a message reaches you when the app is closed.</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button small label="Turn on" onPress={async () => { await registerForPush(true); setShowPushCard(false); }} />
            <Button small kind="quiet" label="Not now" onPress={() => { void dismissPushCard(); setShowPushCard(false); }} />
          </View>
        </View>
      ) : null}
      <Divider />
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.linen }}
      contentInsetAdjustmentBehavior="automatic"
      data={chats}
      keyExtractor={(x) => String(x.id)}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.inkFaint} />}
      ItemSeparatorComponent={() => <Divider inset={space.lg + 36 + space.md} />}
      ListEmptyComponent={
        <View style={{ padding: space.xl, gap: space.sm }}>
          <Text style={{ color: c.inkSoft, fontSize: type.body, lineHeight: 22 }}>
            {others.length ? 'No conversations yet. Tap someone above to write to them.' : 'Nobody else is here yet. Invite the family from the people button at the top.'}
          </Text>
        </View>
      }
      renderItem={({ item: chat }) => {
        const title = chatTitle(chat, me?.id);
        const other = chat.kind === 'direct' ? chat.members.find((m) => m.id !== me?.id) : undefined;
        const mineLast = chat.last && chat.last.senderId === me?.id && chat.last.kind !== 'system';
        return (
          <Pressable
            onPress={() => navigation.navigate('Chat', { chatId: chat.id })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 68, backgroundColor: pressed ? c.paper : 'transparent' })}
          >
            {other ? <Seal member={other} online={online.includes(other.id)} /> : <SealStack members={chat.members} meId={me?.id} />}
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontSize: type.body, fontWeight: '600' }}>{title}</Text>
                {chat.last ? <Text style={{ color: chat.unread ? c.terracotta : c.inkFaint, fontSize: type.caption, fontVariant: ['tabular-nums'] }}>{listTime(chat.last.createdAt)}</Text> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {mineLast && me ? <Ticks state={tickFor(chat, me.id, chat.last!.id)} color={c.inkFaint} readColor={c.terracotta} failColor={c.danger} /> : null}
                <Text numberOfLines={1} style={{ flex: 1, color: chat.unread ? c.ink : c.inkSoft, fontSize: type.secondary }}>{previewOf(chat, me?.id)}</Text>
                {chat.unread ? (
                  <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: radius.chip, backgroundColor: c.terracotta, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: c.onTerracotta, fontSize: type.caption, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
