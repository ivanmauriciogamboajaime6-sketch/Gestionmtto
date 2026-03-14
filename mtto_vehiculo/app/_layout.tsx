import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack initialRouteName="login" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="select-role" />
      <Stack.Screen name="register/cliente" />
      <Stack.Screen name="register/taller" />
      <Stack.Screen name="register/proveedor" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}