import * as React from "react";
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../constants/api";
import storage from "../constants/storage";

const loginGarageBackground = require("../assets/images/login-garage-luxury.png");

const sanitizePassword = (value: string) => value.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export default function Login() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 430;
  const isNarrow = width < 360;

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  const redirigirPorRol = React.useCallback((role?: string | null) => {
    const route =
      role === "cliente"
        ? "/(tabs)"
        : role === "taller"
          ? "/(tabs)/taller"
          : role === "proveedor"
            ? "/(tabs)/profile"
            : role === "administrador"
              ? "/(tabs)/administrator"
              : null;

    if (!route) return false;

    if (Platform.OS === "web" && globalThis.location?.protocol === "file:") {
      return false;
    }

    router.replace(route as any);
    return true;
  }, [router]);

  async function handleLogin() {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = sanitizePassword(password);

      if (!normalizedPassword) {
        alert("Debes ingresar una contrasena valida");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: normalizedPassword,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        alert(data?.detail || data?.error || "No se pudo iniciar sesion");
        return;
      }

      if (!data?.token) {
        alert(data?.detail || data?.error || "Credenciales incorrectas");
        return;
      }

      await storage.setItem("token", data.token);
      await storage.setItem("user_name", data.nombre || "");
      await storage.setItem("user_role", data.rol || "");

      if (Platform.OS === "web") {
        globalThis.localStorage?.setItem("token", data.token);
        globalThis.localStorage?.setItem("user_name", data.nombre || "");
        globalThis.localStorage?.setItem("user_role", data.rol || "");
      }

      if (!redirigirPorRol(data.rol)) {
        alert("No se pudo abrir el modulo para este rol.");
      }
    } catch (error) {
      console.log("Error en login", error);
      alert("No se pudo conectar con el servidor");
    }
  }

  return (
    <View style={styles.container}>
      <ImageBackground source={loginGarageBackground} style={styles.backgroundImage} resizeMode="cover">
        <View style={styles.overlay} />
      </ImageBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.content, isCompact && styles.contentCompact]}>
            <View style={styles.brand}>
              <MaterialCommunityIcons name="car-cog" size={isCompact ? 28 : 34} color="#ffffff" />
              <Text style={[styles.brandText, isCompact && styles.brandTextCompact]}>MecaniControl</Text>
            </View>

            <Text style={[styles.title, isCompact && styles.titleCompact]}>Bienvenido</Text>
            <Text style={[styles.subtitle, isCompact && styles.subtitleCompact]}>
              Gestiona tus servicios automotrices de manera facil y eficiente.
            </Text>

            <View style={[styles.loginCard, isCompact && styles.loginCardCompact]}>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="account-outline"
                  size={20}
                  color="#9aa4b2"
                  style={styles.icon}
                />
                <TextInput
                  placeholder="Usuario"
                  placeholderTextColor="#9aa4b2"
                  style={[styles.input, isCompact && styles.inputCompact]}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={20}
                  color="#9aa4b2"
                  style={styles.icon}
                />
                <TextInput
                  placeholder="Contrasena"
                  placeholderTextColor="#9aa4b2"
                  secureTextEntry={!showPassword}
                  style={[styles.input, isCompact && styles.inputCompact]}
                  value={password}
                  onChangeText={(value) => setPassword(sanitizePassword(value))}
                />
                <TouchableOpacity onPress={() => setShowPassword((current) => !current)}>
                  <MaterialCommunityIcons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#9aa4b2"
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.button, isCompact && styles.buttonCompact]} onPress={handleLogin}>
                <Text style={styles.buttonText}>Ingresar</Text>
              </TouchableOpacity>

              <Text style={[styles.registerText, isCompact && styles.registerTextCompact]}>
                No tienes cuenta?{" "}
                <Text style={styles.register} onPress={() => router.push("/select-role")}>
                  Registrate
                </Text>
              </Text>
            </View>

            <Image
              source={loginGarageBackground}
              style={[styles.heroCar, isCompact && styles.heroCarCompact]}
              resizeMode="cover"
            />

            <View style={[styles.featureRow, isCompact && styles.featureRowCompact]}>
              {[
                { icon: "garage", title: "Talleres", text: "Administra tus talleres" },
                { icon: "clipboard-text-outline", title: "Solicitudes", text: "Da seguimiento a solicitudes" },
                { icon: "chart-box-outline", title: "Reportes", text: "Analiza metricas y resultados" },
              ].map((item) => (
                <View
                  key={item.title}
                  style={[
                    styles.featureCard,
                    isCompact && styles.featureCardCompact,
                    isNarrow && styles.featureCardSingleColumn,
                  ]}
                >
                  <View style={[styles.featureIconWrap, isCompact && styles.featureIconWrapCompact]}>
                    <MaterialCommunityIcons name={item.icon as any} size={isCompact ? 24 : 30} color="#ffffff" />
                  </View>
                  <Text style={[styles.featureTitle, isCompact && styles.featureTitleCompact]}>{item.title}</Text>
                  <Text style={[styles.featureText, isCompact && styles.featureTextCompact]}>{item.text}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09111d",
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,12,19,0.5)",
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 68,
    paddingBottom: 32,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  contentCompact: {
    paddingHorizontal: 16,
    paddingTop: 34,
    paddingBottom: 22,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b111b",
  },
  loadingText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
  },
  brandText: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    marginLeft: 10,
  },
  brandTextCompact: {
    fontSize: 22,
    marginLeft: 8,
  },
  title: {
    fontSize: 50,
    color: "#ffffff",
    fontWeight: "800",
    marginBottom: 8,
  },
  titleCompact: {
    fontSize: 34,
    lineHeight: 40,
  },
  subtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 21,
    lineHeight: 30,
    maxWidth: 440,
    marginBottom: 24,
  },
  subtitleCompact: {
    fontSize: 18,
    lineHeight: 26,
    marginBottom: 18,
  },
  loginCard: {
    backgroundColor: "rgba(17,22,31,0.84)",
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
    marginBottom: 22,
  },
  loginCardCompact: {
    borderRadius: 22,
    padding: 14,
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 30,
    paddingHorizontal: 15,
    marginBottom: 14,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: "#ffffff",
    paddingVertical: 14,
    fontSize: 16,
  },
  inputCompact: {
    paddingVertical: 12,
    fontSize: 15,
  },
  button: {
    backgroundColor: "#4c9cff",
    paddingVertical: 15,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 10,
  },
  buttonCompact: {
    marginTop: 6,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16,
  },
  registerText: {
    marginTop: 18,
    color: "#d0d5dd",
    textAlign: "center",
  },
  registerTextCompact: {
    marginTop: 14,
    fontSize: 14,
  },
  register: {
    color: "#4c9cff",
    fontWeight: "800",
  },
  heroCar: {
    width: "100%",
    height: 240,
    borderRadius: 26,
    marginBottom: 22,
  },
  heroCarCompact: {
    height: 180,
    borderRadius: 20,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  featureRowCompact: {
    gap: 10,
  },
  featureCard: {
    flex: 1,
    minHeight: 164,
    minWidth: 0,
    backgroundColor: "rgba(17,22,31,0.84)",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    justifyContent: "space-between",
  },
  featureCardCompact: {
    minHeight: 132,
    padding: 14,
    flexBasis: "48%",
  },
  featureCardSingleColumn: {
    flexBasis: "100%",
  },
  featureIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(76,156,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureIconWrapCompact: {
    width: 46,
    height: 46,
    borderRadius: 15,
  },
  featureTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 16,
  },
  featureTitleCompact: {
    fontSize: 16,
    marginTop: 12,
  },
  featureText: {
    color: "rgba(255,255,255,0.72)",
    lineHeight: 20,
    marginTop: 8,
  },
  featureTextCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
});
