import { View, Text, TextInput, Button, StyleSheet, ScrollView, Alert } from "react-native";
import { useState } from "react";

export default function Vehicles() {

  const [marca,setMarca] = useState("");
  const [modelo,setModelo] = useState("");
  const [anio,setAnio] = useState("");
  const [kilometraje,setKilometraje] = useState("");
  const [placa,setPlaca] = useState("");

  const registrarVehiculo = () => {

    const data = {
      marca,
      modelo,
      anio,
      kilometraje,
      placa
    };

    console.log(data);

    Alert.alert("Vehículo registrado");

  };

  return (

    <ScrollView style={styles.container}>

      <Text style={styles.title}>Registrar Vehículo</Text>

      <TextInput
        placeholder="Marca"
        style={styles.input}
        value={marca}
        onChangeText={setMarca}
      />

      <TextInput
        placeholder="Modelo"
        style={styles.input}
        value={modelo}
        onChangeText={setModelo}
      />

      <TextInput
        placeholder="Año"
        style={styles.input}
        keyboardType="numeric"
        value={anio}
        onChangeText={setAnio}
      />

      <TextInput
        placeholder="Kilometraje"
        style={styles.input}
        keyboardType="numeric"
        value={kilometraje}
        onChangeText={setKilometraje}
      />

      <TextInput
        placeholder="Placa"
        style={styles.input}
        value={placa}
        onChangeText={setPlaca}
      />

      <Button
        title="Guardar Vehículo"
        onPress={registrarVehiculo}
      />

    </ScrollView>

  );

}

const styles = StyleSheet.create({

container:{
flex:1,
padding:20
},

title:{
fontSize:24,
marginBottom:20,
fontWeight:"bold"
},

input:{
borderWidth:1,
borderColor:"#ccc",
padding:12,
marginBottom:15,
borderRadius:8
}

});