import * as React from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../constants/api";
import storage from "../constants/storage";
export default function Login() {
  const router = useRouter();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isCheckingSession, setIsCheckingSession] = React.useState(true);

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

    if (!route) {
      return false;
    }

    if (Platform.OS === "web" && globalThis.location?.protocol === "file:") {
      return false;
    }

    router.replace(route as any);
    return true;
  }, [router]);

  React.useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      try {
        const token = await storage.getItem("token");
        const role = await storage.getItem("user_role");

        if (!isMounted) {
          return;
        }

        if (!token) {
          setIsCheckingSession(false);
          return;
        }

        if (!redirigirPorRol(role)) {
          setIsCheckingSession(false);
        }
      } catch (error) {
        console.log("Error restaurando sesion", error);
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, [redirigirPorRol]);

  async function handleLogin() {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password: password,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      setIsCheckingSession(false);
      alert(data?.detail || data?.error || "No se pudo iniciar sesion");
      return;
    }

    if (data?.token) {

      // guardar token
      await storage.setItem("token", data.token);
      await storage.setItem("user_name", data.nombre || "");
      await storage.setItem("user_role", data.rol || "");

      if (Platform.OS === "web") {
        globalThis.localStorage?.setItem("token", data.token);
        globalThis.localStorage?.setItem("user_name", data.nombre || "");
        globalThis.localStorage?.setItem("user_role", data.rol || "");
      }

      // redirección según rol
      if (!redirigirPorRol(data.rol)) {
        setIsCheckingSession(false);
      }

    } else {
      alert(data?.detail || data?.error || "Credenciales incorrectas");
      setIsCheckingSession(false);
    }

  } catch (error) {
    console.log("Error en login", error);
    setIsCheckingSession(false);
    alert("No se pudo conectar con el servidor");
  }
}
  if (isCheckingSession) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <Text style={styles.loadingText}>Cargando sesion...</Text>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={["#0f2027", "#203a43", "#2c5364"]}
      style={styles.container}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <MaterialCommunityIcons name="car-cog" size={40} color="#fff" />
            <Text style={styles.brandText}>Neogest Auto</Text>
          </View>

          <Text style={styles.title}>Welcome</Text>

          <View style={styles.inputContainer}>
            <MaterialCommunityIcons
              name="account-outline"
              size={20}
              color="#aaa"
              style={styles.icon}
            />

            <TextInput
              placeholder="Username"
              placeholderTextColor="#aaa"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <MaterialCommunityIcons
              name="lock-outline"
              size={20}
              color="#aaa"
              style={styles.icon}
            />

            <TextInput
              placeholder="Password"
              placeholderTextColor="#aaa"
              secureTextEntry={!showPassword}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
            />

            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <MaterialCommunityIcons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color="#aaa"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleLogin}>
            <Text style={styles.buttonText}>Ingresar</Text>
          </TouchableOpacity>

          <Text style={styles.registerText}>
            ¿No tienes cuenta?{" "}
            <Text
              style={styles.register}
              onPress={() => router.push("/select-role")}
            >
              Regístrate
            </Text>
          </Text>
        </View>

        <Image
          source={{
           uri: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?q=80&w=1200",
          }}
          style={styles.car}
          resizeMode="cover"
        />
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 28,
  },

  content: {
    marginTop: 120,
  },

  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f2027",
  },

  loadingText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  brand: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  brandText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    marginLeft: 8,
  },

  title: {
    fontSize: 34,
    color: "#fff",
    fontWeight: "bold",
    marginBottom: 30,
  },

  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff22",
    borderRadius: 30,
    paddingHorizontal: 15,
    marginBottom: 14,
  },

  icon: {
    marginRight: 8,
  },

  input: {
    flex: 1,
    color: "#fff",
    paddingVertical: 14,
  },

  button: {
    backgroundColor: "#ff3b30",
    paddingVertical: 15,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 10,
  },

  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },

  registerText: {
    marginTop: 20,
    color: "#ccc",
  },

  register: {
    color: "#ff3b30",
    fontWeight: "bold",
  },

  car: {
    width: "100%",
    height: 180,
    marginTop: 40,
    borderRadius: 20,
  },
});
