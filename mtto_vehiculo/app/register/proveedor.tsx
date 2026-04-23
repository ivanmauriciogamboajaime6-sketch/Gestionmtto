import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { API_BASE_URL } from "../../constants/api";
import storage from "../../constants/storage";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDER_SPECIALTIES = ["llantas", "bateria", "cambio de aceite", "general"] as const;
const sanitizePassword = (value: string) => value.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export default function RegisterProveedor() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");
  const [especialidades, setEspecialidades] = useState<(typeof PROVIDER_SPECIALTIES)[number][]>([]);

  async function registrar() {
    if (!nombre || !email || !telefono || !password || especialidades.length === 0) {
      Alert.alert("Error", "Todos los campos son obligatorios");
      return;
    }
    if (!EMAIL_REGEX.test(email.trim().toLowerCase())) {
      Alert.alert("Error", "Debes ingresar un correo valido");
      return;
    }
    if (!/^\d+$/.test(telefono.trim())) {
      Alert.alert("Error", "El celular debe contener solo numeros");
      return;
    }

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedNombre = nombre.trim();
      const normalizedTelefono = telefono.trim();
      const normalizedPassword = sanitizePassword(password);

      if (!normalizedPassword) {
        Alert.alert("Error", "Debes ingresar una contrasena valida");
        return;
      }

      const registerResponse = await fetch(`${API_BASE_URL}/proveedores/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre: normalizedNombre,
          email: normalizedEmail,
          telefono: normalizedTelefono,
          password: normalizedPassword,
          rol: "proveedor",
          especialidad: especialidades,
        }),
      });

      const registerData = await registerResponse.json();

      if (!registerResponse.ok || registerData.error) {
        Alert.alert("Error", registerData.error || "No se pudo crear el proveedor");
        return;
      }

      const loginResponse = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password: normalizedPassword,
        }),
      });

      const loginData = await loginResponse.json().catch(() => null);

      if (!loginResponse.ok || !loginData?.token) {
        Alert.alert("Exito", "Proveedor creado, pero no se pudo iniciar sesion automaticamente");
        router.replace("/");
        return;
      }

      await storage.setItem("token", loginData.token);
      await storage.setItem("user_name", loginData.nombre || normalizedNombre);
      await storage.setItem("user_role", loginData.rol || "proveedor");

      Alert.alert("Exito", "Proveedor registrado correctamente");
      router.replace("/(tabs)/profile");
    } catch (error) {
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  }

  function toggleEspecialidad(item: (typeof PROVIDER_SPECIALTIES)[number]) {
    setEspecialidades((current) =>
      current.includes(item)
        ? current.filter((value) => value !== item)
        : [...current, item]
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/select-role")}>
        <MaterialCommunityIcons name="arrow-left" size={18} color="#2563eb" />
        <Text style={styles.back}>Volver</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Registro proveedor</Text>

      <TextInput placeholder="Nombre del proveedor" style={styles.input} value={nombre} onChangeText={setNombre} />
      <TextInput
        placeholder="Correo"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        placeholder="Celular"
        style={styles.input}
        value={telefono}
        onChangeText={(value) => setTelefono(value.replace(/[^0-9]/g, ""))}
        keyboardType="phone-pad"
      />
      <View style={styles.specialtySection}>
        <Text style={styles.specialtyLabel}>Tipo de proveedor</Text>
        <View style={styles.specialtyGrid}>
          {PROVIDER_SPECIALTIES.map((item) => {
            const selected = especialidades.includes(item);
            return (
              <TouchableOpacity
                key={item}
                style={[styles.specialtyOption, selected && styles.specialtyOptionSelected]}
                onPress={() => toggleEspecialidad(item)}
              >
                <Text style={[styles.specialtyOptionText, selected && styles.specialtyOptionTextSelected]}>
                  {item === "bateria"
                    ? "Bateria"
                    : item === "llantas"
                      ? "Llantas"
                      : item === "cambio de aceite"
                        ? "Cambio de aceite"
                        : "General"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <TextInput placeholder="Contrasena" secureTextEntry style={styles.input} value={password} onChangeText={(value) => setPassword(sanitizePassword(value))} />

      <TouchableOpacity style={styles.button} onPress={registrar}>
        <Text style={styles.buttonText}>Crear cuenta</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 25 },
  backButton: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20 },
  back: { color: "#2563eb" },
  title: { fontSize: 26, fontWeight: "bold", marginBottom: 25, textAlign: "center" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 14,
    marginBottom: 15,
    borderRadius: 8,
  },
  specialtySection: {
    marginBottom: 15,
  },
  specialtyLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 10,
  },
  specialtyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  specialtyOption: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  specialtyOptionSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#dbeafe",
  },
  specialtyOptionText: {
    color: "#475569",
    fontWeight: "600",
  },
  specialtyOptionTextSelected: {
    color: "#1d4ed8",
  },
  button: {
    backgroundColor: "#2563eb",
    padding: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "bold",
  },
});
