import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";

export default function SelectRole() {

  return (

    <View style={styles.container}>

      <Text style={styles.title}>Selecciona tu tipo de cuenta</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push("/register/cliente")}
      >
        <Text style={styles.buttonText}>Soy Cliente</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push("/register/taller")}
      >
        <Text style={styles.buttonText}>Soy Taller</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push("/register/proveedor")}
      >
        <Text style={styles.buttonText}>Soy Proveedor</Text>
      </TouchableOpacity>

    </View>

  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
    backgroundColor: "#0f2027"
  },

  title: {
    fontSize: 24,
    color: "#fff",
    marginBottom: 30,
    fontWeight: "bold"
  },

  button: {
    backgroundColor: "#ff3b30",
    padding: 15,
    borderRadius: 30,
    width: "80%",
    alignItems: "center",
    marginBottom: 15
  },

  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16
  }

});