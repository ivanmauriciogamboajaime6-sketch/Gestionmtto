import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";

export default function SelectRole() {

  return (
    <View style={styles.container}>

      <Text style={styles.title}>Selecciona tu tipo de cuenta</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push({ pathname: "/register/cliente" })}
      >
        <Text style={styles.text}>Cliente</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push({ pathname: "/register/taller" })}
      >
        <Text style={styles.text}>Taller</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push({ pathname: "/register/proveedor" })}
      >
        <Text style={styles.text}>Proveedor</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, justifyContent:"center", padding:20 },
  title:{ fontSize:26, fontWeight:"bold", marginBottom:30, textAlign:"center" },
  button:{ backgroundColor:"#2563eb", padding:18, borderRadius:10, marginBottom:15 },
  text:{ color:"#fff", textAlign:"center", fontWeight:"bold" }
});