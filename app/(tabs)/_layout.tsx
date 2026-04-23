import { Tabs, usePathname } from 'expo-router';
import React, { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    const rootTabRoutes = new Set([
      "/(tabs)",
      "/(tabs)/administrator",
      "/(tabs)/profile",
      "/(tabs)/taller",
    ]);

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (rootTabRoutes.has(pathname)) {
        return true;
      }

      return false;
    });

    return () => subscription.remove();
  }, [pathname]);

  return (
    <Tabs
      backBehavior="none"
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: { display: 'none' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="administrator"
        options={{
          title: 'Administrator',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="paperplane.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
