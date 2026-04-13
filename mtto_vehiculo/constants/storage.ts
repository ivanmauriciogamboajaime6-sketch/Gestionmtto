import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

type SessionMap = Record<string, string>;

declare global {
  var __MTTO_SESSION__: SessionMap | undefined;
}

function memoryStore() {
  if (!globalThis.__MTTO_SESSION__) {
    globalThis.__MTTO_SESSION__ = {};
  }

  return globalThis.__MTTO_SESSION__;
}

function isLegacyStorageMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Native module is null");
}

const storage = {
  async getItem(key: string) {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch (error) {
        console.log("Storage fallback getItem web", error);
        return memoryStore()[key] ?? null;
      }
    }

    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      if (!isLegacyStorageMissing(error)) {
        console.log("Storage fallback getItem", error);
      }
      return memoryStore()[key] ?? null;
    }
  },

  async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(key, value);
        return;
      } catch (error) {
        console.log("Storage fallback setItem web", error);
        memoryStore()[key] = value;
        return;
      }
    }

    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      if (!isLegacyStorageMissing(error)) {
        console.log("Storage fallback setItem", error);
      }
      memoryStore()[key] = value;
    }
  },

  async removeItem(key: string) {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(key);
        return;
      } catch (error) {
        console.log("Storage fallback removeItem web", error);
        delete memoryStore()[key];
        return;
      }
    }

    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      if (!isLegacyStorageMissing(error)) {
        console.log("Storage fallback removeItem", error);
      }
      delete memoryStore()[key];
    }
  },
};

export default storage;
