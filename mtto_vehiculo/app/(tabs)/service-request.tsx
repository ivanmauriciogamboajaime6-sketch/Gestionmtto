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
import { isHistoryStatus, isQuoteWorkflowService, normalizeServiceText, normalizeStatus } from "../../constants/request-status";
import storage from "../../constants/storage";

type Vehiculo = {
  id?: number | string;
  tipo_vehiculo?: string;
  marca?: string;
  modelo?: string;
  anio?: number | string;
  kilometraje?: number | string;
  placa?: string;
  combustible?: string;
};

type Solicitud = {
  id?: number | string;
  solicitud_origen_id?: number | string | null;
  tipo_servicio?: string;
  estado?: string;
  disponibilidad_cliente?: string;
  vehiculo?: {
    id?: number | string;
  };
};

const carServiceGroups = [
  {
    title: "Mantenimiento Preventivo Basico",
    description: "Servicios esenciales para el carro",
    services: [
      "Cambio de aceite de motor y filtro",
      "Revision y cambio de filtros",
      "Revision de frenos",
      "Control de neumaticos",
      "Chequeo de niveles",
    ],
  },
  {
    title: "Mantenimiento Correctivo y Profundo",
    description: "Servicios de ajuste y reparacion para el carro",
    services: [
      "Alineacion y balanceo",
      "Sistema de suspension y direccion",
      "Sistema de enfriamiento",
      "Afinacion del motor",
      "Sistema electrico y bateria",
    ],
  },
  {
    title: "Diagnostico",
    description: "Revision tecnica para el carro",
    services: [
      "Escaneo",
      "Diagnostico motor",
      "Diagnostico electrico",
      "Testigos tablero",
    ],
  },
];

const motoServiceGroups = [
  {
    title: "Servicios Preventivos y Mantenimiento Basico",
    description: "Mantenimiento periodico para moto",
    services: [
      "Motor: Cambio de aceite de motor y filtro de aceite",
      "Combustible: Limpieza o cambio del filtro de aire",
      "Encendido: Revision o reemplazo de la bujia",
      "Transmision: Tension, limpieza y lubricacion de la cadena o kit de arrastre",
      "Frenos: Revision o cambio de pastillas, balatas y nivel de liquido de frenos",
      "Llantas: Verificacion de presion y estado de las cubiertas",
      "Electricidad: Revision de bateria y luces",
    ],
  },
  {
    title: "Servicios Correctivos y de Ajuste",
    description: "Reparacion y ajustes para moto",
    services: [
      "Sistema de frenos: Cambio de discos, balatas o purgado de frenos hidraulicos",
      "Motor: Ajuste de valvulas, limpieza de carburador o inyectores",
      "Suspension: Cambio de aceite de barras o retenes",
      "Mecanica general: Cambio de cables y ajuste de tornilleria",
      "Rodamientos: Cambio de rulemanes de ruedas",
    ],
  },
  {
    title: "Mantenimiento de Motos Electricas",
    description: "Revisiones para moto electrica",
    services: [
      "Revision de la bateria y conexiones",
      "Presion de neumaticos",
      "Pastillas de freno",
      "Estado de la cadena",
    ],
  },
];

const fallbackVehiculos: Vehiculo[] = [
  { id: "f-1", marca: "Toyota", modelo: "Corolla", placa: "ABC123", anio: 2022, kilometraje: 45210 },
  { id: "f-2", marca: "Mazda", modelo: "3", placa: "KHT234", anio: 2020, kilometraje: 38900 },
];

const SERVICE_UNKNOWN = "No se que tiene mi vehiculo";

const getToday = () => new Date().toISOString().slice(0, 10);

