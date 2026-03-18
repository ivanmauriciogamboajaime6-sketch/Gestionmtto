import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { API_BASE_URL } from "../../constants/api";
import storage from "../../constants/storage";

type Vehiculo = {
  id?: number | string;
  marca?: string;
  modelo?: string;
  anio?: number | string;
  kilometraje?: number | string;
  placa?: string;
};

type Taller = {
  id: string;
  nombre: string;
  calificacion: string;
  distancia: string;
  tiempo: string;
  email?: string;
  telefono?: string;
};

const serviceGroups = [
  {
    title: "Mantenimiento preventivo",
    description: "Servicios tipicos",
    services: [
      "Cambio de aceite y filtros",
      "Revision general",
      "Alineacion y balanceo",
      "Rotacion de llantas",
      "Cambio de pastillas de freno",
      "Revision de suspension",
      "Revision de bateria",
    ],
  },
  {
    title: "Reparacion mecanica",
    description: "Cuando el vehiculo tiene una falla",
    services: [
      "Reparacion motor",
      "Reparacion transmision",
      "Cambio embrague",
      "Reparacion suspension",
      "Cambio bomba gasolina",
      "Cambio radiador",
      "Reparacion frenos",
    ],
  },
  {
    title: "Diagnostico electronico",
    description: "Muy importante hoy en dia",
    services: [
      "Escaneo computador vehiculo",
      "Diagnostico de sensores",
      "Diagnostico de motor",
      "Diagnostico electrico",
      "Revision testigos tablero",
    ],
  },
  {
    title: "Servicios rapidos",
    description: "Servicios que duran poco tiempo",
    services: [
      "Cambio de llanta",
      "Cambio bateria",
      "Cambio bombillos",
      "Revision niveles",
      "Reparacion pinchazo",
    ],
  },
  {
    title: "Servicios especializados",
    description: "Mas tecnicos",
    services: [
      "Aire acondicionado",
      "Sistema electrico",
      "Reparacion frenos",
      "Suspension",
      "Direccion",
      "Sistema combustible",
    ],
  },
];

const fallbackTalleres: Taller[] = [
  { id: "1", nombre: "RenovAutos", calificacion: "4.8", distancia: "2.1 km", tiempo: "15 min" },
  { id: "2", nombre: "Garage Motors", calificacion: "4.7", distancia: "3.4 km", tiempo: "22 min" },
  { id: "3", nombre: "AutoFix Center", calificacion: "4.6", distancia: "4.2 km", tiempo: "28 min" },
];

const fallbackVehiculos: Vehiculo[] = [
  { id: "f-1", marca: "Toyota", modelo: "Corolla", placa: "ABC123", anio: 2022, kilometraje: 45210 },
  { id: "f-2", marca: "Mazda", modelo: "3", placa: "KHT234", anio: 2020, kilometraje: 38900 },
];

