import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { API_BASE_URL } from "../../constants/api";
import storage from "../../constants/storage";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sanitizePassword = (value: string) => value.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export default function RegisterCliente() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");

  async function registrar() {
    if (!nombre || !email || !telefono || !password) {
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

      const response = await fetch(`${API_BASE_URL}/register/cliente`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre: normalizedNombre,
          email: normalizedEmail,
          telefono: normalizedTelefono,
          password: normalizedPassword,
          rol: "cliente",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo registrar");
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
        Alert.alert("Exito", "Cliente registrado, pero no se pudo iniciar sesion automaticamente");
        router.replace("/");
        return;
      }

      await storage.setItem("token", loginData.token);
      await storage.setItem("user_name", loginData.nombre || normalizedNombre);
      await storage.setItem("user_role", loginData.rol || "cliente");

      Alert.alert("Exito", "Cliente registrado correctamente");
      router.replace("/(tabs)");
    } catch (error) {
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/select-role")}>
        <MaterialCommunityIcons name="arrow-left" size={18} color="#2563eb" />
        <Text style={styles.back}>Volver</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Registro Cliente</Text>

      <TextInput placeholder="Nombre" style={styles.input} value={nombre} onChangeText={setNombre} />
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
      <TextInput placeholder="Contrasena" secureTextEntry style={styles.input} value={password} onChangeText={(value) => setPassword(sanitizePassword(value))} />

      <TouchableOpacity style={styles.button} onPress={registrar}>
        <Text style={styles.buttonText}>Crear cuenta</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 25,
    backgroundColor: "#fff",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  back: {
    color: "#2563eb",
    fontSize: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 25,
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 14,
    marginBottom: 15,
    borderRadius: 8,
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
    fontSize: 16,
  },
});