const inferVehicleType = (vehiculo?: Vehiculo | null): "carro" | "moto" => {
  const tipoVehiculo = String(vehiculo?.tipo_vehiculo || "").trim().toLowerCase();
  const placa = String(vehiculo?.placa || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const combustible = String(vehiculo?.combustible || "").trim().toLowerCase();

  if (tipoVehiculo === "carro" || tipoVehiculo === "moto") return tipoVehiculo;
  if (combustible === "electrica") return "moto";
  if (combustible === "diesel" || combustible === "gas") return "carro";
  if (/^[A-Z]{3}\d{2}[A-Z]$/.test(placa)) return "moto";
  if (/^[A-Z]{3}\d{3}$/.test(placa)) return "carro";
  return "carro";
};

const filterVisibleClientRequests = (items: Solicitud[]) => {
  const itemsByRoot = new Map<string, Solicitud[]>();

  items.forEach((item) => {
    const rootId = String(item.solicitud_origen_id ?? item.id ?? "");
    const current = itemsByRoot.get(rootId) || [];
    current.push(item);
    itemsByRoot.set(rootId, current);
  });

  return Array.from(itemsByRoot.values()).map((group) => {
    const root = group.find((item) => item.solicitud_origen_id == null) || group[0];
    const childOffers = group
      .filter((item) => item.solicitud_origen_id != null)
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

    if (childOffers.length === 0) {
      return root;
    }

    const activeChildOffers = childOffers.filter((item) => !isHistoryStatus(item.estado));
    const historyChildOffers = childOffers.filter((item) => isHistoryStatus(item.estado));

    const selectedOffer =
      activeChildOffers.find((item) => normalizeStatus(item.estado) === "aprobada") ||
      activeChildOffers.find((item) => !isHistoryStatus(item.estado)) ||
      historyChildOffers.find((item) => normalizeStatus(item.estado) === "finalizada") ||
      historyChildOffers[historyChildOffers.length - 1] ||
      childOffers[childOffers.length - 1];

    return {
      ...root,
      ...selectedOffer,
      id: root.id,
      solicitud_origen_id: root.solicitud_origen_id,
    };
  });
};

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
  const [selectedServices, setSelectedServices] = useState<string[]>(["Cambio de aceite de motor y filtro"]);
  const [descripcion, setDescripcion] = useState("");
  const [disponibilidadCliente, setDisponibilidadCliente] = useState("");
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
      setSolicitudes(
        filterVisibleClientRequests(Array.isArray(solicitudesData) ? solicitudesData : [])
      );

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

  const selectedVehicleType = useMemo(
    () => inferVehicleType(selectedVehicle),
    [selectedVehicle]
  );

  const serviceGroups = useMemo(
    () => (selectedVehicleType === "moto" ? motoServiceGroups : carServiceGroups),
    [selectedVehicleType]
  );

  const defaultService = serviceGroups[0]?.services[0] || "";

  const availableServices = useMemo(
    () => serviceGroups.flatMap((group) => group.services),
    [serviceGroups]
  );

  useEffect(() => {
    if (selectedVehicle?.kilometraje != null) {
      setKilometraje(String(selectedVehicle.kilometraje));
    }
  }, [selectedVehicle]);

  useEffect(() => {
    setSelectedServices((current) => {
      if (current.includes(SERVICE_UNKNOWN)) {
        return current;
      }

      const validSelections = current.filter((service) => availableServices.includes(service));
      if (validSelections.length > 0) {
        return validSelections;
      }

      return defaultService ? [defaultService] : [];
    });
  }, [availableServices, defaultService, selectedVehicleType]);

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
    const servicio = normalizeServiceText(tipoServicio);

    if (!servicio) return false;

    const partes = servicio
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return partes.some(
      (parte) =>
        !isQuoteWorkflowService(parte)
    );
  };

  const solicitudActiva = useMemo(
    () =>
      solicitudes.some((item) => {
        const estado = normalizeStatus(item.estado);
        const isOpenState = !isHistoryStatus(estado);

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

    if (!disponibilidadCliente.trim()) {
      Alert.alert("Error", "Debes indicar tu disponibilidad para acercarte al taller");
      return;
    }

    if (descripcion.trim().length > 200) {
      Alert.alert("Error", "La descripcion no puede superar los 200 caracteres");
      return;
    }

    if (disponibilidadCliente.trim().length > 200) {
      Alert.alert("Error", "La disponibilidad no puede superar los 200 caracteres");
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
          disponibilidad_cliente: disponibilidadCliente.trim(),
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
      await storage.setItem("client_dashboard_section", "Mis servicios");
      await storage.setItem("client_dashboard_expand_service_id", String(data.id));
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
        <Text style={styles.helperText}>
          Vehiculo detectado: {selectedVehicleType === "moto" ? "Moto" : "Carro"}.
        </Text>

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

        <Text style={styles.inputLabel}>Disponibilidad para acercarte al taller</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          multiline
          numberOfLines={3}
          value={disponibilidadCliente}
          onChangeText={setDisponibilidadCliente}
          placeholder="Ejemplo: Lunes a viernes despues de las 3:00 p. m. o sabado en la manana"
          placeholderTextColor="#94a3b8"
          maxLength={200}
        />
        <Text style={styles.counterText}>{disponibilidadCliente.length}/200</Text>

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
        <Text style={styles.summaryText}>
          Disponibilidad: {disponibilidadCliente.trim() || "Sin registrar"}
        </Text>
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
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "#e7edf5",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 18,
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
    marginTop: 4,
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
    marginTop: 4,
    lineHeight: 28,
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
