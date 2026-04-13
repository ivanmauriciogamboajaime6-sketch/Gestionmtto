import Constants from "expo-constants";
import { Platform } from "react-native";

const hostUri =
  Constants.expoConfig?.hostUri ||
  Constants.manifest2?.extra?.expoClient?.hostUri ||
  Constants.manifest?.hostUri ||
  "";

const host = hostUri.split(":")[0];
const webHost =
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.hostname
    : "";

export const API_BASE_URL = host
  ? `http://${host}:8000`
  : webHost
    ? `http://${webHost === "localhost" ? "127.0.0.1" : webHost}:8000`
    : Platform.OS === "android"
      ? "http://10.0.2.2:8000"
      : "http://127.0.0.1:8000";
