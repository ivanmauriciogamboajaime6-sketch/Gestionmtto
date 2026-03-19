import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useState } from "react";
import { router } from "expo-router";
import { API_BASE_URL } from "../../constants/api";

export default function RegisterCliente() {

  const [nombre,setNombre] = useState("");
  const [email,setEmail] = useState("");
  const [telefono,setTelefono] = useState("");
  const [password,setPassword] = useState("");

  async function registrar(){

    if(!nombre || !email || !telefono || !password){
      Alert.alert("Error","Todos los campos son obligatorios");
      return;
    }

    try{

      const response = await fetch(`${API_BASE_URL}/register/cliente`,{
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          nombre,
          email,
          telefono,
          password,
          rol:"cliente"
        })
      });

      const data = await response.json();

      if(response.ok){
        Alert.alert("Éxito","Cliente registrado");
        router.replace("/(tabs)");
      }else{
        Alert.alert("Error",data.detail || "No se pudo registrar");
      }

    }catch(error){
      Alert.alert("Error","No se pudo conectar al servidor");
    }

  }

  return(

    <View style={styles.container}>

      <TouchableOpacity onPress={() => router.replace("/select-role")}>
        <Text style={styles.back}>← Volver</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Registro Cliente</Text>

      <TextInput
        placeholder="Nombre"
        style={styles.input}
        value={nombre}
        onChangeText={setNombre}
      />

      <TextInput
        placeholder="Correo"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />

      <TextInput
        placeholder="Teléfono"
        style={styles.input}
        value={telefono}
        onChangeText={setTelefono}
      />

      <TextInput
        placeholder="Contraseña"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.button} onPress={registrar}>
        <Text style={styles.buttonText}>Crear cuenta</Text>
      </TouchableOpacity>

    </View>

  )
}

const styles = StyleSheet.create({

  container:{
    flex:1,
    justifyContent:"center",
    padding:25,
    backgroundColor:"#fff"
  },

  back:{
    color:"#2563eb",
    marginBottom:20,
    fontSize:16
  },

  title:{
    fontSize:26,
    fontWeight:"bold",
    marginBottom:25,
    textAlign:"center"
  },

  input:{
    borderWidth:1,
    borderColor:"#ccc",
    padding:14,
    marginBottom:15,
    borderRadius:8
  },

  button:{
    backgroundColor:"#2563eb",
    padding:16,
    borderRadius:8
  },

  buttonText:{
    color:"#fff",
    textAlign:"center",
    fontWeight:"bold",
    fontSize:16
  }

});
