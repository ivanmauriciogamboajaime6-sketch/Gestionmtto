import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { API_BASE_URL } from "../../constants/api";

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

    try {
      const response = await fetch(`${API_BASE_URL}/register/cliente`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre,
          email,
          telefono,
          password,
          rol: "cliente",
        }),
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert("Exito", "Cliente registrado");
        router.replace("/(tabs)");
      } else {
        Alert.alert("Error", data.detail || "No se pudo registrar");
      }
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
      <TextInput placeholder="Correo" style={styles.input} value={email} onChangeText={setEmail} />
      <TextInput placeholder="Telefono" style={styles.input} value={telefono} onChangeText={setTelefono} />
      <TextInput placeholder="Contrasena" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />

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
