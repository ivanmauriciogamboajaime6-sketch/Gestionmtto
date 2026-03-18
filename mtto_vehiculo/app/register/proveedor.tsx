import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { API_BASE_URL } from "../../constants/api";
import storage from "../../constants/storage";

export default function RegisterProveedor() {
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
      const registerResponse = await fetch(`${API_BASE_URL}/proveedores/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre,
          email,
          telefono,
          password,
          rol: "proveedor",
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
          email,
          password,
        }),
      });

      const loginData = await loginResponse.json();

      if (!loginData.token) {
        Alert.alert("Exito", "Proveedor creado, pero no se pudo iniciar sesion automaticamente");
        router.replace("/");
        return;
      }

      await storage.setItem("token", loginData.token);
      await storage.setItem("user_name", loginData.nombre || nombre);
      await storage.setItem("user_role", loginData.rol || "proveedor");

      Alert.alert("Exito", "Proveedor registrado correctamente");
      router.replace("/(tabs)/profile");
    } catch (error) {
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Volver</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Registro proveedor</Text>

      <TextInput placeholder="Nombre del proveedor" style={styles.input} onChangeText={setNombre} />
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
  back: { color: "#2563eb", marginBottom: 20 },
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
