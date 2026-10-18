// Writing a message: the photo button, the inset text field, and on the right either the mic
// (hold to record a voice note, slide left to cancel, let go to send) or the send button.
import React, { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Animated, Linking, Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { radius, space, type, useTheme } from '../theme';
import { Icon } from '../ui';
import { sendPhoto, sendText, sendTyping, sendVoice } from '../store';

const CANCEL_DISTANCE = 90; // points to slide left before a recording is thrown away
const MIN_MS = 700;         // shorter than this is a slip of the thumb, not a voice note

export function Composer({ chatId, bottomInset }: { chatId: number; bottomInset: number }) {
  const { c } = useTheme();
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const startedAt = useRef(0);
  const startX = useRef(0);
  const holding = useRef(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  function onChange(v: string) {
    setText(v);
    sendTyping(chatId, v.trim().length > 0);
  }

  function send() {
    if (!text.trim()) return;
    sendText(chatId, text);
    setText('');
  }

  // ---------- photo ----------
  async function pick(fromCamera: boolean) {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false };
    let res: ImagePicker.ImagePickerResult;
    if (fromCamera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return askSettings('the camera');
      res = await ImagePicker.launchCameraAsync(opts);
    } else res = await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    sendPhoto(chatId, { uri: a.uri, width: a.width, height: a.height }, text);
    setText('');
  }

  function photoMenu() {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Take a photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 },
      (i) => { if (i === 0) void pick(true); if (i === 1) void pick(false); },
    );
  }

  function askSettings(what: string) {
    Alert.alert(`Karaki needs ${what}`, `Allow ${what} for Karaki in Settings.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]);
  }

  // ---------- voice ----------
  async function startRecording() {
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) { holding.current = false; return askSettings('the microphone'); }
    if (!holding.current) return; // let go while the permission question was up
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      holding.current = false;
      return;
    }
    if (!holding.current) { await finish(false); return; }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    startedAt.current = Date.now();
    setElapsed(0);
    setCancelling(false);
    setRecording(true);
    tick.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
  }

  async function finish(keep: boolean) {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    const ms = Date.now() - startedAt.current;
    setRecording(false);
    try { await recorder.stop(); } catch { /* was not recording */ }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (keep && uri && ms >= MIN_MS) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      sendVoice(chatId, uri, ms);
    }
  }

  const responder = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false, // keep the touch while the thumb slides
    onResponderGrant: (e: any) => {
      holding.current = true;
      startX.current = e.nativeEvent.pageX;
      void startRecording();
    },
    onResponderMove: (e: any) => {
      setCancelling(startX.current - e.nativeEvent.pageX > CANCEL_DISTANCE);
    },
    onResponderRelease: (e: any) => {
      holding.current = false;
      const cancel = startX.current - e.nativeEvent.pageX > CANCEL_DISTANCE;
      if (recording || startedAt.current) void finish(!cancel);
      startedAt.current = 0;
    },
    onResponderTerminate: () => {
      holding.current = false;
      if (recording) void finish(false);
      startedAt.current = 0;
    },
  };

  const hasText = text.trim().length > 0;
  const secs = Math.floor(elapsed / 1000);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Math.max(bottomInset, space.sm), backgroundColor: c.linen, borderTopWidth: 1, borderTopColor: c.hairlineSoft }}>
      {recording ? (
        <View style={{ flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.field, backgroundColor: c.inset }}>
          <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger, opacity: pulse }} />
          <Text style={{ color: c.ink, fontSize: type.body, fontVariant: ['tabular-nums'] }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</Text>
          <Text style={{ flex: 1, textAlign: 'right', color: cancelling ? c.danger : c.inkFaint, fontSize: type.secondary }}>
            {cancelling ? 'Let go to cancel' : 'Slide left to cancel'}
          </Text>
        </View>
      ) : (
        <>
          <Pressable onPress={photoMenu} hitSlop={8} accessibilityRole="button" accessibilityLabel="Send a photo"
            style={({ pressed }) => ({ width: 36, height: 40, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Icon name="photo.on.rectangle" size={22} color={c.inkSoft} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={onChange}
            placeholder="Message"
            placeholderTextColor={c.inkGhost}
            multiline
            maxLength={8000}
            style={{
              flex: 1, minHeight: 40, maxHeight: 132, borderRadius: radius.field, backgroundColor: c.inset,
              paddingHorizontal: space.md, paddingTop: 10, paddingBottom: 10, color: c.ink, fontSize: type.body, lineHeight: 20,
            }}
          />
        </>
      )}
      {hasText && !recording ? (
        <Pressable onPress={send} accessibilityRole="button" accessibilityLabel="Send" hitSlop={6}
          style={({ pressed }) => ({ width: 36, height: 36, marginBottom: 2, borderRadius: radius.control, backgroundColor: c.terracotta, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Icon name="arrow.up" size={17} color={c.onTerracotta} weight="semibold" />
        </Pressable>
      ) : (
        <View {...responder} accessibilityRole="button" accessibilityLabel="Hold to record a voice note"
          style={{ width: 36, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, backgroundColor: recording ? (cancelling ? c.inset : c.terracotta) : 'transparent' }}>
          <Icon name={recording ? 'mic.fill' : 'mic'} size={21} color={recording ? (cancelling ? c.inkFaint : c.onTerracotta) : c.inkSoft} />
        </View>
      )}
    </View>
  );
}
