import AsyncStorage from "@react-native-async-storage/async-storage";

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
