// A photo, full screen on black. Tap Done (or swipe down) to go back.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ScreenProps } from '../nav';

export function Photo({ route, navigation }: ScreenProps<'Photo'>) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0A08' }}>
      <Image source={{ uri: route.params.uri, headers: route.params.headers }} style={{ flex: 1 }} contentFit="contain" cachePolicy="disk" />
      <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button"
        style={({ pressed }) => ({ position: 'absolute', top: insets.top + 8, right: 16, height: 32, paddingHorizontal: 12, borderRadius: 8, backgroundColor: 'rgba(255,250,240,0.14)', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ color: '#F5EEE3', fontSize: 15, fontWeight: '600' }}>Done</Text>
      </Pressable>
    </View>
  );
}
