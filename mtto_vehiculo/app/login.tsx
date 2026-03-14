import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useState } from "react";

export default function Login() {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <View style={styles.container}>

      <Text style={styles.title}>MTTO Vehicular</Text>

      <TextInput
        placeholder="Correo"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        placeholder="Contraseña"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.replace("/(tabs)")}
      >
        <Text style={styles.buttonText}>Ingresar</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push("/select-role")}>
        <Text style={styles.link}>Crear cuenta</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container:{
    flex:1,
    justifyContent:"center",
    padding:20
  },
  title:{
    fontSize:28,
    fontWeight:"bold",
    marginBottom:40,
    textAlign:"center"
  },
  input:{
    borderWidth:1,
    borderColor:"#ccc",
    padding:12,
    borderRadius:8,
    marginBottom:15
  },
  button:{
    backgroundColor:"#2563eb",
    padding:15,
    borderRadius:8
  },
  buttonText:{
    color:"#fff",
    textAlign:"center",
    fontWeight:"bold"
  },
  link:{
    marginTop:20,
    textAlign:"center",
    color:"#2563eb"
  }
});