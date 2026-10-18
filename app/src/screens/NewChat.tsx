// Starting a conversation: pick one person for a one to one chat, or more and a name for a group.
import React, { useLayoutEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { sayError } from '../api';
import { createGroup, openDirect, useFamily } from '../store';
import { radius, space, type, useTheme } from '../theme';
import { Button, Divider, HeaderButton, Icon, Seal, SectionLabel } from '../ui';
import type { ScreenProps } from '../nav';

export function NewChat({ navigation }: ScreenProps<'NewChat'>) {
  const { c } = useTheme();
  const me = useFamily((s) => s.me);
  const members = useFamily((s) => s.members);
  const [picked, setPicked] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const others = members.filter((m) => m.id !== me?.id);
  const isGroup = picked.length > 1;

  useLayoutEffect(() => {
    navigation.setOptions({ headerLeft: () => <HeaderButton label="Cancel" onPress={() => navigation.goBack()} /> });
  }, [navigation]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function start() {
    setBusy(true);
    try {
      const chat = isGroup ? await createGroup(title.trim(), picked) : await openDirect(picked[0]);
      navigation.replace('Chat', { chatId: chat.id });
    } catch (e) {
      Alert.alert('Could not start the chat', sayError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.linen }} contentContainerStyle={{ paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
      <SectionLabel>Who is it for</SectionLabel>
      <View style={{ backgroundColor: c.paper, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.hairlineSoft }}>
        {others.map((m, i) => {
          const on = picked.includes(m.id);
          return (
            <View key={m.id}>
              {i ? <Divider inset={space.lg + 36 + space.md} /> : null}
              <Pressable onPress={() => toggle(m.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 56, opacity: pressed ? 0.6 : 1 })}>
                <Seal member={m} />
                <Text style={{ flex: 1, color: c.ink, fontSize: type.body, fontWeight: '500' }}>{m.name}</Text>
                <View style={{ width: 22, height: 22, borderRadius: radius.chip, borderWidth: on ? 0 : 1.5, borderColor: c.inkGhost, backgroundColor: on ? c.terracotta : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="checkmark" size={12} color={c.onTerracotta} weight="semibold" /> : null}
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
      {!others.length ? <Text style={{ color: c.inkSoft, margin: space.lg }}>Nobody else has joined yet.</Text> : null}

      {isGroup ? (
        <>
          <SectionLabel>Group name</SectionLabel>
          <TextInput
            value={title} onChangeText={setTitle} placeholder="Home, Weekend, Grandma's birthday..." placeholderTextColor={c.inkGhost} maxLength={60}
            style={{ marginHorizontal: space.lg, height: 48, borderRadius: radius.field, backgroundColor: c.inset, paddingHorizontal: space.lg, color: c.ink, fontSize: type.body }}
          />
        </>
      ) : null}

      <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
        <Button
          label={isGroup ? 'Start the group' : 'Open the chat'}
          disabled={!picked.length || (isGroup && !title.trim())}
          busy={busy}
          onPress={() => void start()}
        />
      </View>
    </ScrollView>
  );
}
