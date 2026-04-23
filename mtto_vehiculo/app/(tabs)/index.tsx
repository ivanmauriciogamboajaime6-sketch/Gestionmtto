import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { CommonActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { API_BASE_URL } from "../../constants/api";
import { formatCurrency, formatDateTime, formatKilometraje, formatNumberWithDots, parseFormattedNumber } from "../../constants/formatters";
import {
  getStatusLabel,
  isApprovedStatus,
  isCancelledStatus,
  isCreatedStatus,
  isDiagnosedStatus,
  isFinishedStatus,
  isHistoryStatus,
  isInDiagnosisStatus,
  isInProcessStatus,
  isInQuotationStatus,
  isOpenRequestStatus,
  isProposalReadyStatus,
  isQuoteWorkflowService,
  isQuotedStatus,
  isRejectedClientStatus,
  isRejectedWorkshopStatus,
  isSentToClientStatus,
  isWaitingClientStatus,
  normalizeServiceText,
  normalizeStatus,
} from "../../constants/request-status";
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
  numero_caso?: number | string | null;
  solicitud_origen_id?: number | string | null;
  accion_solicitud_id?: number | string | null;
  tipo_servicio?: string;
  problema?: string;
  estado?: string;
  observacion?: string | null;
  disponibilidad_cliente?: string | null;
  fecha?: string | null;
  vehiculo?: {
    id?: number | string;
    marca?: string;
    modelo?: string;
    placa?: string;
  };
  cotizacion?: {
    proveedor_id?: string | number | null;
    marca?: string | null;
    referencia?: string | null;
    garantia?: string | null;
    disponibilidad?: string | null;
    precio?: string | null;
    observacion?: string | null;
    documento_excel_nombre?: string | null;
    documento_excel_mime?: string | null;
    documento_excel_base64?: string | null;
    respuestas?: {
      proveedor_id?: string | number | null;
      solicitud_id?: string | number | null;
      proveedor_nombre?: string | null;
      response_index?: number | null;
      marca?: string | null;
      referencia?: string | null;
      garantia?: string | null;
      disponibilidad?: string | null;
      precio?: string | null;
      observacion?: string | null;
      documento_excel_nombre?: string | null;
      documento_excel_mime?: string | null;
      documento_excel_base64?: string | null;
    }[];
  };
  taller_diagnostico?: {
    diagnostico?: string | null;
    servicios?: string | null;
    horas?: string | null;
    materiales?: string | null;
  };
  flujo_mantenimiento?: {
    repuestos_solicitados?: {
      nombre?: string | null;
      cantidad?: number | null;
    }[];
    timeline?: Record<string, string | null>;
    confirmaciones?: Record<string, boolean | string | null>;
    encuesta_satisfaccion?: {
      calificacion?: number | null;
      comentario?: string | null;
      fecha?: string | null;
      cliente_nombre?: string | null;
    };
  };
  respuesta_taller?: {
    comentario?: string | null;
    fecha_disponible?: string | null;
    horario_disponible?: string | null;
  };
  respuesta_proveedor?: {
    comentario?: string | null;
  };
};

type Taller = {
  id?: number | string;
  nombre?: string;
  email?: string;
  telefono?: string;
  estado?: string;
};

type Notificacion = {
  id?: number | string;
  titulo?: string;
  mensaje?: string;
  tipo?: string;
  leida?: boolean;
};

const formatWorkshopDateLabel = (value?: string | null) => {
  if (!value) return "Sin fecha";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatWorkshopTimeLabel = (value?: string | null) => {
  if (!value) return "Sin horario";
  const [hours, minutes] = String(value).split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return String(value);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
  });
};

const filterVisibleClientRequests = (items: Solicitud[]) => {
  const itemsByRoot = new Map<string, Solicitud[]>();

  items.forEach((item) => {
    const rootId = String(item.solicitud_origen_id ?? item.id ?? "");
    const current = itemsByRoot.get(rootId) || [];
    current.push(item);
    itemsByRoot.set(rootId, current);
  });

  return Array.from(itemsByRoot.values())
    .map((group) => {
      const root = group.find((item) => item.solicitud_origen_id == null) || group[0];
      const childOffers = group
        .filter((item) => item.solicitud_origen_id != null)
        .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      const activeChildOffers = childOffers.filter((item) => !isHistoryStatus(item.estado));
      const historyChildOffers = childOffers.filter((item) => isHistoryStatus(item.estado));

      if (childOffers.length === 0) {
        return root;
      }

      const selectedOffer =
        activeChildOffers.find((item) => isInProcessStatus(item.estado) || isWaitingClientStatus(item.estado)) ||
        activeChildOffers.find((item) => normalizeStatus(item.estado) === "aprobada") ||
        activeChildOffers.find((item) => isSentToClientStatus(item.estado)) ||
        historyChildOffers.find((item) => isFinishedStatus(item.estado)) ||
        historyChildOffers.find((item) => normalizeStatus(item.estado) === "finalizada") ||
        childOffers[childOffers.length - 1];

      const visibleOffers =
        selectedOffer &&
        (
          normalizeStatus(selectedOffer.estado) === "aprobada" ||
          isWaitingClientStatus(selectedOffer.estado) ||
          isInProcessStatus(selectedOffer.estado) ||
          isFinishedStatus(selectedOffer.estado)
        )
          ? [selectedOffer]
          : activeChildOffers.length > 0
            ? activeChildOffers
            : selectedOffer
              ? [selectedOffer]
              : childOffers;

      const respuestas = visibleOffers.flatMap((offer, index) => {
        if (offer.cotizacion?.respuestas?.length) {
          return offer.cotizacion.respuestas.map((respuesta) => ({
            solicitud_id: offer.id,
            proveedor_id: offer.cotizacion?.proveedor_id || respuesta?.proveedor_id || null,
            proveedor_nombre: respuesta?.proveedor_nombre || `Oferta ${String.fromCharCode(65 + index)}`,
            response_index: respuesta?.response_index ?? 0,
            marca: respuesta?.marca || offer.cotizacion?.marca || null,
            referencia: respuesta?.referencia || offer.cotizacion?.referencia || null,
            garantia: respuesta?.garantia || offer.cotizacion?.garantia || null,
            disponibilidad: respuesta?.disponibilidad || offer.cotizacion?.disponibilidad || null,
            precio: respuesta?.precio || offer.cotizacion?.precio || null,
            observacion: respuesta?.observacion || offer.cotizacion?.observacion || null,
            documento_excel_nombre: null,
            documento_excel_mime: null,
            documento_excel_base64: null,
          }));
        }

        return [{
          solicitud_id: offer.id,
          proveedor_id: offer.cotizacion?.proveedor_id || null,
          proveedor_nombre: `Oferta ${String.fromCharCode(65 + index)}`,
          response_index: 0,
          marca: offer.cotizacion?.marca || null,
          referencia: offer.cotizacion?.referencia || null,
          garantia: offer.cotizacion?.garantia || null,
          disponibilidad: offer.cotizacion?.disponibilidad || null,
          precio: offer.cotizacion?.precio || null,
          observacion: offer.cotizacion?.observacion || null,
          documento_excel_nombre: null,
          documento_excel_mime: null,
          documento_excel_base64: null,
        }];
      });

      const solicitudAccionId =
        selectedOffer?.id ??
        childOffers.find((item) => isSentToClientStatus(item.estado))?.id ??
        root.id;

      return {
        ...root,
        ...selectedOffer,
        id: root.id,
        solicitud_origen_id: root.solicitud_origen_id,
        cotizacion: {
          ...(selectedOffer.cotizacion || root.cotizacion || {}),
          respuestas,
        },
        respuesta_taller: selectedOffer.respuesta_taller || root.respuesta_taller,
        respuesta_proveedor: selectedOffer.respuesta_proveedor || root.respuesta_proveedor,
        taller_diagnostico: selectedOffer.taller_diagnostico || root.taller_diagnostico,
        flujo_mantenimiento: selectedOffer.flujo_mantenimiento || root.flujo_mantenimiento,
        accion_solicitud_id: solicitudAccionId,
      };
    })
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
};

const dashboardServices = [
  { icon: "wrench-cog", title: "Solicitar\nMantenimiento", color: "#eaf0ff", route: "/service-request" },
  { icon: "clipboard-check-outline", title: "Alistamiento\nTecno", color: "#edf4ff" },
  { icon: "car-battery", title: "Bateria", color: "#eef9ef", quickRequest: true },
  { icon: "tire", title: "Llantas", color: "#fff6df", quickRequest: true },
  { icon: "oil", title: "Cambio de\nAceite", color: "#edf4ff", quickRequest: true },
  { icon: "car-wrench", title: "Tecnomecanica", color: "#f1f5ff" },
  { icon: "card-account-details-outline", title: "SOAT", color: "#edf4ff" },
  { icon: "shield-car", title: "Seguro", color: "#edf8ff" },
];

const clientSections = [
  "Vista general",
  "Panel de control",
  "Mis servicios",
  "Pagos",
  "Historial",
  "Soporte",
  "Configuracion",
];

const sectionIcons: Record<string, string> = {
  "Vista general": "view-dashboard-outline",
  "Panel de control": "car-outline",
  "Mis servicios": "clipboard-text-outline",
  Pagos: "credit-card-outline",
  Historial: "history",
  Soporte: "lifebuoy",
  Configuracion: "cog-outline",
};

