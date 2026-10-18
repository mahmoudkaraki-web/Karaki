// The people in a chat. For a group: rename, add someone, remove someone (whoever started the
// group, or a family admin), leave. For one to one: the person, and calls (coming soon).
import React from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { sayError } from '../api';
import { addToGroup, removeFromGroup, renameGroup, useFamily } from '../store';
import { startCall } from '../calls';
import { serif, space, type, useTheme } from '../theme';
import { Button, Divider, Icon, Seal, SectionLabel, chatTitle, fullDate } from '../ui';
import type { ScreenProps } from '../nav';

export function ChatInfo({ route, navigation }: ScreenProps<'ChatInfo'>) {
  const { chatId } = route.params;
  const { c } = useTheme();
  const me = useFamily((s) => s.me);
  const chat = useFamily((s) => s.chats[chatId]);
  const family = useFamily((s) => s.members);
  const online = useFamily((s) => s.online);
  if (!chat || !me) return <View style={{ flex: 1, backgroundColor: c.linen }} />;

  const isGroup = chat.kind === 'group';
  const canRemove = chat.createdBy === me.id || me.isAdmin;
  const outside = family.filter((m) => !chat.members.some((x) => x.id === m.id));
  const other = !isGroup ? chat.members.find((m) => m.id !== me.id) : undefined;

  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => Alert.alert('That did not work', sayError(e)));

  function rename() {
    Alert.prompt('Rename the group', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: (v?: string) => { if (v?.trim()) void guard(() => renameGroup(chatId, v.trim())); } },
    ], 'plain-text', chat.title || '');
  }

  function add() {
    if (!outside.length) return Alert.alert('Everyone is here', 'The whole family is already in this group.');
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Add to the group', options: [...outside.map((m) => m.name), 'Cancel'], cancelButtonIndex: outside.length },
      (i) => { if (i < outside.length) void guard(() => addToGroup(chatId, outside[i].id)); },
    );
  }

  function memberMenu(memberId: number, name: string) {
    if (memberId === me!.id || !canRemove) return;
    ActionSheetIOS.showActionSheetWithOptions(
      { title: name, options: [`Remove ${name} from the group`, 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => { if (i === 0) void guard(() => removeFromGroup(chatId, memberId)); },
    );
  }

  function leave() {
    Alert.alert('Leave this group?', 'You will stop getting its messages. Someone in the group can add you back.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => void guard(async () => { await removeFromGroup(chatId, me!.id); navigation.popToTop(); }) },
    ]);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.linen }} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <View style={{ alignItems: 'center', paddingTop: space.xl, paddingHorizontal: space.xl, gap: space.md }}>
        {other ? <Seal member={other} size={72} online={online.includes(other.id)} /> : null}
        <Text style={{ fontFamily: serif.semibold, fontSize: type.heading, color: c.ink, textAlign: 'center' }}>{chatTitle(chat, me.id)}</Text>
        <Text style={{ color: c.inkFaint, fontSize: type.caption }}>
          {isGroup ? `Group of ${chat.members.length}` : 'Just the two of you'}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Button small kind="quiet" icon="phone" label="Call" onPress={() => void startCall(chatId, 'voice')} />
          <Button small kind="quiet" icon="video" label="Video" onPress={() => void startCall(chatId, 'video')} />
          {isGroup ? <Button small kind="quiet" icon="pencil" label="Rename" onPress={rename} /> : null}
        </View>
      </View>

      {isGroup ? (
        <>
          <SectionLabel>People</SectionLabel>
          <View style={{ backgroundColor: c.paper, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hairlineSoft }}>
            {chat.members.map((m, i) => (
              <View key={m.id}>
                {i ? <Divider inset={space.lg + 36 + space.md} /> : null}
                <Pressable onPress={() => memberMenu(m.id, m.name)} disabled={m.id === me.id || !canRemove}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 56, opacity: pressed ? 0.6 : 1 })}>
                  <Seal member={m} online={online.includes(m.id)} />
                  <Text style={{ flex: 1, color: c.ink, fontSize: type.body, fontWeight: '500' }}>{m.id === me.id ? `${m.name} (you)` : m.name}</Text>
                  {m.id === chat.createdBy ? <Text style={{ color: c.inkFaint, fontSize: type.caption }}>Started it</Text> : null}
                </Pressable>
              </View>
            ))}
            <Divider inset={space.lg + 36 + space.md} />
            <Pressable onPress={add} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 56, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ width: 36, height: 36, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.inkGhost, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={16} color={c.inkFaint} />
              </View>
              <Text style={{ color: c.terracotta, fontSize: type.body, fontWeight: '600' }}>Add someone</Text>
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
            <Button kind="danger" label="Leave the group" onPress={leave} />
          </View>
        </>
      ) : null}

      <Text style={{ color: c.inkGhost, fontSize: type.caption, textAlign: 'center', marginTop: space.xl }}>
        Started {fullDate(chat.createdAt)}. Only the people here can read it.
      </Text>
    </ScrollView>
  );
}
