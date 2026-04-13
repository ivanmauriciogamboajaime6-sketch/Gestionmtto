import { Redirect, Tabs, usePathname } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import storage from '@/constants/storage';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      try {
        const token = await storage.getItem("token");
        if (!isMounted) {
          return;
        }
        setHasSession(Boolean(token));
      } catch (error) {
        console.log("Error validando sesion en tabs", error);
        if (!isMounted) {
          return;
        }
        setHasSession(false);
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    loadSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isCheckingSession || !hasSession || Platform.OS !== "android") {
      return;
    }

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
  }, [hasSession, isCheckingSession, pathname]);

  if (isCheckingSession) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
        }}
      >
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!hasSession) {
    return <Redirect href="/" />;
  }

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
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="taller"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="service-request"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="vehicles/create"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
