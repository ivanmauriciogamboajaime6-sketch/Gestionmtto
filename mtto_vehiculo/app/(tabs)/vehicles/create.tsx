import React, { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE_URL } from "../../../constants/api";
import { formatNumberWithDots, parseFormattedNumber } from "../../../constants/formatters";
import storage from "../../../constants/storage";

const carFuelOptions = ["gasolina", "gas", "diesel"];
const motoFuelOptions = ["gasolina", "electrica"];
const MAX_KILOMETRAJE = 2147483647;

export default function CreateVehicle() {
  const [tipoVehiculo, setTipoVehiculo] = useState<"carro" | "moto" | "">("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [placa, setPlaca] = useState("");
  const [kilometraje, setKilometraje] = useState("");
  const [combustible, setCombustible] = useState("");
  const [showYearOptions, setShowYearOptions] = useState(false);

  const fuelOptions = tipoVehiculo === "moto" ? motoFuelOptions : carFuelOptions;
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1970 + 1 }, (_, index) => String(currentYear - index));
  }, []);

  const limpiarFormulario = useCallback(() => {
    setTipoVehiculo("");
    setMarca("");
    setModelo("");
    setAnio("");
    setPlaca("");
    setKilometraje("");
    setCombustible("");
    setShowYearOptions(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      limpiarFormulario();
    }, [limpiarFormulario])
  );

  const guardarVehiculo = async () => {
    try {
      if (!tipoVehiculo) {
        alert("Debes seleccionar si es carro o moto");
        return;
      }

      if (!marca || !modelo || !anio || !placa || !kilometraje || !combustible) {
        alert("Todos los campos son obligatorios");
        return;
      }

      const kilometrajeValue = parseFormattedNumber(kilometraje);

      if (isNaN(Number(anio)) || !kilometrajeValue) {
        alert("Año y kilometraje deben ser numeros");
        return;
      }

      if (kilometrajeValue > MAX_KILOMETRAJE) {
        alert("El kilometraje supera el limite permitido");
        return;
      }

      if (placa.trim().length > 10) {
        alert("La placa no puede superar los 10 caracteres");
        return;
      }

      const token = await storage.getItem("token");

      if (!token) {
        alert("Sesion expirada. Inicia sesion nuevamente.");
        router.replace("/");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/vehiculos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tipo_vehiculo: tipoVehiculo,
          marca,
          modelo,
          anio: Number(anio),
          placa,
          kilometraje: kilometrajeValue,
          combustible,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.detail || data.error || "No se pudo registrar el vehiculo");
        return;
      }

      alert(`${tipoVehiculo === "carro" ? "Carro" : "Moto"} agregado correctamente`);
      router.replace("/(tabs)");
    } catch (error) {
      console.log("Error:", error);
      alert("Error conectando con el servidor");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/(tabs)")}>
        <Text style={styles.backButtonText}>Regresar</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Registrar vehiculo</Text>
      <Text style={styles.subtitle}>Primero selecciona el tipo de vehiculo.</Text>

      <View style={styles.selectorRow}>
        {["carro", "moto"].map((tipo) => {
          const selected = tipoVehiculo === tipo;

          return (
            <TouchableOpacity
              key={tipo}
              style={[styles.selectorCard, selected && styles.selectorCardActive]}
              onPress={() => {
                limpiarFormulario();
                setTipoVehiculo(tipo as "carro" | "moto");
              }}
            >
              <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                {selected ? <View style={styles.radioInner} /> : null}
              </View>
              <Text style={[styles.selectorText, selected && styles.selectorTextActive]}>
                {tipo === "carro" ? "Carro" : "Moto"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tipoVehiculo ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            Formulario de {tipoVehiculo === "carro" ? "carro" : "moto"}
          </Text>

          <TextInput
            placeholder="Marca *"
            style={styles.input}
            value={marca}
            onChangeText={(value) => setMarca(value.slice(0, 15))}
            maxLength={15}
          />

          <TextInput
            placeholder="Modelo *"
            style={styles.input}
            value={modelo}
            onChangeText={(value) => setModelo(value.slice(0, 15))}
            maxLength={15}
          />

          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowYearOptions((current) => !current)}
          >
            <Text style={anio ? styles.inputText : styles.placeholderText}>{anio || "Año *"}</Text>
          </TouchableOpacity>

          {showYearOptions ? (
            <ScrollView style={styles.yearList} nestedScrollEnabled>
              <View style={styles.yearGrid}>
                {availableYears.map((year) => (
                  <TouchableOpacity
                    key={year}
                    style={[styles.yearItem, anio === year && styles.yearItemActive]}
                    onPress={() => {
                      setAnio(year);
                      setShowYearOptions(false);
                    }}
                  >
                    <Text style={[styles.yearItemText, anio === year && styles.yearItemTextActive]}>
                      {year}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : null}

          <TextInput
            placeholder="Placa *"
            autoCapitalize="characters"
            style={styles.input}
            value={placa}
            onChangeText={(value) => setPlaca(value.toUpperCase().slice(0, 10))}
            maxLength={10}
          />

          <TextInput
            placeholder="Kilometraje *"
            keyboardType="numeric"
            style={styles.input}
            value={kilometraje}
            onChangeText={(value) =>
              setKilometraje(formatNumberWithDots(value.replace(/\D/g, "").slice(0, 9)))
            }
            maxLength={11}
          />

          <Text style={styles.inputLabel}>Tipo de combustible *</Text>
          <View style={styles.fuelList}>
            {fuelOptions.map((option) => {
              const selected = combustible === option;

              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.fuelCard, selected && styles.fuelCardActive]}
                  onPress={() => setCombustible(option)}
                >
                  <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                  <Text style={[styles.fuelText, selected && styles.selectorTextActive]}>
                    {option === "diesel"
                      ? "Diesel"
                      : option === "electrica"
                        ? "Electrica"
                        : option.charAt(0).toUpperCase() + option.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.button} onPress={guardarVehiculo}>
            <Text style={styles.buttonText}>Guardar vehiculo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.helperCard}>
          <Text style={styles.helperText}>Selecciona carro o moto para desplegar el formulario.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8",
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#162033",
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backButtonText: {
    color: "#2563eb",
    fontWeight: "700",
  },
  subtitle: {
    color: "#64748b",
    marginBottom: 18,
  },
  selectorRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 18,
  },
  selectorCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  selectorCardActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eef4ff",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterActive: {
    borderColor: "#2563eb",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#2563eb",
  },
  selectorText: {
    marginLeft: 12,
    color: "#334155",
    fontWeight: "700",
  },
  selectorTextActive: {
    color: "#162033",
  },
  formCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  formTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#162033",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e4e4e4",
  },
  inputText: {
    color: "#162033",
  },
  placeholderText: {
    color: "#6b7280",
  },
  yearList: {
    maxHeight: 220,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    borderRadius: 12,
    overflow: "hidden",
  },
  yearGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 8,
    gap: 8,
  },
  yearItem: {
    width: "31%",
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eef2f7",
    borderRadius: 10,
    alignItems: "center",
  },
  yearItemActive: {
    backgroundColor: "#eef4ff",
  },
  yearItemText: {
    color: "#334155",
    fontWeight: "600",
  },
  yearItemTextActive: {
    color: "#2563eb",
  },
  inputLabel: {
    color: "#334155",
    fontWeight: "700",
    marginBottom: 10,
    marginTop: 4,
  },
  fuelList: {
    gap: 10,
    marginBottom: 14,
  },
  fuelCard: {
    backgroundColor: "#f8fbff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    flexDirection: "row",
    alignItems: "center",
  },
  fuelCardActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eef4ff",
  },
  fuelText: {
    marginLeft: 12,
    color: "#334155",
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#2b7cff",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  helperCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  helperText: {
    color: "#64748b",
  },
});
