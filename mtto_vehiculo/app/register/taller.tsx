import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { API_BASE_URL } from "../../constants/api";

export default function RegisterTaller() {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");

  async function registrar() {
    if (!nombre || !email || !telefono || !password) {
      Alert.alert("Error", "Todos los campos son obligatorios");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/talleres/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre,
          email,
          telefono,
          password,
          rol: "taller",
        }),
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        Alert.alert("Exito", "Taller registrado");
        router.replace("/");
        return;
      }

      Alert.alert("Error", data?.detail || "No se pudo registrar el taller");
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

      <Text style={styles.title}>Registro Taller</Text>

      <TextInput placeholder="Nombre del taller" style={styles.input} onChangeText={setNombre} />
      <TextInput placeholder="Correo" style={styles.input} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput placeholder="Telefono" style={styles.input} onChangeText={setTelefono} />
      <TextInput placeholder="Contrasena" secureTextEntry style={styles.input} onChangeText={setPassword} />

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
