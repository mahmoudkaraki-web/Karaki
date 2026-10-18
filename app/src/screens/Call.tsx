// The call screen: the current call from calls.ts, drawn by CallLayout.
import React, { useEffect, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { answerHere, flipCamera, hangup, toggleCamera, toggleMute, toggleSpeaker, useCall } from '../calls';
import { useFamily } from '../store';
import { CallLayout, night } from './CallLayout';
import type { ScreenProps } from '../nav';

const actions = {
  hangup,
  answer: answerHere,
  mute: toggleMute,
  speaker: toggleSpeaker,
  camera: () => { void toggleCamera(); },
  flip: () => { void flipCamera(); },
};

export function Call({ navigation }: ScreenProps<'Call'>) {
  const call = useCall();
  const insets = useSafeAreaInsets();
  const members = useFamily((s) => s.members);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!call && navigation.canGoBack()) navigation.goBack();
  }, [call, navigation]);

  if (!call) return <View style={{ flex: 1, backgroundColor: night.bg }} />;
  const who = (id: number) => members.find((m) => m.id === id) || { id, name: 'Family', color: '#8C5A3C' };

  return (
    <>
      <StatusBar barStyle="light-content" />
      <CallLayout call={call} who={who} insets={insets} actions={actions} now={now} />
    </>
  );
}
