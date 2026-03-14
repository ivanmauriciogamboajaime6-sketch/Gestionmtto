import { View, Text, StyleSheet } from "react-native";

export default function Dashboard(){

  return(
    <View style={styles.container}>

      <Text style={styles.title}>Dashboard</Text>

      <Text style={styles.card}>Vehículos registrados</Text>

      <Text style={styles.card}>Próximos mantenimientos</Text>

      <Text style={styles.card}>Cotizaciones pendientes</Text>

    </View>
  )
}

const styles = StyleSheet.create({
  container:{ flex:1, padding:20 },
  title:{ fontSize:28, fontWeight:"bold", marginBottom:20 },
  card:{
    backgroundColor:"#f3f4f6",
    padding:20,
    borderRadius:10,
    marginBottom:10
  }
});