export default function Dashboard() {
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const isMobile = width < 900;
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [talleres, setTalleres] = useState<Taller[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [userName, setUserName] = useState("Usuario");
  const [selectedSection, setSelectedSection] = useState("Mis servicios");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [serviceStatusFilter, setServiceStatusFilter] = useState<string>("Todos");
  const [newKilometraje, setNewKilometraje] = useState("");
  const [actionLoadingMessage, setActionLoadingMessage] = useState<string | null>(null);
  const [surveyRequestId, setSurveyRequestId] = useState<string | null>(null);
  const [surveyRating, setSurveyRating] = useState<number>(0);

  const redirigirAlLogin = () => {
    if (Platform.OS === "web") {
      window.location.href = "/";
      return;
    }

    const parentNavigation = navigation.getParent();

    if (parentNavigation) {
      parentNavigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "index" as never }],
        })
      );
      return;
    }

    router.replace("/");
  };

  const cerrarSesion = async () => {
    try {
      await storage.removeItem("token");
      await storage.removeItem("user_name");
      await storage.removeItem("user_role");
    } catch (error) {
      console.log("AsyncStorage logout fallback", error);
    }

    globalThis.localStorage?.removeItem("token");
    globalThis.localStorage?.removeItem("user_name");
    globalThis.localStorage?.removeItem("user_role");
    redirigirAlLogin();
  };

  const cargarDatos = async () => {
    try {
      const storedName = await storage.getItem("user_name");
      const token = await storage.getItem("token");

      if (storedName) {
        setUserName(storedName);
      }

      const response = await fetch(`${API_BASE_URL}/vehiculos`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const solicitudesResponse = await fetch(`${API_BASE_URL}/solicitudes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const talleresResponse = await fetch(`${API_BASE_URL}/talleres`);

      const notificacionesResponse = await fetch(`${API_BASE_URL}/notificaciones`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (
        response.status === 401 ||
        solicitudesResponse.status === 401 ||
        notificacionesResponse.status === 401
      ) {
        await cerrarSesion();
        return;
      }

      const data = await response.json();
      const solicitudesData = await solicitudesResponse.json();
      const talleresData = await talleresResponse.json();
      const notificacionesData = await notificacionesResponse.json();
      const items = Array.isArray(data) ? data : [];
      setVehiculos(items);
      setSolicitudes(
        filterVisibleClientRequests(Array.isArray(solicitudesData) ? solicitudesData : [])
      );
      setTalleres(Array.isArray(talleresData) ? talleresData : []);
      setNotificaciones(Array.isArray(notificacionesData) ? notificacionesData : []);

      const storedSection = await storage.getItem("client_dashboard_section");
      if (storedSection) {
        setSelectedSection(storedSection);
        await storage.removeItem("client_dashboard_section");
      }

      const storedExpandedServiceId = await storage.getItem("client_dashboard_expand_service_id");
      if (storedExpandedServiceId) {
        setExpandedServiceId(storedExpandedServiceId);
        setSelectedSection("Mis servicios");
        await storage.removeItem("client_dashboard_expand_service_id");
      }

      if (items[0]?.id != null) {
        if (!selectedVehicleId || !items.some((item) => String(item.id) === String(selectedVehicleId))) {
          setSelectedVehicleId(String(items[0].id));
          setNewKilometraje(formatNumberWithDots(items[0].kilometraje ?? ""));
        }
      } else {
        setSelectedVehicleId(null);
        setEditingVehicleId(null);
        setNewKilometraje("");
      }
    } catch (error) {
      console.log("Error cargando vehiculos", error);
      setVehiculos([]);
      setSolicitudes([]);
      setTalleres([]);
      setNotificaciones([]);
      setSelectedVehicleId(null);
      setEditingVehicleId(null);
      setNewKilometraje("");
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      cargarDatos();

      // Optimización: polling cada 30 segundos en lugar de 8 para reducir carga
      const interval = setInterval(() => {
        cargarDatos();
      }, 8000);

      return () => clearInterval(interval);
    }, [])
  );

  useEffect(() => {
    if (!isMobile) {
      setMenuOpen(false);
    }
  }, [isMobile]);

  const selectedVehicle = useMemo(
    () => vehiculos.find((item) => String(item.id) === String(selectedVehicleId)) || vehiculos[0],
    [selectedVehicleId, vehiculos]
  );

  const totalVehiculos = vehiculos.length;
  const solicitudesCotizacion = solicitudes.filter(
    (item) => isCreatedStatus(item.estado) || isInQuotationStatus(item.estado)
  ).length;
  const solicitudesProceso = solicitudes.filter((item) =>
    isQuotedStatus(item.estado) || isSentToClientStatus(item.estado) || normalizeStatus(item.estado) === "aprobada"
  ).length;
  const solicitudesFinalizadas = solicitudes.filter(
    (item) => isRejectedClientStatus(item.estado)
  ).length;
  const solicitudesHistorial = solicitudes.filter((item) => isHistoryStatus(item.estado));
  const solicitudesActivas = solicitudes.filter((item) => isOpenRequestStatus(item.estado));
  const unreadNotifications = notificaciones.filter((item) => !item.leida).length;
  const filteredSolicitudesActivas = (serviceStatusFilter === "Todos"
    ? solicitudesActivas
    : solicitudesActivas.filter(
        (item) => renderEstadoServicio(item).label === serviceStatusFilter
      )).sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

  const extraerSolicitudId = (mensaje?: string) => {
    const match = (mensaje || "").match(/#(\d+)/);
    return match?.[1] || null;
  };

  const abrirDesdeNotificacion = async (item: Notificacion) => {
    try {
      const token = await storage.getItem("token");
      await fetch(`${API_BASE_URL}/notificaciones/${item.id}/leer`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.log("Error marcando notificacion cliente", error);
    }

    const solicitudId = extraerSolicitudId(item.mensaje);
    const solicitud = solicitudes.find((current) => String(current.id) === String(solicitudId));
    const estado = normalizeStatus(solicitud?.estado);

    setShowNotifications(false);
    setSelectedSection(isHistoryStatus(estado) ? "Historial" : "Mis servicios");
    if (solicitudId) {
      setExpandedServiceId(solicitudId);
      setExpandedHistoryId(solicitudId);
    }
    setNotificaciones((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, leida: true } : notification
      )
    );
  };

  const normalizarTexto = (value?: string) => normalizeServiceText(value);

  const esSolicitudMantenimiento = (tipoServicio?: string) => {
    const servicio = normalizarTexto(tipoServicio);

    if (!servicio) return false;

    const partes = servicio
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return partes.some((parte) => !isQuoteWorkflowService(parte));
  };

  const tieneSolicitudMantenimientoActiva = (vehicleId: string | number | undefined) => {
    if (vehicleId == null) return false;

    return solicitudes.some((item) => {
      const estado = normalizeStatus(item.estado);

      return (
        String(item.vehiculo?.id) === String(vehicleId) &&
        !isHistoryStatus(estado) &&
        esSolicitudMantenimiento(item.tipo_servicio)
      );
    });
  };

  const tieneSolicitudPendientePorServicio = (
    vehicleId: string | number | undefined,
    serviceTitle: string
  ) => {
    if (vehicleId == null) return false;

    const servicioNormalizado = normalizarTexto(serviceTitle.replace("\n", " "));
    const palabrasClave =
      servicioNormalizado === "bateria"
        ? ["bateria"]
        : servicioNormalizado === "llantas"
          ? ["llanta", "llantas"]
          : servicioNormalizado === "cambio de aceite"
            ? ["aceite", "filtro", "filtros"]
            : [servicioNormalizado];

    return solicitudes.some((item) => {
      const estado = normalizeStatus(item.estado);
      const servicio = normalizarTexto(item.tipo_servicio);
      return (
        String(item.vehiculo?.id) === String(vehicleId) &&
        !isHistoryStatus(estado) &&
        palabrasClave.some((palabra) => servicio.includes(palabra))
      );
    });
  };

  const eliminarVehiculo = async (vehicleId: string | number) => {
    try {
      await withActionLoading("Eliminando vehiculo...", async () => {
        const token = await storage.getItem("token");

        const response = await fetch(`${API_BASE_URL}/vehiculos/${vehicleId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          alert("No se pudo eliminar el vehiculo" + (data ? `: ${JSON.stringify(data)}` : ""));
          return;
        }

        await cargarDatos();
        setSelectedVehicleId(null);
        alert("Vehiculo eliminado correctamente");
      });
    } catch (error) {
      console.log("Error eliminando vehiculo", error);
      alert("Error eliminando el vehiculo");
    }
  };

  const confirmarEliminacion = (vehicle: Vehiculo) => {
    const vehicleName = `${vehicle.marca ?? ""} ${vehicle.modelo ?? ""}`.trim() || "este vehiculo";
    const tieneSolicitudActiva = solicitudes.some(
      (item) =>
        String(item.vehiculo?.id) === String(vehicle.id) &&
        isOpenRequestStatus(item.estado)
    );

    if (tieneSolicitudActiva) {
      Alert.alert(
        "Vehiculo con solicitud activa",
        "No puedes eliminar este vehiculo mientras tenga una solicitud activa."
      );
      return;
    }

    if (Platform.OS === "web") {
      const confirmado = globalThis.confirm?.(`¿Deseas eliminar ${vehicleName}?`);

      if (confirmado && vehicle.id != null) {
        eliminarVehiculo(vehicle.id);
      }

      return;
    }

    Alert.alert("Eliminar vehiculo", `¿Deseas eliminar ${vehicleName}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          if (vehicle.id != null) {
            eliminarVehiculo(vehicle.id);
          }
        },
      },
    ]);
  };

  const iniciarEdicionKilometraje = (vehicle: Vehiculo) => {
    setEditingVehicleId(String(vehicle.id));
    setNewKilometraje(formatNumberWithDots(vehicle.kilometraje ?? ""));
  };

  const guardarKilometraje = async (vehicleId: string | number) => {
    const value = parseFormattedNumber(newKilometraje);
    const currentMileage = Number(
      vehiculos.find((item) => String(item.id) === String(vehicleId))?.kilometraje ?? 0
    );

    if (!value) {
      alert("El kilometraje debe ser numerico");
      return;
    }

    if (value <= currentMileage) {
      alert("El nuevo kilometraje debe ser superior al kilometraje actual");
      return;
    }

    try {
      await withActionLoading("Actualizando kilometraje...", async () => {
        const token = await storage.getItem("token");

        const response = await fetch(`${API_BASE_URL}/vehiculos/${vehicleId}/kilometraje`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            kilometraje: value,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          alert("No se pudo actualizar el kilometraje" + (data?.detail ? `: ${data.detail}` : ""));
          return;
        }

        setEditingVehicleId(null);
        await cargarDatos();
        alert("Kilometraje actualizado correctamente");
      });
    } catch (error) {
      console.log("Error actualizando kilometraje", error);
      alert("Error conectando con el servidor");
    }
  };

  const crearSolicitudRapida = async (vehicle: Vehiculo, serviceTitle: string) => {
    if (!vehicle.id) {
      alert("El vehiculo seleccionado no es valido");
      return;
    }

    try {
      await withActionLoading("Creando solicitud...", async () => {
        const token = await storage.getItem("token");
        const response = await fetch(`${API_BASE_URL}/solicitudes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            vehiculo_id: Number(vehicle.id),
            tipo: serviceTitle.replace("\n", " "),
            descripcion: `Solicitud de ${serviceTitle.replace("\n", " ")}`.slice(0, 50),
            disponibilidad_cliente: "Por coordinar con el cliente",
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          alert("No se pudo crear la solicitud" + (data?.detail ? `: ${data.detail}` : ""));
          return;
        }

        await cargarDatos();
        setSelectedSection("Panel de control");
        alert("Solicitud enviada al administrador correctamente");
      });
    } catch (error) {
      console.log("Error creando solicitud rapida", error);
      alert("Error conectando con el servidor");
    }
  };

  const confirmarServicioRapido = (vehicle: Vehiculo, serviceTitle: string) => {
    const text = `¿Confirmas solicitar el servicio ${serviceTitle.replace("\n", " ")} para ${vehicle.marca} ${vehicle.modelo}?`;

    if (Platform.OS === "web") {
      const confirmed = globalThis.confirm?.(text);
      if (confirmed) {
        crearSolicitudRapida(vehicle, serviceTitle);
      }
      return;
    }

    Alert.alert("Confirmar servicio", text, [
      { text: "Cancelar", style: "cancel" },
      { text: "Confirmar", onPress: () => crearSolicitudRapida(vehicle, serviceTitle) },
    ]);
  };

  const renderVehiclesSection = () => (
    <View style={styles.cardsSection}>
      {vehiculos.length === 0 ? (
        <View style={styles.emptyVehiclesCard}>
          <MaterialCommunityIcons name="car-off" size={42} color="#2563eb" />
          <Text style={styles.emptyVehiclesTitle}>Aun no tienes vehiculos registrados</Text>
          <Text style={styles.emptyVehiclesText}>
            Registra tu primer vehiculo para comenzar a gestionar mantenimientos y solicitudes.
          </Text>
        </View>
      ) : null}

      {vehiculos.map((item) => {
        const selected = String(item.id) === String(selectedVehicleId);
        const isEditing = String(item.id) === String(editingVehicleId);
        const hasActiveRequest = solicitudes.some(
          (solicitud) =>
            String(solicitud.vehiculo?.id) === String(item.id) &&
            isOpenRequestStatus(solicitud.estado)
        );

        return (
          <View key={String(item.id)} style={styles.cardBlock}>
            <TouchableOpacity
              style={[styles.vehicleCard, selected && styles.vehicleCardSelected]}
              onPress={() =>
                setSelectedVehicleId((current) =>
                  current === String(item.id) ? null : String(item.id)
                )
              }
              activeOpacity={0.95}
            >
              <Text style={styles.vehicleTitle}>
                {item.marca} {item.modelo} {item.anio}
              </Text>

              <View style={styles.vehicleRow}>
                <View style={styles.kmBlock}>
                  <View style={styles.kmLine}>
                    <MaterialCommunityIcons name="map-marker" size={18} color="#ff9f1c" />
                  <Text style={styles.kmLabel}>Kilometraje:</Text>
                  </View>
                  <Text style={styles.kmValue}>{formatKilometraje(item.kilometraje)}</Text>

                  {!isEditing ? (
                    <TouchableOpacity
                      style={styles.kmButton}
                      onPress={() => iniciarEdicionKilometraje(item)}
                    >
                      <MaterialCommunityIcons name="plus" size={16} color="#fff" />
                      <Text style={styles.kmButtonText}>Actualizar kilometraje</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.kmEditor}>
                      <TextInput
                        style={styles.kmInput}
                        value={newKilometraje}
                        onChangeText={(value) => setNewKilometraje(formatNumberWithDots(value))}
                        keyboardType="numeric"
                        placeholder="Nuevo kilometraje"
                        placeholderTextColor="#94a3b8"
                      />
                      <View style={styles.kmEditorActions}>
                        <TouchableOpacity
                          style={styles.kmSaveButton}
                          onPress={() => item.id != null && guardarKilometraje(item.id)}
                        >
                          <Text style={styles.kmSaveText}>Guardar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.kmCancelButton}
                          onPress={() => setEditingVehicleId(null)}
                        >
                          <Text style={styles.kmCancelText}>Cancelar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>

                <View style={styles.gaugeCard}>
                  <MaterialCommunityIcons name="speedometer" size={72} color="#ffb100" />
                  <Text style={styles.gaugeText}>{formatKilometraje(item.kilometraje)}</Text>
                  <MaterialCommunityIcons name="car-sports" size={42} color="#4a7dff" />
                </View>
              </View>
            </TouchableOpacity>

            {selected ? (
              <View style={styles.expandedPanel}>
                <View style={styles.servicesGrid}>
                  {dashboardServices.map((service) => {
                    const isBlocked =
                      service.quickRequest
                        ? tieneSolicitudPendientePorServicio(item.id, service.title)
                        : service.route === "/service-request"
                        ? tieneSolicitudMantenimientoActiva(item.id)
                        : false;

                    return (
                      <TouchableOpacity
                        key={service.title}
                        style={[
                          styles.serviceCard,
                          isMobile && styles.serviceCardMobile,
                          { backgroundColor: service.color },
                          isBlocked && styles.serviceCardDisabled,
                        ]}
                        disabled={isBlocked}
                        onPress={
                          service.quickRequest
                            ? () => confirmarServicioRapido(item, service.title)
                            : service.route
                              ? () => router.push(service.route as any)
                              : undefined
                        }
                      >
                        <MaterialCommunityIcons
                          name={service.icon as any}
                          size={38}
                          color={isBlocked ? "#8fa0bf" : "#2f5597"}
                        />
                        <Text style={[styles.serviceText, isBlocked && styles.serviceTextDisabled]}>
                          {service.title}
                        </Text>
                        {isBlocked ? (
                          <Text style={styles.serviceDisabledHint}>
                            {service.quickRequest ? "Servicio ya solicitado" : "Vehiculo con solicitud activa"}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[
                      styles.deleteVehicleButton,
                      hasActiveRequest && styles.deleteVehicleButtonDisabled,
                    ]}
                    onPress={() => confirmarEliminacion(item)}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color="#dc2626" />
                    <Text style={styles.deleteVehicleText}>
                      {hasActiveRequest ? "Vehiculo con solicitud activa" : "Eliminar vehiculo"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );

  const renderPlaceholderSection = (title: string, subtitle: string, icon: string) => (
    <View style={styles.placeholderCard}>
      <MaterialCommunityIcons name={icon as any} size={42} color="#2563eb" />
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderText}>{subtitle}</Text>
    </View>
  );

  const renderBlockedSection = (title: string, icon: string) => (
    <View style={styles.placeholderCard}>
      <MaterialCommunityIcons name={icon as any} size={42} color="#94a3b8" />
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderText}>
        Este modulo esta bloqueado porque todavia no se ha desarrollado.
      </Text>
    </View>
  );

  function renderEstadoServicio(itemOrEstado?: Solicitud | string) {
    const item =
      typeof itemOrEstado === "object" && itemOrEstado != null ? itemOrEstado : undefined;
    const estado = typeof itemOrEstado === "string" ? itemOrEstado : item?.estado;
    const normalizado = normalizeStatus(estado);
    const esMantenimientoConAprobacionClientePendiente =
      Boolean(item?.flujo_mantenimiento?.timeline?.cliente_aprueba_propuesta_en) &&
      !Boolean(item?.flujo_mantenimiento?.timeline?.cliente_finaliza_servicio_en) &&
      !isFinishedStatus(normalizado);

    let label = getStatusLabel(normalizado);

    if (esMantenimientoConAprobacionClientePendiente) {
      label = "Aprobada";
    }

    if (normalizado === "en_asignacion_taller") {
      label = "En asignacion de taller";
    }

    if (normalizado === "pendiente_envio_cliente_taller") {
      label = "Esperando confirmacion del cliente";
    }

    if (isQuotedStatus(normalizado)) {
      label = "En cotizacion";
    }

    if (isSentToClientStatus(normalizado)) {
      label = "Enviada al cliente";
    }

    if (isWaitingClientStatus(normalizado)) {
      label = "En espera de cliente";
    }

    if (
      isCreatedStatus(normalizado) ||
      normalizado === "en_revision" ||
      isInDiagnosisStatus(normalizado) ||
      isDiagnosedStatus(normalizado) ||
      isInQuotationStatus(normalizado)
    ) {
      return { label, backgroundColor: "#fff7d6", color: "#b7791f" };
    }

    if (
      isQuotedStatus(normalizado) ||
      isProposalReadyStatus(normalizado) ||
      isSentToClientStatus(normalizado) ||
      normalizado === "aprobada" ||
      isWaitingClientStatus(normalizado) ||
      esMantenimientoConAprobacionClientePendiente
    ) {
      return { label, backgroundColor: "#dcfce7", color: "#15803d" };
    }

    if (isInProcessStatus(normalizado)) {
      return { label, backgroundColor: "#e0f2fe", color: "#0369a1" };
    }

    if (isFinishedStatus(normalizado)) {
      return { label, backgroundColor: "#dcfce7", color: "#166534" };
    }

    if (isCancelledStatus(normalizado)) {
      return { label, backgroundColor: "#e2e8f0", color: "#475569" };
    }

    if (isRejectedClientStatus(normalizado) || isRejectedWorkshopStatus(normalizado)) {
      return { label, backgroundColor: "#fee2e2", color: "#b91c1c" };
    }

    return { label, backgroundColor: "#eef2ff", color: "#3730a3" };
  }

  const separarValoresCotizacion = (value?: string | null) =>
    (value || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

  const obtenerRespuestasCliente = (item: Solicitud) => {
    if (item.cotizacion?.respuestas && item.cotizacion.respuestas.length > 0) {
      const respuestasValidas = item.cotizacion.respuestas.filter((respuesta) =>
        [
          respuesta.marca,
          respuesta.referencia,
          respuesta.garantia,
          respuesta.disponibilidad,
          respuesta.precio,
          respuesta.observacion,
          respuesta.documento_excel_nombre,
        ].some((value) => String(value || "").trim().length > 0)
      );

      if (respuestasValidas.length > 0) {
        return respuestasValidas;
      }
    }

    const marcas = separarValoresCotizacion(item.cotizacion?.marca);
    const referencias = separarValoresCotizacion(item.cotizacion?.referencia);
    const garantias = separarValoresCotizacion(item.cotizacion?.garantia);
    const disponibilidades = separarValoresCotizacion(item.cotizacion?.disponibilidad);
    const precios = separarValoresCotizacion(item.cotizacion?.precio);
    const observaciones = separarValoresCotizacion(item.cotizacion?.observacion);

    const total = Math.max(
      marcas.length,
      referencias.length,
      garantias.length,
      disponibilidades.length,
      precios.length,
      observaciones.length
    );

    return Array.from({ length: total }, (_, index) => ({
      solicitud_id: item.id ?? null,
      proveedor_id: null,
      proveedor_nombre: null,
      marca: marcas[index] || null,
      referencia: referencias[index] || null,
      garantia: garantias[index] || null,
      disponibilidad: disponibilidades[index] || null,
      precio: precios[index] || null,
      observacion: observaciones[index] || null,
      documento_excel_nombre: item.cotizacion?.documento_excel_nombre || null,
      documento_excel_mime: item.cotizacion?.documento_excel_mime || null,
      documento_excel_base64: item.cotizacion?.documento_excel_base64 || null,
    }));
  };

  const agruparRespuestasClientePorProveedor = (respuestas: ReturnType<typeof obtenerRespuestasCliente>) => {
    const grouped = new Map<string, {
      solicitud_id: string | number | null;
      proveedor_id: string | number | null;
      proveedor_nombre: string | null;
      respuestas: typeof respuestas;
    }>();

    respuestas.forEach((respuesta, index) => {
      const key = String(respuesta.proveedor_id ?? `sin-proveedor-${index}`);
      const current = grouped.get(key);

      if (current) {
        current.respuestas.push(respuesta);
        return;
      }

      grouped.set(key, {
        solicitud_id: respuesta.solicitud_id ?? null,
        proveedor_id: respuesta.proveedor_id ?? null,
        proveedor_nombre: `Oferta ${String.fromCharCode(65 + grouped.size)}`,
        respuestas: [respuesta],
      });
    });

    return Array.from(grouped.values());
  };

  const parseCurrencyValue = (value?: string | null) => {
    const normalized = String(value || "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const parseHoursValue = (value?: string | null) => {
    const normalized = String(value || "")
      .replace(/[^\d,.-]/g, "")
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const calcularTotalCotizacionCliente = (
    respuestas: ReturnType<typeof obtenerRespuestasCliente>,
    item: Solicitud
  ) => {
    const totalRepuestos = respuestas.reduce(
      (sum, respuesta) => sum + parseCurrencyValue(respuesta.precio),
      0
    );
    const horas = parseHoursValue(item.taller_diagnostico?.horas);
    return totalRepuestos + horas * 100000;
  };

  const solicitudPermiteAprobacion = (item: Solicitud) => {
    const estado = (item.estado || "").toLowerCase();
    return isSentToClientStatus(estado);
  };

  const solicitudPermiteLlegadaTaller = (item: Solicitud) => {
    const estado = normalizeStatus(item.estado);
    return (
      esSolicitudMantenimiento(item.tipo_servicio) &&
      (isWaitingClientStatus(estado) || estado === "pendiente_envio_cliente_taller")
    );
  };

  const solicitudPermiteFinalizacionCliente = (item: Solicitud) => {
    const confirmaciones = item.flujo_mantenimiento?.confirmaciones || {};
    const timeline = item.flujo_mantenimiento?.timeline || {};
    const estado = normalizeStatus(item.estado);
    const haAprobado = Boolean(timeline.cliente_aprueba_propuesta_en) || isApprovedStatus(estado);
    const tallerFinalizo = Boolean(confirmaciones.taller_reparacion_finalizada);
    return (
      esSolicitudMantenimiento(item.tipo_servicio) &&
      haAprobado &&
      tallerFinalizo &&
      !isFinishedStatus(item.estado)
    );
  };

  const withActionLoading = async <T,>(message: string, action: () => Promise<T>) => {
    try {
      setActionLoadingMessage(message);
      return await action();
    } finally {
      setActionLoadingMessage(null);
    }
  };

  const aprobarSolicitudCliente = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    try {
      await withActionLoading("Aprobando solicitud...", async () => {
      const token = await storage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/aprobar-cliente`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo aprobar la solicitud");
        return;
      }

      await cargarDatos();
      Alert.alert("Aprobada", "La solicitud fue aprobada y se notifico al administrador, taller y proveedor.");
      });
    } catch (error) {
      console.log("Error aprobando solicitud cliente", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const rechazarOfertaCliente = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    try {
      await withActionLoading("Rechazando solicitud...", async () => {
      const token = await storage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/rechazar-oferta-cliente`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo rechazar la oferta");
        return;
      }

      await cargarDatos();
      Alert.alert("Oferta rechazada", "La oferta fue rechazada y se oculto del cliente.");
      });
    } catch (error) {
      console.log("Error rechazando oferta cliente", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const confirmarLlegadaTaller = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    try {
      await withActionLoading("Confirmando llegada al taller...", async () => {
      const token = await storage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/llegada-taller`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo confirmar la llegada al taller");
        return;
      }

      await cargarDatos();
      Alert.alert("Llegada confirmada", "El taller ya puede iniciar el diagnostico.");
      });
    } catch (error) {
      console.log("Error confirmando llegada al taller", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const finalizarSolicitudCliente = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;
    if (!surveyRating) {
      Alert.alert("Calificacion requerida", "Debes seleccionar una calificacion para finalizar.");
      return;
    }

    try {
      await withActionLoading("Finalizando servicio...", async () => {
        const token = await storage.getItem("token");
        const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/finalizar-cliente`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            calificacion: surveyRating,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          Alert.alert("Error", data.detail || "No se pudo finalizar la solicitud");
          return;
        }

        setSurveyRequestId(null);
        setSurveyRating(0);
        await cargarDatos();
        Alert.alert("Servicio finalizado", "Gracias por confirmar la finalizacion del servicio.");
      });
    } catch (error) {
      console.log("Error finalizando solicitud cliente", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const obtenerTituloSolicitud = (item: Solicitud) => {
    const servicio = normalizarTexto(item.tipo_servicio);

    if (
      servicio.includes(",") ||
      servicio.includes(":") ||
      servicio.includes("mantenimiento") ||
      servicio.includes("diagnostico")
    ) {
      return item.tipo_servicio || "Servicio solicitado";
    }

    if (servicio.includes("llanta")) return "Solicitud de llantas";
    if (servicio.includes("bateria")) return "Solicitud de bateria";
    if (servicio.includes("aceite") || servicio.includes("filtro")) return "Solicitud de aceite";

    return item.tipo_servicio || "Servicio solicitado";
  };

  const obtenerNumeroCaso = (item: Solicitud) => item.numero_caso ?? item.solicitud_origen_id ?? item.id;

  const filtrosEstadoCliente = [
    "Todos",
    "Creada",
    "En revision",
    "En asignacion de taller",
    "En diagnostico",
    "Diagnosticada",
    "Coordinando visita al taller",
    "En cotizacion",
    "Cotizada",
    "Propuesta armada",
    "Enviada al cliente",
    "Aprobada",
    "En proceso",
    "Finalizada",
  ];

  const obtenerResumenProblema = (value?: string | null) => {
    const text = String(value || "").trim();
    if (!text) return "Sin detalle registrado";
    return text.length > 72 ? `${text.slice(0, 72).trim()}...` : text;
  };

  const obtenerTrackingIntervencion = (item: Solicitud) => {
    const confirmaciones = item.flujo_mantenimiento?.confirmaciones || {};

    return [
      {
        label: "Proveedor despacho repuestos",
        completed: Boolean(confirmaciones.proveedor_despacho_confirmado),
      },
      {
        label: "Taller inicio intervencion",
        completed: Boolean(confirmaciones.taller_inicio_intervencion_confirmado),
      },
      {
        label: "Taller recibio repuestos",
        completed: Boolean(confirmaciones.taller_recibe_repuestos_confirmado),
      },
      {
        label: "Reparacion final",
        completed: Boolean(confirmaciones.taller_reparacion_finalizada),
      },
    ];
  };

  const renderServicesSection = () => {
    if (solicitudesActivas.length === 0) {
      return (
        <View style={styles.placeholderCard}>
          <MaterialCommunityIcons name="clipboard-text-outline" size={42} color="#2563eb" />
          <Text style={styles.placeholderTitle}>Mis servicios</Text>
          <Text style={styles.placeholderText}>
            Aqui apareceran los servicios solicitados al administrador y su estado actual.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.servicesListSection}>
        <View style={styles.moduleHeaderCard}>
          <View style={styles.moduleHeaderText}>
            <Text style={styles.moduleHeaderTitle}>Modulo: Ordenes</Text>
            <Text style={styles.moduleHeaderSubtitle}>
              Gestion centralizada de la operacion del sistema.
            </Text>
          </View>
          <View style={styles.moduleHeaderBadge}>
            <MaterialCommunityIcons name="clipboard-list-outline" size={18} color="#2563eb" />
            <Text style={styles.moduleHeaderBadgeText}>{filteredSolicitudesActivas.length}</Text>
          </View>
        </View>

        <Text style={styles.servicesSectionTitle}>Solicitudes</Text>

        <View style={styles.filterToolbar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterWrap}
          >
            {filtrosEstadoCliente.map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.filterChip,
                  serviceStatusFilter === filter && styles.filterChipActive,
                ]}
                onPress={() => setServiceStatusFilter(filter)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    serviceStatusFilter === filter && styles.filterChipTextActive,
                  ]}
                >
                  {filter}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.filterActionButton} activeOpacity={0.9}>
            <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
          </TouchableOpacity>
        </View>
        {filteredSolicitudesActivas.map((item) => {
          const estadoInfo = renderEstadoServicio(item);
          const respuestasCliente = obtenerRespuestasCliente(item);
          const expanded = expandedServiceId === String(item.id);
          const mostrarTalleres = false;
          const trackingSteps = obtenerTrackingIntervencion(item);

          return (
            <TouchableOpacity
              key={String(item.id)}
              style={[styles.serviceRequestCard, expanded && styles.serviceRequestCardExpanded]}
              activeOpacity={0.96}
              onPress={() =>
                setExpandedServiceId((current) => (current === String(item.id) ? null : String(item.id)))
              }
            >
              <View style={styles.serviceRequestHeader}>
                <View style={styles.serviceRequestHeaderContent}>
                  <Text style={styles.serviceRequestTitle}>{obtenerTituloSolicitud(item)}</Text>
                  <Text style={styles.serviceRequestVehicle}>
                    {`${item.vehiculo?.marca || ""} ${item.vehiculo?.modelo || ""}`.trim() ||
                      "Vehiculo"}
                    {item.vehiculo?.placa ? ` • ${item.vehiculo.placa}` : ""}
                    </Text>
                  <View style={styles.serviceMetaList}>
                    <View style={styles.serviceMetaRow}>
                      <MaterialCommunityIcons name="calendar-blank-outline" size={16} color="#6b7280" />
                      <Text style={styles.serviceMetaItemText}>{formatDateTime(item.fecha)}</Text>
                    </View>
                    <View style={styles.serviceMetaRow}>
                      <MaterialCommunityIcons name="tools" size={16} color="#6b7280" />
                      <Text style={styles.serviceMetaItemText}>
                        Problema: {obtenerResumenProblema(item.problema)}
                      </Text>
                    </View>
                  </View>
                </View>

                <View
                  style={[
                    styles.serviceStatusPill,
                    { backgroundColor: estadoInfo.backgroundColor },
                  ]}
                >
                  <Text style={[styles.serviceStatusText, { color: estadoInfo.color }]}>
                    {estadoInfo.label}
                  </Text>
                </View>
              </View>

              {expanded ? (
                <>
                  <Text style={styles.serviceRequestDescription}>
                    {item.problema || "Solicitud enviada al administrador para revision."}
                  </Text>
                  {item.respuesta_taller?.fecha_disponible || item.respuesta_taller?.horario_disponible ? (
                    <>
                      <Text style={styles.serviceRequestDescription}>
                        Fecha propuesta por el taller: {formatWorkshopDateLabel(item.respuesta_taller?.fecha_disponible)}
                      </Text>
                      <Text style={styles.serviceRequestDescription}>
                        Horario propuesto por el taller: {formatWorkshopTimeLabel(item.respuesta_taller?.horario_disponible)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.serviceRequestDescription}>
                      Disponibilidad registrada: {item.disponibilidad_cliente || "Sin registrar"}
                    </Text>
                  )}
                  <Text style={styles.serviceRequestMeta}>Solicitud #{obtenerNumeroCaso(item)}</Text>
                </>
              ) : null}
              <Text style={styles.quoteExpandHint}>
                {expanded ? "Toca para ocultar el detalle" : "Toca la tarjeta para ver el detalle"}
              </Text>

              {expanded && isSentToClientStatus(item.estado) && respuestasCliente.length ? (
                <View style={styles.clientQuoteList}>
                  {agruparRespuestasClientePorProveedor(respuestasCliente).map((grupo, index) => (
                    <View key={`quote-${item.id}-${grupo.proveedor_id ?? index}`} style={styles.clientQuoteCard}>
                      <Text style={styles.clientQuoteTitle}>
                        {grupo.proveedor_nombre || `Cotizacion ${index + 1}`}
                      </Text>
                      <Text style={styles.serviceRequestDescription}>
                        Repuestos cotizados: {grupo.respuestas.length}
                      </Text>
                      {(item.taller_diagnostico?.diagnostico || item.taller_diagnostico?.servicios || item.taller_diagnostico?.horas || item.taller_diagnostico?.materiales) ? (
                        <View style={styles.clientQuoteDiagnosticBlock}>
                          <Text style={styles.clientQuoteDiagnosticTitle}>Diagnostico del taller</Text>
                          <Text style={styles.serviceRequestDescription}>
                            Diagnostico: {item.taller_diagnostico?.diagnostico || "Sin diagnostico"}
                          </Text>
                          <Text style={styles.serviceRequestDescription}>
                            Servicios: {item.taller_diagnostico?.servicios || "Sin servicios"}
                          </Text>
                          <Text style={styles.serviceRequestDescription}>
                            Horas estimadas: {item.taller_diagnostico?.horas || "Sin horas"}
                          </Text>
                          <Text style={styles.serviceRequestDescription}>
                            Repuestos solicitados: {item.taller_diagnostico?.materiales || "Sin materiales"}
                          </Text>
                        </View>
                      ) : null}
                      {grupo.respuestas.map((respuesta, respuestaIndex) => (
                        <View
                          key={`quote-detail-${item.id}-${grupo.proveedor_id ?? index}-${respuestaIndex}`}
                          style={styles.clientQuoteItem}
                        >
                          <Text style={styles.serviceRequestDescription}>Marca: {respuesta.marca || "Sin marca"}</Text>
                          <Text style={styles.serviceRequestDescription}>
                            Referencia: {respuesta.referencia || "Sin referencia"}
                          </Text>
                          <Text style={styles.serviceRequestDescription}>
                            Garantia: {respuesta.garantia || "Sin garantia"}
                          </Text>
                          <Text style={styles.serviceRequestDescription}>
                            Disponibilidad: {respuesta.disponibilidad || "Sin disponibilidad"}
                          </Text>
                          <Text style={styles.serviceRequestDescription}>Precio: {respuesta.precio || "0"}</Text>
                          <Text style={styles.serviceRequestDescription}>
                            Observacion: {respuesta.observacion || "Sin observacion"}
                          </Text>
                        </View>
                      ))}
                      <Text style={styles.clientQuoteTotal}>
                        Valor total: {formatCurrency(calcularTotalCotizacionCliente(grupo.respuestas, item))}
                      </Text>
                      {solicitudPermiteAprobacion(item) ? (
                        <View style={styles.clientQuoteActions}>
                          <TouchableOpacity
                            style={styles.payButton}
                            onPress={() => aprobarSolicitudCliente(grupo.solicitud_id || item.accion_solicitud_id || item.id)}
                          >
                            <Text style={styles.payButtonText}>
                              {esSolicitudMantenimiento(item.tipo_servicio) ? "Aprobar propuesta" : "Pagar"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  ))}
                  {solicitudPermiteAprobacion(item) ? (
                    <TouchableOpacity
                      style={styles.rejectOfferButton}
                      onPress={() => rechazarOfertaCliente(item.accion_solicitud_id || item.id)}
                    >
                      <Text style={styles.rejectOfferButtonText}>Rechazar solicitud</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {expanded && solicitudPermiteLlegadaTaller(item) ? (
                <TouchableOpacity
                  style={styles.arrivalButton}
                  onPress={() => confirmarLlegadaTaller(item.accion_solicitud_id || item.id)}
                >
                  <Text style={styles.arrivalButtonText}>Llegada a taller</Text>
                </TouchableOpacity>
              ) : null}

              {expanded && solicitudPermiteFinalizacionCliente(item) ? (
                <TouchableOpacity
                  style={styles.payButton}
                  onPress={() => {
                    setSurveyRequestId(String(item.accion_solicitud_id || item.id));
                    setSurveyRating(0);
                  }}
                >
                  <Text style={styles.payButtonText}>Finalizar servicio</Text>
                </TouchableOpacity>
              ) : null}

              {expanded && esSolicitudMantenimiento(item.tipo_servicio) && item.flujo_mantenimiento?.repuestos_solicitados?.length ? (
                <View style={styles.workshopListCard}>
                  <Text style={styles.workshopListTitle}>Repuestos solicitados</Text>
                  {item.flujo_mantenimiento.repuestos_solicitados.map((repuesto, index) => (
                    <Text key={`${item.id}-repuesto-${index}`} style={styles.serviceRequestDescription}>
                      {(repuesto.nombre || "Repuesto").trim()} x{repuesto.cantidad || 0}
                    </Text>
                  ))}
                </View>
              ) : null}

              {expanded &&
              isDiagnosedStatus(item.estado) &&
              (item.taller_diagnostico?.diagnostico ||
                item.taller_diagnostico?.servicios ||
                item.taller_diagnostico?.horas ||
                item.taller_diagnostico?.materiales) ? (
                <View style={styles.clientQuoteDiagnosticBlock}>
                  <Text style={styles.clientQuoteDiagnosticTitle}>Diagnostico del taller</Text>
                  <Text style={styles.serviceRequestDescription}>
                    Diagnostico: {item.taller_diagnostico?.diagnostico || "Sin diagnostico"}
                  </Text>
                  <Text style={styles.serviceRequestDescription}>
                    Servicios: {item.taller_diagnostico?.servicios || "Sin servicios"}
                  </Text>
                  <Text style={styles.serviceRequestDescription}>
                    Horas: {item.taller_diagnostico?.horas || "Sin horas"}
                  </Text>
                  <Text style={styles.serviceRequestDescription}>
                    Materiales: {item.taller_diagnostico?.materiales || "Sin materiales"}
                  </Text>
                </View>
              ) : null}

              {expanded && mostrarTalleres ? (
                <View style={styles.workshopListCard}>
                  <Text style={styles.workshopListTitle}>Talleres disponibles</Text>
                  {talleres.length > 0 ? (
                    talleres.map((taller) => (
                      <View key={`taller-${taller.id}`} style={styles.workshopItem}>
                        <Text style={styles.workshopName}>{taller.nombre || "Taller"}</Text>
                        <Text style={styles.workshopMeta}>
                          {taller.email || "Sin email"} {taller.telefono ? `• ${taller.telefono}` : ""}
                        </Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.serviceRequestDescription}>
                      No hay talleres disponibles registrados.
                    </Text>
                  )}
                </View>
              ) : null}

              {expanded && item.respuesta_proveedor?.comentario ? (
                <View style={styles.workshopListCard}>
                  <Text style={styles.workshopListTitle}>Mensaje del proveedor</Text>
                  <Text style={styles.serviceRequestDescription}>
                    {item.respuesta_proveedor.comentario}
                  </Text>
                </View>
              ) : null}

              {expanded && (item.respuesta_taller?.fecha_disponible || item.respuesta_taller?.horario_disponible || item.respuesta_taller?.comentario) ? (
                <View style={styles.clientQuoteCard}>
                  <Text style={styles.clientQuoteTitle}>Informacion para acercarte al taller</Text>
                  <Text style={styles.serviceRequestDescription}>
                    Fecha disponible: {formatWorkshopDateLabel(item.respuesta_taller.fecha_disponible)}
                  </Text>
                  <Text style={styles.serviceRequestDescription}>
                    Horario disponible: {formatWorkshopTimeLabel(item.respuesta_taller.horario_disponible)}
                  </Text>
                  <Text style={styles.serviceRequestDescription}>
                    Comentario del taller: {item.respuesta_taller.comentario || item.observacion || "Sin comentario"}
                  </Text>
                </View>
              ) : null}

              {expanded && esSolicitudMantenimiento(item.tipo_servicio) ? (
                <View style={styles.workshopListCard}>
                  <Text style={styles.workshopListTitle}>Seguimiento de la intervencion</Text>
                  {trackingSteps.map((step) => (
                    <View key={`${item.id}-${step.label}`} style={styles.timelineStep}>
                      <View
                        style={[
                          styles.timelineIcon,
                          step.completed && styles.timelineIconCompleted,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={step.completed ? "check" : "clock-outline"}
                          size={14}
                          color={step.completed ? "#1d4ed8" : "#64748b"}
                        />
                      </View>
                      <View style={styles.timelineTextGroup}>
                        <Text style={styles.timelineLabel}>{step.label}</Text>
                        <Text style={styles.timelineState}>
                          {step.completed ? "Confirmado" : "Pendiente"}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {expanded && item.flujo_mantenimiento?.encuesta_satisfaccion?.calificacion ? (
                <View style={styles.clientQuoteCard}>
                  <Text style={styles.clientQuoteTitle}>Calificacion registrada</Text>
                  <Text style={styles.serviceRequestDescription}>
                    Calificacion: {"★".repeat(Number(item.flujo_mantenimiento.encuesta_satisfaccion.calificacion || 0))}
                    {"☆".repeat(5 - Number(item.flujo_mantenimiento.encuesta_satisfaccion.calificacion || 0))}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderHistorySection = () => {
    if (solicitudesHistorial.length === 0) {
      return renderPlaceholderSection(
        "Historial",
        "Aqui podras consultar el historial de servicios realizados a tus vehiculos.",
        "history"
      );
    }

    return (
      <View style={styles.servicesListSection}>
        {solicitudesHistorial.map((item) => {
          const estadoInfo = renderEstadoServicio(item.estado);

          const isReturned = isRejectedClientStatus(item.estado);
          const expanded = expandedHistoryId === String(item.id);

          return (
            <TouchableOpacity
              key={`history-${item.id}`}
              style={styles.serviceRequestCard}
              activeOpacity={0.96}
              onPress={() =>
                setExpandedHistoryId((current) => (current === String(item.id) ? null : String(item.id)))
              }
            >
              <View style={styles.serviceRequestHeader}>
                <View style={styles.serviceRequestHeaderContent}>
                  <Text style={styles.serviceRequestTitle}>
                    {obtenerTituloSolicitud(item)}
                  </Text>
                  <Text style={styles.serviceRequestVehicle}>
                    {`${item.vehiculo?.marca || ""} ${item.vehiculo?.modelo || ""}`.trim() ||
                      "Vehiculo"}
                    {item.vehiculo?.placa ? ` • ${item.vehiculo.placa}` : ""}
                  </Text>
                </View>

                <View
                  style={[
                    styles.serviceStatusPill,
                    { backgroundColor: estadoInfo.backgroundColor },
                  ]}
                >
                  <Text style={[styles.serviceStatusText, { color: estadoInfo.color }]}>
                    {estadoInfo.label}
                  </Text>
                </View>
              </View>

              {expanded || !isReturned ? (
                <>
                  <Text style={styles.serviceRequestVehicle}>
                    {`${item.vehiculo?.marca || ""} ${item.vehiculo?.modelo || ""}`.trim() ||
                      "Vehiculo"}
                    {item.vehiculo?.placa ? ` • ${item.vehiculo.placa}` : ""}
                  </Text>
                  <Text style={styles.serviceRequestDescription}>
                    {item.problema || "Solicitud enviada al administrador para revision."}
                  </Text>
                  <Text style={styles.serviceRequestMeta}>Solicitud #{obtenerNumeroCaso(item)}</Text>
                  <Text style={styles.serviceRequestMeta}>
                    Fecha y hora de creacion: {formatDateTime(item.fecha)}
                  </Text>
                  {isRejectedClientStatus(item.estado) && item.cotizacion?.observacion ? (
                    <View style={styles.returnReasonCard}>
                      <Text style={styles.returnReasonTitle}>Motivo de devolucion</Text>
                      <Text style={styles.serviceRequestDescription}>{item.cotizacion.observacion}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.quoteExpandHint}>Toca la tarjeta para ver el detalle</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Modal transparent visible={Boolean(actionLoadingMessage)} animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>{actionLoadingMessage || "Procesando..."}</Text>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={Boolean(surveyRequestId)} animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.surveyCard}>
            <Text style={styles.surveyTitle}>Encuesta de satisfaccion</Text>
            <Text style={styles.surveyText}>¿Como calificas el servicio recibido?</Text>
            <View style={styles.surveyStarsRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <TouchableOpacity key={value} onPress={() => setSurveyRating(value)}>
                  <MaterialCommunityIcons
                    name={value <= surveyRating ? "star" : "star-outline"}
                    size={32}
                    color={value <= surveyRating ? "#f59e0b" : "#94a3b8"}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.surveyActions}>
              <TouchableOpacity style={styles.kmCancelButton} onPress={() => setSurveyRequestId(null)}>
                <Text style={styles.kmCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.kmSaveButton}
                onPress={() => finalizarSolicitudCliente(surveyRequestId)}
              >
                <Text style={styles.kmSaveText}>Enviar y finalizar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <View style={styles.dashboardLayout}>
        <View style={styles.mainContent}>
          <View style={styles.menuWrapper}>
            <View style={styles.topActionsRow}>
              <TouchableOpacity
                style={styles.iconActionButton}
                onPress={() => setMenuOpen((current) => !current)}
                activeOpacity={0.9}
              >
                <MaterialCommunityIcons
                  name={menuOpen ? "close" : "menu"}
                  size={28}
                  color="#08121f"
                />
              </TouchableOpacity>

              <View style={styles.topRightActions}>
                <TouchableOpacity
                  style={styles.bellButton}
                  onPress={() => setShowNotifications((current) => !current)}
                >
                  <MaterialCommunityIcons name="bell-outline" size={24} color="#2563eb" />
                  <View style={styles.notificationBadge}>
                    <Text style={styles.notificationText}>{unreadNotifications}</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.iconActionButton, styles.logoutIconButton]}
                  onPress={() => {
                    setMenuOpen(false);
                    cerrarSesion();
                  }}
                  activeOpacity={0.9}
                >
                  <MaterialCommunityIcons name="power" size={28} color="#ffffff" />
                </TouchableOpacity>
              </View>
            </View>

            {menuOpen ? (
              <View style={styles.dropdownMenu}>
                <View style={styles.dropdownHeader}>
                  <View style={styles.sidebarLogo}>
                    <MaterialCommunityIcons name="car-cog" size={22} color="#ffffff" />
                  </View>
                  <View>
                    <Text style={styles.sidebarEyebrow}>CLIENTE</Text>
                    <Text style={styles.sidebarTitle}>{userName}</Text>
                  </View>
                </View>

                <Text style={styles.sidebarWelcome}>Bienvenido</Text>

                {clientSections.map((section) => (
                  (() => {
                    const isBlocked = ["Pagos", "Soporte", "Configuracion"].includes(section);

                    return (
                  <TouchableOpacity
                    key={section}
                    style={[
                      styles.sidebarItem,
                      selectedSection === section && styles.sidebarItemActive,
                      isBlocked && styles.sidebarItemBlocked,
                    ]}
                    onPress={() => {
                      setSelectedSection(section);
                      setMenuOpen(false);
                    }}
                  >
                    <MaterialCommunityIcons
                      name={(sectionIcons[section] || "circle-outline") as any}
                      size={20}
                      color={selectedSection === section ? "#08121f" : "#c2cbe0"}
                    />
                    <Text
                      style={[
                        styles.sidebarItemText,
                        selectedSection === section && styles.sidebarItemTextActive,
                      ]}
                    >
                      {section}
                    </Text>
                    {!isBlocked ? (
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={18}
                        color={selectedSection === section ? "#08121f" : "#8fa1c2"}
                      />
                    ) : null}
                    {isBlocked ? (
                      <MaterialCommunityIcons name="lock-outline" size={16} color="#8fa1c2" />
                    ) : null}
                  </TouchableOpacity>
                    );
                  })()
                ))}

                <TouchableOpacity
                  style={styles.logoutButton}
                  onPress={() => {
                    setMenuOpen(false);
                    cerrarSesion();
                  }}
                >
                  <MaterialCommunityIcons name="power" size={18} color="#ff7a6f" />
                  <Text style={styles.logoutButtonText}>Cerrar sesion</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {showNotifications ? (
            <View style={styles.notificationsOverlay}>
              <Pressable style={styles.notificationsBackdrop} onPress={() => setShowNotifications(false)} />
              <View style={styles.notificationsDropdown}>
                <Text style={styles.notificationsTitle}>Notificaciones</Text>
                {notificaciones.length > 0 ? (
                  notificaciones.map((item) => (
                    <TouchableOpacity
                      key={String(item.id)}
                      style={styles.notificationItem}
                      activeOpacity={0.9}
                      onPress={() => abrirDesdeNotificacion(item)}
                    >
                      <Text style={styles.notificationItemTitle}>{item.titulo || "Notificacion"}</Text>
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.subtitle}>No tienes notificaciones nuevas.</Text>
                )}
              </View>
            </View>
          ) : null}

          {selectedSection === "Vista general" ? (
            <View style={styles.dashboardSection}>
              <View style={[styles.header, isMobile && styles.headerMobile]}>
                <View>
                  <Text style={styles.greeting}>Buenos dias</Text>
                  <Text style={styles.userText}>{userName}</Text>
                  <Text style={styles.subtitle}>
                    Controla tus vehiculos, servicios y solicitudes desde este panel principal.
                  </Text>
                </View>
              </View>

              <View style={styles.quickStats}>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#2f8fff" }]} />
                  <Text style={styles.statValue}>{totalVehiculos}</Text>
                  <Text style={styles.statLabel}>Panel de control</Text>
                </View>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#ff8a3d" }]} />
                  <Text style={styles.statValue}>{solicitudesCotizacion}</Text>
                  <Text style={styles.statLabel}>En cotizacion</Text>
                </View>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#23b26d" }]} />
                  <Text style={styles.statValue}>{solicitudesProceso}</Text>
                  <Text style={styles.statLabel}>Cotizado</Text>
                </View>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#7b61ff" }]} />
                  <Text style={styles.statValue}>{solicitudesFinalizadas}</Text>
                  <Text style={styles.statLabel}>Devueltos</Text>
                </View>
              </View>

              <View style={[styles.dashboardHero, isMobile && styles.headerMobile]}>
                <View style={styles.dashboardHeroText}>
                  <Text style={styles.dashboardHeroTitle}>Vista general cliente</Text>
                  <Text style={styles.dashboardHeroSubtitle}>
                    Consulta tus vehiculos, solicitudes y estados de mantenimiento en una sola vista.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.dashboardHeroButton}
                  onPress={() => setSelectedSection("Panel de control")}
                >
                  <Text style={styles.dashboardHeroButtonText}>Ir a Panel de control</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.summaryGrid}>
                <View style={[styles.summaryCard, isMobile && styles.summaryCardMobile]}>
                  <Text style={styles.summaryLabel}>Vehiculo activo</Text>
                  <Text style={styles.summaryValue} numberOfLines={1}>
                    {selectedVehicle
                      ? `${selectedVehicle.marca ?? ""} ${selectedVehicle.modelo ?? ""}`.trim() || "Sin vehiculo"
                      : "Sin vehiculo"}
                  </Text>
                </View>
                <View style={[styles.summaryCard, isMobile && styles.summaryCardMobile]}>
                  <Text style={styles.summaryLabel}>Kilometraje actual</Text>
                  <Text style={styles.summaryValue}>
                    {selectedVehicle?.kilometraje != null ? formatKilometraje(selectedVehicle.kilometraje) : "--"}
                  </Text>
                </View>
                <View style={[styles.summaryCard, isMobile && styles.summaryCardMobile]}>
                  <Text style={styles.summaryLabel}>Servicios solicitados</Text>
                  <Text style={styles.summaryValue}>{solicitudes.length}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {selectedSection === "Panel de control" ? (
            <>
              <View style={[styles.vehiclesHeader, isMobile && styles.vehiclesHeaderMobile]}>
                <Text style={styles.vehiclesSectionTitle}>Panel de control</Text>
                <TouchableOpacity
                  style={styles.registerButton}
                  onPress={() => router.push("/vehicles/create" as any)}
                >
                  <MaterialCommunityIcons name="car-2-plus" size={20} color="#2563eb" />
                  <Text style={styles.registerButtonText}>Registrar vehiculo</Text>
                </TouchableOpacity>
              </View>
              {renderVehiclesSection()}
            </>
          ) : null}
          {selectedSection === "Mis servicios" ? renderServicesSection() : null}
          {selectedSection === "Pagos"
            ? renderBlockedSection("Pagos", "credit-card-outline")
            : null}
          {selectedSection === "Historial" ? renderHistorySection() : null}
          {selectedSection === "Soporte"
            ? renderBlockedSection("Soporte", "lifebuoy")
            : null}
          {selectedSection === "Configuracion"
            ? renderBlockedSection("Configuracion", "cog-outline")
            : null}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },
  content: {
    padding: 18,
    paddingBottom: 32,
  },
  dashboardLayout: {
    width: "100%",
  },
  menuWrapper: {
    position: "relative",
    zIndex: 20,
    alignSelf: "stretch",
    marginBottom: 18,
  },
  topActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 38,
  },
  topRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 36,
  },
  iconActionButton: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe4f0",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#08121f",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  logoutIconButton: {
    backgroundColor: "#ef4444",
    borderColor: "#ef4444",
  },
  dropdownMenu: {
    position: "absolute",
    top: 68,
    left: 0,
    width: 310,
    maxWidth: "100%",
    backgroundColor: "#08121f",
    borderRadius: 28,
    padding: 20,
    shadowColor: "#08121f",
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 8,
  },
  dropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },
  sidebarLogo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#ff5b2e",
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarEyebrow: {
    color: "#8fa1c2",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sidebarTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  sidebarWelcome: {
    color: "#c2cbe0",
    marginBottom: 12,
  },
  sidebarItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sidebarItemActive: {
    backgroundColor: "#dfe9f7",
  },
  sidebarItemBlocked: {
    opacity: 0.72,
  },
  sidebarItemText: {
    color: "#c2cbe0",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  sidebarItemTextActive: {
    color: "#08121f",
    fontWeight: "800",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 18,
    backgroundColor: "rgba(255,91,46,0.12)",
  },
  logoutButtonText: {
    color: "#ffb4a8",
    fontSize: 15,
    fontWeight: "700",
  },
  mainContent: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  headerMobile: {
    flexDirection: "column",
    gap: 16,
    alignItems: "flex-start",
  },
  headerActions: {
    alignItems: "flex-end",
    gap: 12,
  },
  greeting: {
    fontSize: 18,
    color: "#1f2937",
    fontWeight: "700",
  },
  userText: {
    fontSize: 34,
    lineHeight: 38,
    color: "#1f2937",
    fontWeight: "800",
    marginTop: 4,
    maxWidth: 250,
  },
  subtitle: {
    color: "#7c8798",
    marginTop: 10,
    maxWidth: 260,
    lineHeight: 20,
  },
  bellButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5ebf5",
  },
  notificationBadge: {
    position: "absolute",
    top: 6,
    right: 5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ff5b2e",
    alignItems: "center",
    justifyContent: "center",
  },
  notificationText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  notificationsDropdown: {
    position: "absolute",
    top: 78,
    right: 0,
    left: 0,
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    marginBottom: 18,
    zIndex: 30,
  },
  notificationsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 25,
  },
  notificationsBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  notificationsTitle: {
    color: "#162033",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
  },
  notificationItem: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e6edf6",
    backgroundColor: "#f8fbff",
    padding: 14,
    marginTop: 10,
  },
  notificationItemTitle: {
    color: "#162033",
    fontWeight: "800",
    marginBottom: 4,
  },
  notificationItemText: {
    color: "#5f6b7c",
    lineHeight: 20,
  },
  cardsSection: {
    marginTop: 18,
    gap: 18,
  },
  quickStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    marginBottom: 18,
  },
  statCard: {
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    minWidth: 160,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  statCardMobile: {
    width: "47%",
    minWidth: 0,
  },
  statBar: {
    width: 42,
    height: 6,
    borderRadius: 999,
    marginBottom: 18,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#08121f",
  },
  statLabel: {
    color: "#6b778a",
    marginTop: 6,
  },
  vehiclesHeader: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  vehiclesHeaderMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  vehiclesSectionTitle: {
    color: "#102447",
    fontSize: 24,
    fontWeight: "800",
  },
  dashboardSection: {
    gap: 16,
  },
  dashboardHero: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e8edf6",
    gap: 16,
  },
  dashboardHeroText: {
    gap: 8,
  },
  dashboardHeroTitle: {
    color: "#102447",
    fontSize: 22,
    fontWeight: "800",
  },
  dashboardHeroSubtitle: {
    color: "#6b7788",
    lineHeight: 20,
  },
  dashboardHeroButton: {
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dashboardHeroButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  filterWrap: {
    flexDirection: "row",
    gap: 10,
    paddingRight: 12,
  },
  filterToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  filterActionButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe4f0",
    alignItems: "center",
    justifyContent: "center",
  },
  filterChip: {
    backgroundColor: "#eef3f9",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: "#dbeafe",
  },
  filterChipText: {
    color: "#425066",
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#1d4ed8",
  },
  summaryCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e8edf6",
  },
  summaryCardMobile: {
    minWidth: "100%",
  },
  summaryLabel: {
    color: "#64748b",
    fontWeight: "700",
    marginBottom: 8,
  },
  summaryValue: {
    color: "#102447",
    fontSize: 22,
    fontWeight: "900",
  },
  placeholderCard: {
    marginTop: 18,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: "#e8edf6",
    alignItems: "center",
  },
  placeholderTitle: {
    marginTop: 14,
    color: "#102447",
    fontSize: 22,
    fontWeight: "800",
  },
  placeholderText: {
    marginTop: 10,
    color: "#64748b",
    textAlign: "center",
    maxWidth: 480,
    lineHeight: 22,
  },
  servicesListSection: {
    marginTop: 18,
    gap: 14,
  },
  moduleHeaderCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e8edf6",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  moduleHeaderText: {
    flex: 1,
    gap: 4,
  },
  moduleHeaderTitle: {
    color: "#102447",
    fontSize: 18,
    fontWeight: "900",
  },
  moduleHeaderSubtitle: {
    color: "#64748b",
    lineHeight: 18,
  },
  moduleHeaderBadge: {
    minWidth: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 8,
  },
  moduleHeaderBadgeText: {
    color: "#1d4ed8",
    fontWeight: "800",
    fontSize: 12,
  },
  servicesSectionTitle: {
    color: "#102447",
    fontSize: 17,
    fontWeight: "800",
  },
  emptyVehiclesCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: "#e8edf6",
    alignItems: "center",
  },
  emptyVehiclesTitle: {
    marginTop: 14,
    color: "#102447",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyVehiclesText: {
    marginTop: 10,
    color: "#64748b",
    textAlign: "center",
    maxWidth: 420,
    lineHeight: 22,
  },
  serviceRequestCard: {
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e8edf6",
  },
  serviceRequestCardExpanded: {
    borderColor: "#d7e4fb",
    shadowColor: "#1e3a8a",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  serviceRequestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  serviceRequestHeaderContent: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  serviceRequestHeaderMobile: {
    flexDirection: "column",
  },
  serviceRequestTitle: {
    color: "#102447",
    fontSize: 18,
    fontWeight: "800",
    flexShrink: 1,
  },
  serviceRequestVehicle: {
    color: "#64748b",
    marginTop: 6,
    fontWeight: "600",
  },
  serviceMetaList: {
    marginTop: 10,
    gap: 8,
  },
  serviceMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  serviceMetaItemText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  serviceStatusPill: {
    marginLeft: "auto",
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  serviceStatusText: {
    fontWeight: "800",
    fontSize: 12,
  },
  serviceRequestDescription: {
    color: "#334155",
    marginTop: 14,
    lineHeight: 20,
  },
  serviceRequestMeta: {
    color: "#94a3b8",
    marginTop: 12,
    fontWeight: "700",
  },
  quoteExpandHint: {
    color: "#64748b",
    marginTop: 10,
    fontSize: 12,
    fontWeight: "700",
  },
  clientQuoteList: {
    gap: 12,
    marginTop: 14,
  },
  clientQuoteCard: {
    backgroundColor: "#f0fdf4",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  clientQuoteTitle: {
    color: "#166534",
    fontWeight: "800",
    marginBottom: 8,
  },
  clientQuoteDiagnosticBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1fae5",
  },
  clientQuoteDiagnosticTitle: {
    color: "#166534",
    fontWeight: "800",
    marginBottom: 4,
  },
  clientQuoteItem: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#d1fae5",
  },
  clientQuoteTotal: {
    marginTop: 12,
    color: "#166534",
    fontWeight: "900",
    fontSize: 16,
  },
  payButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: "#16a34a",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  payButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  clientQuoteActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  rejectOfferButton: {
    alignSelf: "flex-start",
    backgroundColor: "#fee2e2",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rejectOfferButtonText: {
    color: "#b91c1c",
    fontWeight: "800",
  },
  arrivalButton: {
    marginTop: 14,
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  arrivalButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  workshopListCard: {
    marginTop: 14,
    backgroundColor: "#f8fbff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d7e4fb",
    gap: 10,
  },
  workshopListTitle: {
    color: "#102447",
    fontWeight: "800",
  },
  timelineStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  timelineIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineIconCompleted: {
    backgroundColor: "#dbeafe",
  },
  timelineTextGroup: {
    flex: 1,
    gap: 2,
  },
  timelineLabel: {
    color: "#0f172a",
    fontWeight: "700",
  },
  timelineState: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
  },
  workshopItem: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e8edf6",
  },
  workshopName: {
    color: "#102447",
    fontWeight: "800",
  },
  workshopMeta: {
    color: "#64748b",
    marginTop: 4,
  },
  returnReasonCard: {
    marginTop: 12,
    backgroundColor: "#fff1f2",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#fecdd3",
  },
  returnReasonTitle: {
    color: "#be123c",
    fontWeight: "800",
    marginBottom: 6,
  },
  cardBlock: {
    gap: 12,
  },
  vehicleCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e8edf6",
  },
  vehicleCardSelected: {
    borderColor: "#cfdcff",
    shadowColor: "#c8d6f8",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 3,
  },
  vehicleTitle: {
    color: "#102447",
    fontSize: 18,
    fontWeight: "800",
    textTransform: "lowercase",
    marginBottom: 14,
  },
  vehicleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kmBlock: {
    flex: 1,
    paddingRight: 12,
  },
  kmLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  kmLabel: {
    color: "#5d6776",
    marginLeft: 6,
    fontWeight: "600",
  },
  kmValue: {
    color: "#102447",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 8,
  },
  kmButton: {
    marginTop: 14,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffb11e",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  kmButtonText: {
    color: "#fff",
    fontWeight: "800",
    marginLeft: 6,
    fontSize: 12,
  },
  kmEditor: {
    marginTop: 14,
    maxWidth: 250,
  },
  kmInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dbe4f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  kmEditorActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  kmSaveButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  kmSaveText: {
    color: "#fff",
    fontWeight: "700",
  },
  kmCancelButton: {
    backgroundColor: "#eef2f7",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  kmCancelText: {
    color: "#475569",
    fontWeight: "700",
  },
  gaugeCard: {
    width: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeText: {
    color: "#102447",
    fontSize: 16,
    fontWeight: "900",
    marginTop: -6,
    marginBottom: 6,
  },
  expandedPanel: {
    gap: 14,
  },
  servicesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  serviceCard: {
    width: "31%",
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e8edf6",
    minHeight: 92,
  },
  serviceCardMobile: {
    width: "47%",
  },
  serviceCardDisabled: {
    opacity: 0.65,
    borderColor: "#d7dfeb",
  },
  serviceText: {
    color: "#102447",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 10,
  },
  serviceTextDisabled: {
    color: "#6b7a90",
  },
  serviceDisabledHint: {
    marginTop: 6,
    color: "#b7791f",
    fontSize: 11,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deleteVehicleButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fee2e2",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deleteVehicleButtonDisabled: {
    opacity: 0.7,
  },
  deleteVehicleText: {
    color: "#dc2626",
    fontWeight: "700",
    marginLeft: 6,
    fontSize: 12,
  },
  registerButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  registerButtonText: {
    color: "#2563eb",
    fontWeight: "800",
    marginLeft: 6,
    fontSize: 13,
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingCard: {
    minWidth: 220,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#0f172a",
    fontWeight: "700",
    textAlign: "center",
  },
  surveyCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 20,
    gap: 14,
  },
  surveyTitle: {
    color: "#0f172a",
    fontSize: 20,
    fontWeight: "800",
  },
  surveyText: {
    color: "#475569",
    lineHeight: 20,
  },
  surveyStarsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  surveyActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
});
