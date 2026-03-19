import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { API_BASE_URL } from "../../constants/api";
import { formatKilometraje } from "../../constants/formatters";
import storage from "../../constants/storage";

type Vehiculo = {
  id?: number | string;
  marca?: string;
  modelo?: string;
  anio?: number | string;
  kilometraje?: number | string;
  placa?: string;
};

type Solicitud = {
  id?: number | string;
  tipo_servicio?: string;
  estado?: string;
  vehiculo?: {
    id?: number | string;
  };
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

const fallbackVehiculos: Vehiculo[] = [
  { id: "f-1", marca: "Toyota", modelo: "Corolla", placa: "ABC123", anio: 2022, kilometraje: 45210 },
  { id: "f-2", marca: "Mazda", modelo: "3", placa: "KHT234", anio: 2020, kilometraje: 38900 },
];

const SERVICE_UNKNOWN = "No se que tiene mi vehiculo";

const getToday = () => new Date().toISOString().slice(0, 10);

export default function ServiceRequestScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    vehicleId?: string;
    plate?: string;
    brand?: string;
    model?: string;
    mileage?: string;
    year?: string;
  }>();

  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(params.vehicleId ?? null);
  const [selectedServices, setSelectedServices] = useState<string[]>(["Cambio de aceite y filtros"]);
  const [descripcion, setDescripcion] = useState("");
  const [kilometraje, setKilometraje] = useState(params.mileage ?? "");
  const [fechaRequerida] = useState(getToday());
  const [sending, setSending] = useState(false);

  const irAMisVehiculos = useCallback(() => {
    navigation.navigate("index" as never);
  }, [navigation]);

  const cargarDatos = useCallback(async () => {
    try {
      const token = await storage.getItem("token");
      const [vehiculosResponse, solicitudesResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/vehiculos`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`${API_BASE_URL}/solicitudes`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);

      const vehiculosData = await vehiculosResponse.json();
      const solicitudesData = await solicitudesResponse.json();
      const items = Array.isArray(vehiculosData) && vehiculosData.length > 0 ? vehiculosData : fallbackVehiculos;
      setVehiculos(items);
      setSolicitudes(Array.isArray(solicitudesData) ? solicitudesData : []);

      if (!selectedVehicleId && items[0]?.id != null) {
        setSelectedVehicleId(String(items[0].id));
      }
    } catch (error) {
      console.log("Error cargando datos de solicitud", error);
      setVehiculos(fallbackVehiculos);
      setSolicitudes([]);

      if (!selectedVehicleId) {
        setSelectedVehicleId(String(fallbackVehiculos[0].id));
      }
    }
  }, [selectedVehicleId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  useFocusEffect(
    useCallback(() => {
      cargarDatos();
    }, [cargarDatos])
  );

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

  useEffect(() => {
    if (selectedVehicle?.kilometraje != null) {
      setKilometraje(String(selectedVehicle.kilometraje));
    }
  }, [selectedVehicle]);

  const toggleService = (service: string) => {
    setSelectedServices((current) => {
      if (service === SERVICE_UNKNOWN) {
        return current.includes(SERVICE_UNKNOWN) ? [] : [SERVICE_UNKNOWN];
      }

      const withoutUnknown = current.filter((item) => item !== SERVICE_UNKNOWN);

      if (withoutUnknown.includes(service)) {
        return withoutUnknown.filter((item) => item !== service);
      }

      return [...withoutUnknown, service];
    });
  };

  const normalizarTexto = (value?: string) =>
    (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const esSolicitudMantenimiento = (tipoServicio?: string) => {
    const servicio = normalizarTexto(tipoServicio);

    if (!servicio) return false;

    const partes = servicio
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return partes.some(
      (parte) =>
        !parte.includes("bateria") &&
        !parte.includes("llanta") &&
        !parte.includes("aceite") &&
        !parte.includes("filtro")
    );
  };

  const solicitudActiva = useMemo(
    () =>
      solicitudes.some((item) => {
        const estado = (item.estado || "").toLowerCase();
        const isOpenState = !["archivada", "devuelta", "finalizado", "rechazada"].includes(estado);

        return (
          isOpenState &&
          esSolicitudMantenimiento(item.tipo_servicio) &&
          String(item.vehiculo?.id) === String(selectedVehicle?.id)
        );
      }),
    [selectedVehicle?.id, solicitudes]
  );

  const enviarSolicitud = async () => {
    if (!selectedVehicle?.id) {
      Alert.alert("Error", "Debes seleccionar un vehiculo");
      return;
    }

    if (selectedServices.length === 0) {
      Alert.alert("Error", "Debes seleccionar al menos un servicio");
      return;
    }

    if (!descripcion.trim()) {
      Alert.alert("Error", "Debes describir el problema");
      return;
    }

    if (descripcion.trim().length > 200) {
      Alert.alert("Error", "La descripcion no puede superar los 200 caracteres");
      return;
    }

    if (solicitudActiva) {
      Alert.alert("Solicitud en curso", "Este vehiculo ya tiene una solicitud activa.");
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
          tipo: selectedServices.join(", "),
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
        "Tu solicitud fue enviada al administrador para revision y cotizacion."
      );
      irAMisVehiculos();
    } catch (error) {
      console.log("Error creando solicitud", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity
        style={styles.vehiclesShortcutButton}
        onPress={irAMisVehiculos}
      >
        <MaterialCommunityIcons name="car-outline" size={18} color="#2563eb" />
        <Text style={styles.vehiclesShortcutText}>Volver a Mis vehiculos</Text>
      </TouchableOpacity>

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

        <Text style={styles.helperText}>Selecciona uno o varios servicios segun lo que necesites.</Text>

        <View style={styles.radioList}>
          {serviceGroups.map((group) => (
            <View key={group.title} style={styles.serviceGroupCard}>
              <Text style={styles.serviceGroupTitle}>{group.title}</Text>
              <Text style={styles.serviceGroupDescription}>{group.description}</Text>

              <View style={styles.groupServices}>
                {group.services.map((service) => {
                  const selected = selectedServices.includes(service);

                  return (
                    <TouchableOpacity
                      key={service}
                      style={[styles.radioCard, selected && styles.radioCardSelected]}
                      onPress={() => toggleService(service)}
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
              style={[
                styles.radioCard,
                selectedServices.includes(SERVICE_UNKNOWN) && styles.radioCardSelected,
                selectedServices.length > 0 &&
                  !selectedServices.includes(SERVICE_UNKNOWN) &&
                  styles.radioCardDisabled,
              ]}
              onPress={() => toggleService(SERVICE_UNKNOWN)}
              disabled={selectedServices.length > 0 && !selectedServices.includes(SERVICE_UNKNOWN)}
            >
              <View
                style={[
                  styles.radioOuter,
                  selectedServices.includes(SERVICE_UNKNOWN) && styles.radioOuterActive,
                ]}
              >
                {selectedServices.includes(SERVICE_UNKNOWN) ? <View style={styles.radioInner} /> : null}
              </View>
              <Text
                style={[
                  styles.radioLabel,
                  selectedServices.includes(SERVICE_UNKNOWN) && styles.radioLabelSelected,
                  selectedServices.length > 0 &&
                    !selectedServices.includes(SERVICE_UNKNOWN) &&
                    styles.radioLabelDisabled,
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
          maxLength={200}
        />
        <Text style={styles.counterText}>{descripcion.length}/200</Text>

        <View style={styles.doubleRow}>
          <View style={styles.flexItem}>
            <Text style={styles.inputLabel}>Kilometraje actual</Text>
            <View style={[styles.input, styles.readOnlyInput]}>
              <Text style={styles.readOnlyValue}>{formatKilometraje(kilometraje)}</Text>
            </View>
          </View>

          <View style={styles.flexItem}>
            <Text style={styles.inputLabel}>Fecha de solicitud</Text>
            <View style={[styles.input, styles.readOnlyInput]}>
              <Text style={styles.readOnlyValue}>{fechaRequerida}</Text>
            </View>
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

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Resumen de solicitud</Text>
        <Text style={styles.summaryText}>
          Vehiculo: {selectedVehicle?.marca} {selectedVehicle?.modelo} {selectedVehicle?.placa ? `- ${selectedVehicle.placa}` : ""}
        </Text>
        <Text style={styles.summaryText}>Servicios: {selectedServices.join(", ") || "Sin seleccionar"}</Text>
        <Text style={styles.summaryText}>Kilometraje: {formatKilometraje(kilometraje)}</Text>
        <Text style={styles.summaryText}>Administrador: revision y cotizacion</Text>
        {solicitudActiva ? (
          <Text style={styles.warningText}>
            Este vehiculo ya tiene una solicitud activa. Debes esperar a que cambie de estado.
          </Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.submitButton,
            (sending || solicitudActiva || selectedServices.length === 0) && styles.submitButtonDisabled,
          ]}
          onPress={enviarSolicitud}
          disabled={sending || solicitudActiva || selectedServices.length === 0}
        >
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
  hero: {
    backgroundColor: "#162033",
    borderRadius: 26,
    padding: 20,
  },
  vehiclesShortcutButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d7e4fb",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  vehiclesShortcutText: {
    color: "#2563eb",
    fontWeight: "700",
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
  radioCardDisabled: {
    opacity: 0.45,
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
  radioLabelDisabled: {
    color: "#94a3b8",
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
  readOnlyInput: {
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  readOnlyValue: {
    color: "#162033",
    fontWeight: "700",
  },
  counterText: {
    marginTop: -6,
    marginBottom: 12,
    color: "#64748b",
    fontSize: 12,
    textAlign: "right",
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
  submitButtonDisabled: {
    opacity: 0.55,
  },
  warningText: {
    color: "#b45309",
    marginBottom: 6,
    lineHeight: 20,
    fontWeight: "600",
  },
});