export default function ServiceRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    vehicleId?: string;
    plate?: string;
    brand?: string;
    model?: string;
    mileage?: string;
    year?: string;
  }>();

  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [talleres, setTalleres] = useState<Taller[]>(fallbackTalleres);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(params.vehicleId ?? null);
  const [selectedService, setSelectedService] = useState<string>("Cambio de aceite y filtros");
  const [descripcion, setDescripcion] = useState("");
  const [kilometraje, setKilometraje] = useState(params.mileage ?? "");
  const [fechaRequerida, setFechaRequerida] = useState("");
  const [selectedTallerId, setSelectedTallerId] = useState<string>("1");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const cargarVehiculos = async () => {
      try {
        const token = await storage.getItem("token");
        const response = await fetch(`${API_BASE_URL}/vehiculos`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        const items = Array.isArray(data) && data.length > 0 ? data : fallbackVehiculos;
        setVehiculos(items);

        if (!selectedVehicleId && items[0]?.id != null) {
          setSelectedVehicleId(String(items[0].id));
        }
      } catch (error) {
        console.log("Error cargando vehiculos", error);
        setVehiculos(fallbackVehiculos);

        if (!selectedVehicleId) {
          setSelectedVehicleId(String(fallbackVehiculos[0].id));
        }
      }
    };

    cargarVehiculos();
  }, [selectedVehicleId]);

  useEffect(() => {
    const cargarTalleres = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/talleres`);
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
          const talleresMapeados: Taller[] = data.map((taller, index) => ({
            id: String(taller.id ?? index + 1),
            nombre: taller.nombre || "Taller",
            email: taller.email || "",
            telefono: taller.telefono || "",
            calificacion: "4.8",
            distancia: `${(index + 2).toFixed(1)} km`,
            tiempo: `${15 + index * 7} min`,
          }));

          setTalleres(talleresMapeados);
          setSelectedTallerId(String(talleresMapeados[0].id));
        } else {
          setTalleres(fallbackTalleres);
        }
      } catch (error) {
        console.log("Error cargando talleres", error);
        setTalleres(fallbackTalleres);
      }
    };

    cargarTalleres();
  }, []);

  const vehiculosDisponibles = useMemo(() => {
    if (vehiculos.length > 0) return vehiculos;

    if (params.vehicleId || params.plate || params.brand) {
      return [
        {
          id: params.vehicleId ?? "from-route",
          placa: params.plate,
          marca: params.brand,
          modelo: params.model,
          kilometraje: params.mileage,
          anio: params.year,
        },
      ];
    }

    return fallbackVehiculos;
  }, [params.brand, params.mileage, params.model, params.plate, params.vehicleId, params.year, vehiculos]);

  const selectedVehicle =
    vehiculosDisponibles.find((item) => String(item.id) === String(selectedVehicleId)) ||
    vehiculosDisponibles[0];

  const selectedTaller = talleres.find((item) => item.id === selectedTallerId) || talleres[0];

  const enviarSolicitud = async () => {
    if (!selectedVehicle?.id) {
      Alert.alert("Error", "Debes seleccionar un vehiculo");
      return;
    }

    if (!descripcion.trim()) {
      Alert.alert("Error", "Debes describir el problema");
      return;
    }

    try {
      setSending(true);
      const token = await storage.getItem("token");

      const response = await fetch(`${API_BASE_URL}/solicitudes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehiculo_id: Number(selectedVehicle.id),
          tipo: selectedService,
          descripcion: descripcion.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || data.error || "No se pudo crear la solicitud");
        return;
      }

      Alert.alert(
        "Solicitud enviada",
        `Tu solicitud fue enviada al administrador para revision y cotizacion. Taller sugerido: ${selectedTaller?.nombre || "Sin seleccionar"}.`
      );
      router.replace("/(tabs)");
    } catch (error) {
      console.log("Error creando solicitud", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color="#162033" />
        </TouchableOpacity>

        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Solicitud de servicio</Text>
          <Text style={styles.title}>Vehicle Service Request</Text>
        </View>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Programa la atencion de tu vehiculo</Text>
        <Text style={styles.heroSubtitle}>
          Completa los 4 pasos para enviar la solicitud al administrador y recibir una cotizacion.
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.stepHeader}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>Paso 1</Text>
          </View>
          <Text style={styles.sectionTitle}>Seleccionar vehiculo</Text>
        </View>

        <Text style={styles.helperText}>El cliente primero escoge su vehiculo.</Text>

        <View style={styles.vehicleList}>
          {vehiculosDisponibles.map((vehicle) => {
            const selected = String(vehicle.id) === String(selectedVehicleId);

            return (
              <TouchableOpacity
                key={String(vehicle.id)}
                style={[styles.vehicleCard, selected && styles.vehicleCardSelected]}
                onPress={() => {
                  setSelectedVehicleId(String(vehicle.id));
                  setKilometraje(String(vehicle.kilometraje ?? ""));
                }}
              >
                <View style={styles.vehicleCardTop}>
                  <View>
                    <Text style={styles.vehicleTitle}>
                      {vehicle.marca} {vehicle.modelo}
                    </Text>
                    <Text style={styles.vehiclePlate}>{vehicle.placa || "Sin placa"}</Text>
                  </View>
                  <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.stepHeader}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>Paso 2</Text>
          </View>
          <Text style={styles.sectionTitle}>Elegir tipo de servicio</Text>
        </View>

        <Text style={styles.helperText}>Selecciona el servicio puntual. Los radio button van sobre cada servicio.</Text>

        <View style={styles.radioList}>
          {serviceGroups.map((group) => (
            <View key={group.title} style={styles.serviceGroupCard}>
              <Text style={styles.serviceGroupTitle}>{group.title}</Text>
              <Text style={styles.serviceGroupDescription}>{group.description}</Text>

              <View style={styles.groupServices}>
                {group.services.map((service) => {
                  const selected = service === selectedService;

                  return (
                    <TouchableOpacity
                      key={service}
                      style={[styles.radioCard, selected && styles.radioCardSelected]}
                      onPress={() => setSelectedService(service)}
                    >
                      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                        {selected ? <View style={styles.radioInner} /> : null}
                      </View>
                      <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{service}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          <View style={styles.serviceGroupCard}>
            <Text style={styles.serviceGroupTitle}>No se que tiene mi vehiculo</Text>
            <Text style={styles.serviceGroupDescription}>Opcion importante cuando la falla no esta clara</Text>

            <TouchableOpacity
              style={[styles.radioCard, selectedService === "No se que tiene mi vehiculo" && styles.radioCardSelected]}
              onPress={() => setSelectedService("No se que tiene mi vehiculo")}
            >
              <View
                style={[
                  styles.radioOuter,
                  selectedService === "No se que tiene mi vehiculo" && styles.radioOuterActive,
                ]}
              >
                {selectedService === "No se que tiene mi vehiculo" ? <View style={styles.radioInner} /> : null}
              </View>
              <Text
                style={[
                  styles.radioLabel,
                  selectedService === "No se que tiene mi vehiculo" && styles.radioLabelSelected,
                ]}
              >
                No se que tiene mi vehiculo
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.stepHeader}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>Paso 3</Text>
          </View>
          <Text style={styles.sectionTitle}>Describir el problema</Text>
        </View>

        <Text style={styles.helperText}>Aqui el cliente explica lo que ocurre.</Text>

        <Text style={styles.inputLabel}>Descripcion del problema</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          multiline
          numberOfLines={4}
          value={descripcion}
          onChangeText={setDescripcion}
          placeholder="Ejemplo: El vehiculo hace ruido al frenar"
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.doubleRow}>
          <View style={styles.flexItem}>
            <Text style={styles.inputLabel}>Kilometraje actual</Text>
            <TextInput
              style={styles.input}
              value={kilometraje}
              onChangeText={setKilometraje}
              placeholder="45210"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
            />
          </View>

          <View style={styles.flexItem}>
            <Text style={styles.inputLabel}>Fecha requerida</Text>
            <TextInput
              style={styles.input}
              value={fechaRequerida}
              onChangeText={setFechaRequerida}
              placeholder="2026-03-20"
              placeholderTextColor="#94a3b8"
            />
          </View>
        </View>

        <View style={styles.uploadGrid}>
          <TouchableOpacity style={styles.uploadCard}>
            <MaterialCommunityIcons name="camera-plus-outline" size={22} color="#2563eb" />
            <Text style={styles.uploadTitle}>Subir fotos</Text>
            <Text style={styles.uploadSubtitle}>Opcional</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.uploadCard}>
            <MaterialCommunityIcons name="video-plus-outline" size={22} color="#2563eb" />
            <Text style={styles.uploadTitle}>Subir video</Text>
            <Text style={styles.uploadSubtitle}>Opcional</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <View style={styles.stepHeader}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>Paso 4</Text>
          </View>
          <Text style={styles.sectionTitle}>Elegir taller</Text>
        </View>

        <Text style={styles.helperText}>La app muestra talleres cercanos.</Text>

        <View style={styles.tallerList}>
          {talleres.map((taller) => {
            const selected = taller.id === selectedTallerId;

            return (
              <TouchableOpacity
                key={taller.id}
                style={[styles.tallerCard, selected && styles.tallerCardSelected]}
                onPress={() => setSelectedTallerId(taller.id)}
              >
                <View style={styles.tallerTop}>
                  <View>
                    <Text style={styles.tallerName}>{taller.nombre}</Text>
                    <Text style={styles.tallerRating}>{taller.calificacion} estrella</Text>
                  </View>
                  <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                </View>

                <View style={styles.tallerMetaRow}>
                  <View style={styles.metaPill}>
                    <MaterialCommunityIcons name="map-marker-outline" size={14} color="#475569" />
                    <Text style={styles.metaPillText}>{taller.distancia}</Text>
                  </View>

                  <View style={styles.metaPill}>
                    <MaterialCommunityIcons name="clock-outline" size={14} color="#475569" />
                    <Text style={styles.metaPillText}>{taller.tiempo}</Text>
                  </View>
                </View>

                {taller.telefono ? (
                  <Text style={styles.tallerContact}>Telefono: {taller.telefono}</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Resumen de solicitud</Text>
        <Text style={styles.summaryText}>
          Vehiculo: {selectedVehicle?.marca} {selectedVehicle?.modelo} {selectedVehicle?.placa ? `- ${selectedVehicle.placa}` : ""}
        </Text>
        <Text style={styles.summaryText}>Servicio: {selectedService}</Text>
        <Text style={styles.summaryText}>Administrador: revision y cotizacion</Text>
        <Text style={styles.summaryText}>Taller sugerido: {selectedTaller?.nombre}</Text>

        <TouchableOpacity style={styles.submitButton} onPress={enviarSolicitud}>
          <Text style={styles.submitButtonText}>
            {sending ? "Enviando..." : "Solicitar servicio"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f4f7fb",
  },
  content: {
    padding: 18,
    paddingBottom: 32,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e7edf5",
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: "#7a8597",
    fontSize: 12,
    marginBottom: 4,
  },
  title: {
    color: "#162033",
    fontSize: 24,
    fontWeight: "800",
  },
  hero: {
    backgroundColor: "#162033",
    borderRadius: 26,
    padding: 20,
  },
  heroTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  heroSubtitle: {
    color: "#c4d0e3",
    marginTop: 10,
    lineHeight: 21,
  },
  sectionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e7edf5",
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  stepBadge: {
    backgroundColor: "#eaf1ff",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 10,
  },
  stepBadgeText: {
    color: "#2563eb",
    fontWeight: "800",
  },
  sectionTitle: {
    color: "#162033",
    fontSize: 20,
    fontWeight: "800",
  },
  helperText: {
    color: "#64748b",
    marginBottom: 14,
    lineHeight: 20,
  },
  vehicleList: {
    gap: 12,
  },
  vehicleCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e7edf5",
    padding: 16,
    backgroundColor: "#f8fbff",
  },
  vehicleCardSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eef4ff",
  },
  vehicleCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  vehicleTitle: {
    color: "#162033",
    fontSize: 17,
    fontWeight: "800",
  },
  vehiclePlate: {
    color: "#64748b",
    marginTop: 5,
  },
  radioList: {
    gap: 12,
  },
  serviceGroupCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e7edf5",
    backgroundColor: "#f8fbff",
    padding: 14,
  },
  serviceGroupTitle: {
    color: "#162033",
    fontSize: 16,
    fontWeight: "800",
  },
  serviceGroupDescription: {
    color: "#64748b",
    marginTop: 4,
    marginBottom: 12,
  },
  groupServices: {
    gap: 10,
  },
  radioCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e7edf5",
    borderRadius: 18,
    padding: 15,
    backgroundColor: "#f8fbff",
  },
  radioCardSelected: {
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
  radioLabel: {
    flex: 1,
    color: "#334155",
    fontWeight: "600",
    marginLeft: 12,
  },
  radioLabelSelected: {
    color: "#162033",
  },
  inputLabel: {
    color: "#334155",
    fontWeight: "700",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#f8fbff",
    borderWidth: 1,
    borderColor: "#e7edf5",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#162033",
    marginBottom: 14,
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  doubleRow: {
    flexDirection: "row",
    gap: 12,
  },
  flexItem: {
    flex: 1,
  },
  uploadGrid: {
    flexDirection: "row",
    gap: 12,
  },
  uploadCard: {
    flex: 1,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d7e4fb",
    backgroundColor: "#f8fbff",
    alignItems: "center",
  },
  uploadTitle: {
    color: "#162033",
    fontWeight: "700",
    marginTop: 10,
  },
  uploadSubtitle: {
    color: "#64748b",
    marginTop: 4,
    fontSize: 12,
  },
  tallerList: {
    gap: 12,
  },
  tallerCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e7edf5",
    padding: 16,
    backgroundColor: "#f8fbff",
  },
  tallerCardSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eef4ff",
  },
  tallerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tallerName: {
    color: "#162033",
    fontWeight: "800",
    fontSize: 17,
  },
  tallerRating: {
    color: "#64748b",
    marginTop: 5,
  },
  tallerMetaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  tallerContact: {
    color: "#64748b",
    marginTop: 10,
    fontSize: 12,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaPillText: {
    color: "#475569",
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e7edf5",
  },
  summaryTitle: {
    color: "#162033",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 12,
  },
  summaryText: {
    color: "#475569",
    marginBottom: 8,
  },
  submitButton: {
    marginTop: 14,
    backgroundColor: "#2563eb",
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16,
  },
});
