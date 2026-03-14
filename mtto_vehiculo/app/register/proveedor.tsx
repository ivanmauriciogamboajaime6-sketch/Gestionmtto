import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useState } from "react";
import { router } from "expo-router";

export default function RegisterTaller(){

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

      const response = await fetch("http://localhost:8000/auth/register",{
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          nombre,
          email,
          telefono,
          password,
          rol:"proveedor"
        })
      });

      const data = await response.json();

      if(response.ok){
        Alert.alert("Éxito","Taller registrado");
        router.replace("/login");
      }

    }catch(error){
      Alert.alert("Error","No se pudo conectar al servidor");
    }

  }

  return(

    <View style={styles.container}>

      <TouchableOpacity onPress={()=>router.back()}>
        <Text style={styles.back}>← Volver</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Registro proveedor</Text>

      <TextInput placeholder="Nombre del proveedor" style={styles.input} onChangeText={setNombre}/>
      <TextInput placeholder="Correo" style={styles.input} onChangeText={setEmail}/>
      <TextInput placeholder="Teléfono" style={styles.input} onChangeText={setTelefono}/>
      <TextInput placeholder="Contraseña" secureTextEntry style={styles.input} onChangeText={setPassword}/>

      <TouchableOpacity style={styles.button} onPress={registrar}>
        <Text style={styles.buttonText}>Crear cuenta</Text>
      </TouchableOpacity>

    </View>

  )
}

const styles = StyleSheet.create({

  container:{ flex:1,justifyContent:"center",padding:25 },
  back:{ color:"#2563eb",marginBottom:20 },
  title:{ fontSize:26,fontWeight:"bold",marginBottom:25,textAlign:"center" },

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
    fontWeight:"bold"
  }

});