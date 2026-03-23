import React, { useCallback, useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { CommonActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../../constants/api";
import { formatCurrency, formatDateTime } from "../../constants/formatters";
import {
  isApprovedStatus,
  getStatusLabel,
  isCancelledStatus,
  isCreatedStatus,
  isDiagnosedStatus,
  isFinishedStatus,
  isInDiagnosisStatus,
  isInQuotationStatus,
  isProposalReadyStatus,
  isQuoteWorkflowService,
  isQuotedStatus,
  isRejectedAdminStatus,
  isRejectedClientStatus,
  isRejectedProviderStatus,
  isRejectedWorkshopStatus,
  isSentToClientStatus,
  normalizeStatus,
} from "../../constants/request-status";
import storage from "../../constants/storage";

type Solicitud = {
  id?: number | string;
  solicitud_origen_id?: number | string | null;
  tipo_servicio?: string;
  problema?: string;
  estado?: string;
  observacion?: string | null;
  fecha?: string | null;
  vehiculo?: {
    marca?: string;
    modelo?: string;
    placa?: string;
  };
  cliente?: {
    nombre?: string;
  };
  proveedores?: {
    id?: number | string;
    nombre?: string;
    email?: string;
  }[];
  proveedores_estado?: {
    id?: number | string;
    nombre?: string;
    email?: string;
    estado?: string;
    comentario?: string;
  }[];
  cotizacion?: {
    proveedor_id?: number | string | null;
    marca?: string | null;
    referencia?: string | null;
    garantia?: string | null;
    disponibilidad?: string | null;
    precio?: string | null;
    observacion?: string | null;
    respuestas?: {
      proveedor_id?: number | string | null;
      proveedor_nombre?: string | null;
      response_index?: number | null;
      marca?: string | null;
      referencia?: string | null;
      garantia?: string | null;
      disponibilidad?: string | null;
      precio?: string | null;
      observacion?: string | null;
    }[];
  };
  taller_diagnostico?: {
    diagnostico?: string | null;
    servicios?: string | null;
    horas?: string | null;
    materiales?: string | null;
  };
};

type DirectoryItem = {
  id?: number | string;
  nombre?: string;
  email?: string;
  telefono?: string;
  rol?: string;
  estado?: string;
  especialidad?: string | null;
};

const normalizeProviderSpecialties = (especialidad?: string | null) =>
  (especialidad || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item === "aceite" ? "cambio de aceite" : item));

type Notificacion = {
  id?: number | string;
  titulo?: string;
  mensaje?: string;
  tipo?: string;
  leida?: boolean;
};

const sideMenu = [
  { label: "Vista general", icon: "view-dashboard-outline", active: true },
  { label: "Ordenes", icon: "file-document-multiple-outline" },
  { label: "Historial", icon: "history" },
  { label: "Talleres", icon: "garage-open" },
  { label: "Proveedores", icon: "truck-delivery-outline" },
  { label: "Usuarios", icon: "account-group-outline" },
  { label: "Pagos", icon: "credit-card-outline" },
  { label: "Reportes", icon: "chart-box-outline" },
  { label: "Configuracion", icon: "cog-outline" },
];

const servicesByDay = [14, 18, 16, 22, 20, 25, 28];
const incomeBars = [45, 62, 58, 76, 68, 84, 90];
const servicesByType = [
  { label: "Preventivo", value: 48, color: "#9eff6f" },
  { label: "Correctivo", value: 32, color: "#ffb84d" },
  { label: "Diagnostico", value: 20, color: "#73d0ff" },
];

const fallbackOrders = [
  { id: "#452", cliente: "Juan Perez", vehiculo: "Mazda 3", estado: "En reparacion", taller: "RenovAutos", valor: "$850.000" },
  { id: "#453", cliente: "Maria Lopez", vehiculo: "Toyota Hilux", estado: "Diagnostico", taller: "Garage Center", valor: "$420.000" },
  { id: "#454", cliente: "Luis Herrera", vehiculo: "Chevrolet Spark", estado: "Pendiente", taller: "AutoFix", valor: "$0" },
];

const fallbackWorkshops = [
  { name: "RenovAutos", rating: "4.8", activeOrders: 5, status: "Activo" },
  { name: "Garage Motors", rating: "4.6", activeOrders: 3, status: "Activo" },
  { name: "AutoFix Center", rating: "4.5", activeOrders: 2, status: "Revision" },
];

const fallbackSuppliers = [
  { name: "AutoParts SAS", quotes: 45, avgTime: "2h" },
  { name: "MotoRepuestos Pro", quotes: 28, avgTime: "3h" },
];

const fallbackUserGroups = [
  { label: "Clientes", count: 248 },
  { label: "Mecanicos", count: 34 },
  { label: "Administradores", count: 8 },
];

const payments = [
  { label: "Pagos recibidos", value: "$12.800.000" },
  { label: "Pagos pendientes", value: "$3.100.000" },
  { label: "Comisiones", value: "$1.450.000" },
  { label: "Transferencias talleres", value: "$6.900.000" },
];

const reports = [
  "Ingresos por taller",
  "Servicios mas vendidos",
  "Repuestos mas usados",
  "Tiempo de reparacion",
  "Rentabilidad",
];

const configItems = [
  "Tipos de servicio",
  "Comisiones",
  "Ciudades",
  "Parametros del sistema",
];

export default function AdministratorDashboardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const isMobile = width < 1100;
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [talleres, setTalleres] = useState<DirectoryItem[]>([]);
  const [proveedores, setProveedores] = useState<DirectoryItem[]>([]);
  const [usuarios, setUsuarios] = useState<DirectoryItem[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [loadingSolicitudes, setLoadingSolicitudes] = useState(false);
  const [selectedSection, setSelectedSection] = useState("Ordenes");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [quoteRequestId, setQuoteRequestId] = useState<string | null>(null);
  const [expandedQuoteResponseId, setExpandedQuoteResponseId] = useState<string | null>(null);
  const [selectedProviderIds, setSelectedProviderIds] = useState<number[]>([]);
  const [returnToClientId, setReturnToClientId] = useState<string | null>(null);
  const [returnToClientComment, setReturnToClientComment] = useState("");
  const [selectedOrderFilter, setSelectedOrderFilter] = useState<string>("Estado");
  const [expandedSummaryCardId, setExpandedSummaryCardId] = useState<string | null>(null);

  const enviarCotizacionAlCliente = async (
    solicitudId: string | number | undefined,
    proveedorId?: string | number | null,
    responseIndex?: number | null
  ) => {
    if (solicitudId == null) return;

    try {
      const token = await obtenerTokenSesion();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/enviar-cliente`, {
        method: "PATCH",
        headers: proveedorId != null ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        } : {
          Authorization: `Bearer ${token}`,
        },
        body: proveedorId != null
          ? JSON.stringify({
              proveedor_id: Number(proveedorId),
              response_index: responseIndex != null ? Number(responseIndex) : null,
            })
          : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo enviar la solicitud al cliente");
        return;
      }

      setExpandedQuoteResponseId(null);
      await cargarSolicitudes();
      Alert.alert("Enviado", "La cotizacion fue enviada al cliente.");
    } catch (error) {
      console.log("Error enviando cotizacion al cliente", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  };

  const omitirCotizacionCliente = async (
    solicitudId: string | number | undefined,
    proveedorId?: string | number | null,
    responseIndex?: number | null
  ) => {
    if (solicitudId == null) return;

    try {
      const token = await obtenerTokenSesion();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/omitir-cliente`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          proveedor_id: proveedorId != null ? Number(proveedorId) : null,
          response_index: responseIndex != null ? Number(responseIndex) : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo omitir la solicitud");
        return;
      }

      setExpandedQuoteResponseId(null);
      await cargarSolicitudes();
      Alert.alert("Omitida", "La cotizacion fue enviada al historial del administrador.");
    } catch (error) {
      console.log("Error omitiendo solicitud para cliente", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  };

  const obtenerTokenSesion = async () => {
    const browserToken = globalThis.localStorage?.getItem("token");
    if (browserToken) return browserToken;
    return storage.getItem("token");
  };

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

  const actualizarEstadoUsuario = async (
    usuarioId: string | number | undefined,
    estado: "activo" | "bloqueado"
  ) => {
    if (usuarioId == null) return;

    try {
      const response = await fetch(`${API_BASE_URL}/usuarios/${usuarioId}/estado`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ estado }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.log("No se pudo actualizar estado", data);
        return;
      }

      await cargarDirectorios();
    } catch (error) {
      console.log("Error actualizando estado de usuario", error);
    }
  };

  const esSolicitudParaCotizar = (tipoServicio?: string) => {
    const value = (tipoServicio || "").toLowerCase().trim();

    if (value.includes(",") || value.includes(":")) {
      return false;
    }

    return (
      value === "bateria" ||
      value === "llantas" ||
      value === "cambio de aceite" ||
      value === "aceite" ||
      value === "frenos"
    );
  };

  const esSolicitudMantenimientoTaller = (tipoServicio?: string) => {
    const value = (tipoServicio || "").toLowerCase().trim();

    return (
      !esSolicitudParaCotizar(tipoServicio) &&
      (value.includes(":") ||
        value.includes(",") ||
        value.includes("mantenimiento") ||
        value.includes("diagnostico") ||
        value.includes("escaneo") ||
        value.includes("motor") ||
        value.includes("suspension") ||
        value.includes("alineacion"))
    );
  };

  const obtenerEspecialidadSolicitud = (tipoServicio?: string) => {
    const value = (tipoServicio || "").toLowerCase();

    if (value.includes("bateria")) return "bateria";
    if (value.includes("llanta")) return "llantas";
    if (value.includes("aceite") || value.includes("filtro")) return "cambio de aceite";

    return null;
  };

  const toggleProveedorSeleccionado = (proveedorId: number) => {
    setSelectedProviderIds((current) =>
      current.includes(proveedorId)
        ? current.filter((id) => id !== proveedorId)
        : [...current, proveedorId]
    );
  };

  const enviarCotizacionAProveedores = async (solicitudId: string | number) => {
    if (selectedProviderIds.length === 0) {
      Alert.alert("Seleccion requerida", "Debes elegir al menos un proveedor.");
      return;
    }

    const confirmarEnvio = async () => {
      try {
        const token = await obtenerTokenSesion();
        const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/cotizar`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ proveedor_ids: selectedProviderIds }),
        });

        const data = await response.json();

        if (!response.ok) {
          Alert.alert("Error", data.detail || "No se pudo enviar la solicitud");
          return;
        }

        setQuoteRequestId(null);
        setSelectedProviderIds([]);
        await cargarSolicitudes();
        Alert.alert("Enviado", "La solicitud fue enviada a proveedores y ahora esta en cotizacion.");
      } catch (error) {
        console.log("Error enviando a proveedores", error);
        Alert.alert("Error", "No se pudo conectar al servidor");
      }
    };

    if (Platform.OS === "web") {
      const confirmado = window.confirm(
        "Se enviara esta solicitud a los proveedores seleccionados. Deseas continuar?"
      );

      if (confirmado) {
        await confirmarEnvio();
      }

      return;
    }

    Alert.alert(
      "Confirmar envio",
      "Se enviara esta solicitud a los proveedores seleccionados. Deseas continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Enviar", onPress: confirmarEnvio },
      ]
    );
  };

  const enviarSolicitudATalleres = async (solicitudId: string | number) => {
    if (selectedProviderIds.length === 0) {
      Alert.alert("Seleccion requerida", "Debes elegir al menos un taller.");
      return;
    }

    try {
      const token = await obtenerTokenSesion();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/enviar-taller`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ taller_ids: selectedProviderIds }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo enviar la solicitud al taller");
        return;
      }

      setQuoteRequestId(null);
      setSelectedProviderIds([]);
      await cargarSolicitudes();
      Alert.alert("Enviado", "La solicitud fue enviada al taller.");
    } catch (error) {
      console.log("Error enviando a talleres", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  };

  const devolverSolicitudAlCliente = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    if (!returnToClientComment.trim()) {
      Alert.alert("Comentario requerido", "Debes escribir un comentario para devolver la solicitud al cliente.");
      return;
    }

    try {
      const token = await obtenerTokenSesion();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/devolver-cliente`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comentario: returnToClientComment.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo devolver la solicitud al cliente");
        return;
      }

      setReturnToClientId(null);
      setReturnToClientComment("");
      await cargarSolicitudes();
      Alert.alert("Devuelta", "La solicitud fue devuelta al cliente.");
    } catch (error) {
      console.log("Error devolviendo al cliente", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  };

  const cargarSolicitudes = useCallback(async () => {
    try {
      setLoadingSolicitudes(true);
      const token = await obtenerTokenSesion();
      const response = await fetch(`${API_BASE_URL}/solicitudes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      setSolicitudes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log("Error cargando solicitudes admin", error);
      setSolicitudes([]);
    } finally {
      setLoadingSolicitudes(false);
    }
  }, []);

  const cargarDirectorios = useCallback(async () => {
    try {
      const [talleresResponse, proveedoresResponse, usuariosResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/talleres`),
        fetch(`${API_BASE_URL}/proveedores`),
        fetch(`${API_BASE_URL}/usuarios`),
      ]);

      const [talleresData, proveedoresData, usuariosData] = await Promise.all([
        talleresResponse.json(),
        proveedoresResponse.json(),
        usuariosResponse.json(),
      ]);

      setTalleres(Array.isArray(talleresData) ? talleresData : []);
      setProveedores(Array.isArray(proveedoresData) ? proveedoresData : []);
      setUsuarios(Array.isArray(usuariosData) ? usuariosData : []);
    } catch (error) {
      console.log("Error cargando directorios admin", error);
      setTalleres([]);
      setProveedores([]);
      setUsuarios([]);
    }
  }, []);

  const cargarNotificaciones = useCallback(async () => {
    try {
      const token = await obtenerTokenSesion();
      const response = await fetch(`${API_BASE_URL}/notificaciones`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      setNotificaciones(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log("Error cargando notificaciones admin", error);
      setNotificaciones([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargarSolicitudes();
      cargarDirectorios();
      cargarNotificaciones();

      const interval = setInterval(() => {
        cargarSolicitudes();
        cargarDirectorios();
        cargarNotificaciones();
      }, 8000);

      return () => clearInterval(interval);
    }, [cargarDirectorios, cargarNotificaciones, cargarSolicitudes])
  );

  const cerrarMenuYSaltar = (label: string) => {
    setSelectedSection(label);
    setMenuOpen(false);
  };

  const pendingRequests = useMemo(
    () => {
      const hiddenOriginIds = new Set(
        solicitudes
          .filter((item) => {
            const status = normalizeStatus(item.estado);
            return (
              item.solicitud_origen_id != null &&
              (
                isSentToClientStatus(status) ||
                isApprovedStatus(status) ||
                isRejectedClientStatus(status)
              )
            );
          })
          .map((item) => Number(item.solicitud_origen_id))
          .filter((value) => Number.isFinite(value))
      );

      return solicitudes.filter((item) => {
        const status = normalizeStatus(item.estado);
        if (!(status === "pendiente" || isCreatedStatus(status) || status === "en_revision")) {
          return false;
        }

        return !hiddenOriginIds.has(Number(item.id));
      });
    },
    [solicitudes]
  );
  const archivedRequests = useMemo(
    () =>
      solicitudes.filter((item) =>
        ["omitida_admin"].includes(normalizeStatus(item.estado)) ||
        isCancelledStatus(item.estado) ||
        isRejectedClientStatus(item.estado) ||
        isRejectedAdminStatus(item.estado) ||
        isRejectedWorkshopStatus(item.estado)
      ),
    [solicitudes]
  );

  const quoteRequests = useMemo(
    () =>
      solicitudes.filter((item) =>
        isInDiagnosisStatus(item.estado) ||
        isDiagnosedStatus(item.estado) ||
        isInQuotationStatus(item.estado) ||
        isQuotedStatus(item.estado) ||
        isProposalReadyStatus(item.estado) ||
        isSentToClientStatus(item.estado) ||
        isApprovedStatus(item.estado) ||
        isRejectedProviderStatus(item.estado)
      ),
    [solicitudes]
  );

  const unreadNotifications = useMemo(
    () => notificaciones.filter((item) => !item.leida).length,
    [notificaciones]
  );

  const extraerSolicitudId = (mensaje?: string) => {
    const match = (mensaje || "").match(/#(\d+)/);
    return match?.[1] || null;
  };

  const abrirDesdeNotificacion = async (item: Notificacion) => {
    try {
      const token = await obtenerTokenSesion();
      await fetch(`${API_BASE_URL}/notificaciones/${item.id}/leer`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      console.log("Error marcando notificacion admin", error);
    }

    const solicitudId = extraerSolicitudId(item.mensaje);
    setShowNotifications(false);
    setSelectedSection("Ordenes");

    if (solicitudId) {
      setQuoteRequestId(solicitudId);
      setExpandedQuoteResponseId(solicitudId);
    }

    setNotificaciones((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, leida: true } : notification
      )
    );
  };

  const obtenerEstadoCotizacion = (estado?: string) => {
    if (isInDiagnosisStatus(estado)) {
      return {
        label: "En espera del taller",
        pillStyle: styles.requestStatusPill,
        textStyle: styles.requestStatusText,
      };
    }

    if (isRejectedProviderStatus(estado)) {
      return {
        label: getStatusLabel(estado),
        pillStyle: styles.requestStatusPillReturned,
        textStyle: styles.requestStatusTextReturned,
      };
    }

    if (isQuotedStatus(estado) || isProposalReadyStatus(estado) || isSentToClientStatus(estado)) {
      return {
        label: getStatusLabel(estado),
        pillStyle: styles.requestStatusPillSuccess,
        textStyle: styles.requestStatusTextSuccess,
      };
    }

    return {
      label: getStatusLabel(estado),
      pillStyle: styles.requestStatusPill,
      textStyle: styles.requestStatusText,
    };
  };

  const separarValoresCotizacion = (value?: string | null) =>
    (value || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

  const obtenerRespuestasCotizacion = (solicitud: Solicitud) => {
    if (solicitud.cotizacion?.respuestas && solicitud.cotizacion.respuestas.length > 0) {
      return solicitud.cotizacion.respuestas.map((respuesta) => ({
        proveedorId: respuesta.proveedor_id || null,
        proveedorNombre: respuesta.proveedor_nombre || "Proveedor",
        responseIndex: respuesta.response_index ?? 0,
        marca: respuesta.marca || "Sin marca",
        referencia: respuesta.referencia || "Sin referencia",
        garantia: respuesta.garantia || "Sin garantia",
        disponibilidad: respuesta.disponibilidad || "Sin disponibilidad",
        precio: respuesta.precio || "0",
        observacion: respuesta.observacion || "Sin observacion",
      }));
    }

    const marcas = separarValoresCotizacion(solicitud.cotizacion?.marca);
    const referencias = separarValoresCotizacion(solicitud.cotizacion?.referencia);
    const garantias = separarValoresCotizacion(solicitud.cotizacion?.garantia);
    const disponibilidades = separarValoresCotizacion(solicitud.cotizacion?.disponibilidad);
    const precios = separarValoresCotizacion(solicitud.cotizacion?.precio);
    const observaciones = separarValoresCotizacion(solicitud.cotizacion?.observacion);

    const total = Math.max(
      marcas.length,
      referencias.length,
      garantias.length,
      disponibilidades.length,
      precios.length,
      observaciones.length
    );

    return Array.from({ length: total }, (_, index) => ({
      proveedorId: null,
      proveedorNombre: `Proveedor ${index + 1}`,
      responseIndex: index,
      marca: marcas[index] || "Sin marca",
      referencia: referencias[index] || "Sin referencia",
      garantia: garantias[index] || "Sin garantia",
      disponibilidad: disponibilidades[index] || "Sin disponibilidad",
      precio: precios[index] || "0",
      observacion: observaciones[index] || "Sin observacion",
    }));
  };

  const sideMenuWithBadges: Array<{ label: string; icon: string; active: boolean; badge?: number }> = useMemo(
    () =>
      sideMenu.map((item) =>
        item.label === "Ordenes"
          ? {
              ...item,
              badge: pendingRequests.length + quoteRequests.length,
              active: selectedSection === item.label,
            }
          : { ...item, active: selectedSection === item.label }
      ),
    [pendingRequests.length, quoteRequests.length, selectedSection]
  );

  const workshops: Array<{
    id?: number | string;
    name: string;
    rating: string;
    activeOrders: number;
    status: string;
    email?: string;
    telefono?: string;
    rawStatus?: string;
  }> = useMemo(
    () =>
          talleres.length > 0
        ? talleres.map((item) => ({
            id: item.id,
            name: item.nombre || "Taller",
            rating: "4.8",
            activeOrders: solicitudes.filter((solicitud) =>
              ["diagnostico", "esperando_repuestos", "en_reparacion", "pruebas"].includes(
                (solicitud.estado || "").toLowerCase()
              )
            ).length,
            status: item.estado === "bloqueado" ? "Bloqueado" : "Activo",
            email: item.email || "Sin email",
            telefono: item.telefono || "Sin telefono",
            rawStatus: item.estado || "activo",
          }))
        : fallbackWorkshops,
    [solicitudes, talleres]
  );

  const suppliers: Array<{
    id?: number | string;
    name: string;
    quotes: number;
    avgTime: string;
    email?: string;
    telefono?: string;
    status?: string;
    rawStatus?: string;
  }> = useMemo(
    () =>
          proveedores.length > 0
        ? proveedores.map((item) => ({
            id: item.id,
            name: item.nombre || "Proveedor",
            quotes: solicitudes.filter((solicitud) =>
              ((solicitud.tipo_servicio || "").toLowerCase().includes("repuesto"))
            ).length,
            avgTime: "2h",
            email: item.email || "Sin email",
            telefono: item.telefono || "Sin telefono",
            status: item.estado === "bloqueado" ? "Bloqueado" : "Activo",
            rawStatus: item.estado || "activo",
          }))
        : fallbackSuppliers,
    [proveedores, solicitudes]
  );

  const userGroups = useMemo(() => {
    if (usuarios.length === 0) return fallbackUserGroups;

    return [
      { label: "Clientes", count: usuarios.filter((item) => item.rol === "cliente").length },
      { label: "Talleres", count: usuarios.filter((item) => item.rol === "taller").length },
      { label: "Proveedores", count: usuarios.filter((item) => item.rol === "proveedor").length },
      { label: "Administradores", count: usuarios.filter((item) => item.rol === "administrador").length },
    ];
  }, [usuarios]);

  const obtenerTituloSolicitud = (tipoServicio?: string) => {
    const value = (tipoServicio || "").toLowerCase();

    if (value.includes("llanta")) return "Solicitud de llantas";
    if (value.includes("bateria")) return "Solicitud de bateria";
    if (value.includes("aceite") || value.includes("filtro")) return "Solicitud de aceite";

    return tipoServicio || "Solicitud";
  };

  const dashboardKpis = useMemo(
    () => [
      { label: "Solicitudes", value: String(solicitudes.length), tone: "#9eff6f" },
      {
        label: "Creadas / Revision",
        value: String(pendingRequests.length),
        tone: "#73d0ff",
      },
      {
        label: "Cotizadas",
        value: String(
          solicitudes.filter((item) =>
            isInQuotationStatus(item.estado) || isQuotedStatus(item.estado) || isSentToClientStatus(item.estado)
          ).length
        ),
        tone: "#ffb84d",
      },
      {
        label: "Devueltas",
        value: String(
          solicitudes.filter((item) =>
            isRejectedClientStatus(item.estado) || isRejectedProviderStatus(item.estado)
          ).length
        ),
        tone: "#ff8a8a",
      },
      {
        label: "Finalizadas",
        value: String(
          solicitudes.filter((item) => isFinishedStatus(item.estado)).length
        ),
        tone: "#d5a6ff",
      },
      {
        label: "Talleres",
        value: String(talleres.length),
        tone: "#ff6d6d",
      },
    ],
    [pendingRequests.length, solicitudes, talleres.length]
  );

  const statusSummaryCards = useMemo(
    () => [
      {
        id: "status-pendientes",
        label: "Pendientes",
        value: pendingRequests.length,
        icon: "chart-box-outline",
        color: "#2563eb",
        details: pendingRequests.map((item) =>
          `Orden #${item.id} • ${item.cliente?.nombre || "Cliente"} • ${obtenerTituloSolicitud(item.tipo_servicio)}`
        ),
      },
      {
        id: "status-cotizando",
        label: "En cotizacion",
        value: solicitudes.filter((item) => isInQuotationStatus(item.estado)).length,
        icon: "chart-box-outline",
        color: "#2563eb",
        details: solicitudes
          .filter((item) => isInQuotationStatus(item.estado))
          .map((item) => `Orden #${item.id} • ${item.cliente?.nombre || "Cliente"} • ${obtenerTituloSolicitud(item.tipo_servicio)}`),
      },
      {
        id: "status-cotizado",
        label: "Cotizada",
        value: solicitudes.filter((item) => isQuotedStatus(item.estado)).length,
        icon: "chart-box-outline",
        color: "#2563eb",
        details: solicitudes
          .filter((item) => isQuotedStatus(item.estado))
          .map((item) => `Orden #${item.id} • ${item.cliente?.nombre || "Cliente"} • ${obtenerTituloSolicitud(item.tipo_servicio)}`),
      },
      {
        id: "status-devuelto-proveedor",
        label: "Rechazada proveedor",
        value: solicitudes.filter((item) => isRejectedProviderStatus(item.estado)).length,
        icon: "chart-box-outline",
        color: "#2563eb",
        details: solicitudes
          .filter((item) => isRejectedProviderStatus(item.estado))
          .map((item) => `Orden #${item.id} • ${item.cliente?.nombre || "Cliente"} • ${obtenerTituloSolicitud(item.tipo_servicio)}`),
      },
      {
        id: "status-devuelta-cliente",
        label: "Rechazada cliente",
        value: solicitudes.filter((item) => isRejectedClientStatus(item.estado)).length,
        icon: "chart-box-outline",
        color: "#2563eb",
        details: solicitudes
          .filter((item) => isRejectedClientStatus(item.estado))
          .map((item) => `Orden #${item.id} • ${item.cliente?.nombre || "Cliente"} • ${obtenerTituloSolicitud(item.tipo_servicio)}`),
      },
      {
        id: "status-finalizadas",
        label: "Finalizadas",
        value: solicitudes.filter((item) => isFinishedStatus(item.estado)).length,
        icon: "chart-box-outline",
        color: "#2563eb",
        details: solicitudes
          .filter((item) => isFinishedStatus(item.estado))
          .map((item) => `Orden #${item.id} • ${item.cliente?.nombre || "Cliente"} • ${obtenerTituloSolicitud(item.tipo_servicio)}`),
      },
    ],
    [pendingRequests.length, solicitudes]
  );

  const actorSummaryCards = useMemo(
    () => [
      {
        id: "actor-clientes",
        label: "Clientes",
        value: usuarios.filter((item) => item.rol === "cliente").length,
        icon: "account-group-outline",
        color: "#23b26d",
        details: usuarios
          .filter((item) => item.rol === "cliente")
          .map((item) => `${item.nombre || "Cliente"} • ${item.email || "Sin email"}`),
      },
      {
        id: "actor-talleres",
        label: "Talleres",
        value: talleres.length,
        icon: "account-group-outline",
        color: "#23b26d",
        details: talleres.map((item) => `${item.nombre || "Taller"} • ${item.email || "Sin email"}`),
      },
      {
        id: "actor-proveedores",
        label: "Proveedores",
        value: proveedores.length,
        icon: "account-group-outline",
        color: "#23b26d",
        details: proveedores.map((item) => `${item.nombre || "Proveedor"} • ${item.email || "Sin email"}`),
      },
      {
        id: "actor-administradores",
        label: "Administradores",
        value: usuarios.filter((item) => item.rol === "administrador").length,
        icon: "account-group-outline",
        color: "#23b26d",
        details: usuarios
          .filter((item) => item.rol === "administrador")
          .map((item) => `${item.nombre || "Administrador"} • ${item.email || "Sin email"}`),
      },
    ],
    [proveedores, talleres, usuarios]
  );

  const filteredPendingRequests = useMemo(() => {
    if (selectedOrderFilter === "Clientes") {
      return [...pendingRequests].sort((a, b) =>
        (a.cliente?.nombre || "").localeCompare(b.cliente?.nombre || "")
      );
    }

    if (selectedOrderFilter === "Proveedores") {
      return [...pendingRequests].sort((a, b) => {
        const left = esSolicitudParaCotizar(a.tipo_servicio) ? 0 : 1;
        const right = esSolicitudParaCotizar(b.tipo_servicio) ? 0 : 1;
        return left - right;
      });
    }

    if (selectedOrderFilter === "Taller") {
      return [...pendingRequests].sort((a, b) => {
        const left = esSolicitudParaCotizar(a.tipo_servicio) ? 1 : 0;
        const right = esSolicitudParaCotizar(b.tipo_servicio) ? 1 : 0;
        return left - right;
      });
    }

    return [...pendingRequests].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }, [pendingRequests, selectedOrderFilter]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.layout}>
        <View style={styles.main}>
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

            {menuOpen ? (
              <View style={styles.dropdownMenu}>
                <View style={styles.dropdownHeader}>
                  <View style={styles.logoBox}>
                    <MaterialCommunityIcons name="shield-crown-outline" size={24} color="#fff" />
                  </View>
                  <View>
                    <Text style={styles.sidebarEyebrow}>ADMIN</Text>
                    <Text style={styles.sidebarTitle}>Central</Text>
                  </View>
                </View>

                <Text style={styles.sidebarWelcome}>Bienvenido</Text>

                {sideMenuWithBadges.map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={[styles.sideItem, item.active && styles.sideItemActive]}
                    onPress={() => cerrarMenuYSaltar(item.label)}
                  >
                    <View style={styles.sideItemRow}>
                      <MaterialCommunityIcons
                        name={item.icon as any}
                        size={20}
                        color={item.active ? "#08121f" : "#b2b2b8"}
                      />
                      <Text style={[styles.sideText, item.active && styles.sideTextActive]}>
                        {item.label}
                      </Text>
                    </View>

                    {!!item.badge && (
                      <View style={styles.sideBadge}>
                        <Text style={styles.sideBadgeText}>{item.badge}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>

          <View style={[styles.topBar, isMobile && styles.topBarMobile]}>
            <View>
              <Text style={styles.pageTitle}>
                {selectedSection === "Vista general"
                  ? "Vista general"
                  : `Modulo: ${selectedSection}`}
              </Text>
              <Text style={styles.pageSubtitle}>
                {selectedSection === "Vista general"
                  ? "Controla los indicadores clave, ordenes y rendimiento del sistema."
                  : "Gestion centralizada de la operacion del sistema."}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.bellButton}
              activeOpacity={0.9}
              onPress={() => setShowNotifications((current) => !current)}
            >
              <MaterialCommunityIcons name="bell-outline" size={24} color="#2563eb" />
              {unreadNotifications > 0 ? (
                <View style={styles.notificationBadgeTop}>
                  <Text style={styles.notificationBadgeTextTop}>{unreadNotifications}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
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
                  <Text style={styles.panelText}>No tienes notificaciones nuevas.</Text>
                )}
              </View>
            </View>
          ) : null}

          {selectedSection === "Vista general" && (
            <>
              <View style={styles.kpiGrid}>
                {dashboardKpis.map((item) => (
                  <View key={item.label} style={[styles.kpiCard, isMobile && styles.kpiCardMobile]}>
                    <View style={[styles.kpiPill, { backgroundColor: item.tone }]} />
                    <Text style={styles.kpiLabel}>{item.label}</Text>
                    <Text style={styles.kpiValue}>{item.value}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.chartRow, isMobile && styles.chartRowMobile]}>
                <View style={styles.panelLarge}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>Estados de solicitudes</Text>
                  </View>
                  {statusSummaryCards.map((item) => {
                    const expanded = expandedSummaryCardId === item.id;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.simpleRow}
                        activeOpacity={0.92}
                        onPress={() =>
                          setExpandedSummaryCardId((current) => (current === item.id ? null : item.id))
                        }
                      >
                        <View style={styles.summaryRowTop}>
                          <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
                          <Text style={styles.simpleText}>{item.label}</Text>
                          <Text style={styles.summaryInlineValue}>{item.value}</Text>
                        </View>
                        {expanded ? (
                          <View style={styles.summaryExpandedBlock}>
                            <Text style={styles.summaryExpandedText}>Cantidad: {item.value}</Text>
                            {item.details.length > 0 ? (
                              item.details.map((detail, index) => (
                                <Text key={`${item.id}-detail-${index}`} style={styles.summaryDetailText}>
                                  {detail}
                                </Text>
                              ))
                            ) : (
                              <Text style={styles.summaryDetailEmpty}>Sin registros</Text>
                            )}
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.panelMedium}>
                  <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>Actores registrados</Text>
                  </View>
                  {actorSummaryCards.map((item) => {
                    const expanded = expandedSummaryCardId === item.id;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.simpleRow}
                        activeOpacity={0.92}
                        onPress={() =>
                          setExpandedSummaryCardId((current) => (current === item.id ? null : item.id))
                        }
                      >
                        <View style={styles.summaryRowTop}>
                          <MaterialCommunityIcons name={item.icon as any} size={18} color={item.color} />
                          <Text style={styles.simpleText}>{item.label}</Text>
                          <Text style={styles.summaryInlineValue}>{item.value}</Text>
                        </View>
                        {expanded ? (
                          <View style={styles.summaryExpandedBlock}>
                            <Text style={styles.summaryExpandedText}>Cantidad: {item.value}</Text>
                            {item.details.length > 0 ? (
                              item.details.map((detail, index) => (
                                <Text key={`${item.id}-detail-${index}`} style={styles.summaryDetailText}>
                                  {detail}
                                </Text>
                              ))
                            ) : (
                              <Text style={styles.summaryDetailEmpty}>Sin registros</Text>
                            )}
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          )}

          {selectedSection === "Ordenes" && (
            <View style={styles.panelFull}>
            <View style={styles.panelMedium}>
              <Text style={styles.panelTitle}>Filtros ordenes</Text>
              <View style={styles.filterWrap}>
                {["Estado", "Fecha", "Proveedores", "Clientes", "Taller"].map((filter) => (
                  <TouchableOpacity
                    key={filter}
                    style={[
                      styles.filterChip,
                      selectedOrderFilter === filter && styles.filterChipActive,
                    ]}
                    onPress={() => setSelectedOrderFilter(filter)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedOrderFilter === filter && styles.filterChipTextActive,
                      ]}
                    >
                      {filter}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Modulo: Ordenes</Text>
              {loadingSolicitudes ? <Text style={styles.panelMeta}>Actualizando...</Text> : null}
            </View>

            <View style={styles.notificationPanel}>
              <View style={styles.notificationHeader}>
                <View>
                  <Text style={styles.notificationTitle}>Nuevas solicitudes</Text>
                  <Text style={styles.notificationSubtitle}>
                    Las solicitudes pendientes llegan aqui para el administrador.
                  </Text>
                </View>
              </View>

              {filteredPendingRequests.length > 0 ? (
                filteredPendingRequests.map((item) => {
                  const especialidadSolicitud = obtenerEspecialidadSolicitud(item.tipo_servicio);
                  const esCotizacion = esSolicitudParaCotizar(item.tipo_servicio);
                  const esMantenimiento = esSolicitudMantenimientoTaller(item.tipo_servicio);
                  const proveedoresCompatibles = especialidadSolicitud
                    ? proveedores.filter(
                        (proveedor) => {
                          const especialidadesProveedor = normalizeProviderSpecialties(proveedor.especialidad);
                          return ["general", especialidadSolicitud].some((item) =>
                            especialidadesProveedor.includes(item)
                          );
                        }
                      )
                    : esMantenimiento
                      ? proveedores.filter(
                          (proveedor) =>
                            normalizeProviderSpecialties(proveedor.especialidad).includes("general")
                        )
                    : proveedores;

                  return (
                  <View key={`pending-${item.id}`} style={styles.requestCard}>
                    <View style={styles.requestHeader}>
                      <Text style={styles.requestId}>{obtenerTituloSolicitud(item.tipo_servicio)}</Text>
                      <View style={styles.requestStatusPill}>
                        <Text style={styles.requestStatusText}>{getStatusLabel(item.estado)}</Text>
                      </View>
                    </View>
                    <Text style={styles.requestText}>Orden #{item.id}</Text>
                    <Text style={styles.requestText}>
                      Cliente: {item.cliente?.nombre || "Cliente"}
                    </Text>
                    <Text style={styles.requestText}>
                      Vehiculo:{" "}
                      {`${item.vehiculo?.marca || ""} ${item.vehiculo?.modelo || ""}`.trim() ||
                        "Vehiculo"}
                    </Text>
                    <Text style={styles.requestText}>Placa: {item.vehiculo?.placa || "N/A"}</Text>
                    <Text style={styles.requestText}>
                      Fecha y hora de recepcion: {formatDateTime(item.fecha)}
                    </Text>
                    <Text style={styles.requestText}>
                      Problema: {item.problema || "Sin descripcion"}
                    </Text>

                    {esCotizacion ? (
                      <>
                        <View style={styles.requestPrimaryActions}>
                          <TouchableOpacity
                            style={styles.deleteQuoteButton}
                            onPress={() => {
                              setQuoteRequestId(null);
                              setSelectedProviderIds([]);
                              setReturnToClientId((current) =>
                                current === String(item.id) ? null : String(item.id)
                              );
                              if (returnToClientId === String(item.id)) {
                                setReturnToClientComment("");
                              }
                            }}
                          >
                            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#dc2626" />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.quoteButton}
                            onPress={() => {
                              if (quoteRequestId === String(item.id)) {
                                setQuoteRequestId(null);
                                setSelectedProviderIds([]);
                                return;
                              }

                              setQuoteRequestId(String(item.id));
                              setSelectedProviderIds([]);
                            }}
                          >
                            <Text style={styles.quoteButtonText}>Proveedores</Text>
                            <MaterialCommunityIcons
                              name={quoteRequestId === String(item.id) ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#2563eb"
                            />
                          </TouchableOpacity>
                        </View>

                        {quoteRequestId === String(item.id) ? (
                          <View style={styles.providerSelectionCard}>
                            <Text style={styles.providerSelectionTitle}>Elegir proveedores</Text>
                            {proveedoresCompatibles.length > 0 ? (
                              proveedoresCompatibles.map((proveedor) => {
                                const proveedorId = Number(proveedor.id);
                                const selected = selectedProviderIds.includes(proveedorId);

                                return (
                                  <TouchableOpacity
                                    key={`provider-${proveedor.id}`}
                                    style={[
                                      styles.providerOption,
                                      selected && styles.providerOptionSelected,
                                    ]}
                                    onPress={() => toggleProveedorSeleccionado(proveedorId)}
                                  >
                                    <Text
                                      style={[
                                        styles.providerOptionTitle,
                                        selected && styles.providerOptionTitleSelected,
                                      ]}
                                    >
                                      {proveedor.nombre || "Proveedor"}
                                    </Text>
                                    <Text style={styles.providerOptionText}>
                                      {proveedor.email || "Sin email"}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })
                            ) : (
                              <Text style={styles.requestText}>No hay proveedores disponibles para esta solicitud.</Text>
                            )}

                            <View style={styles.providerActions}>
                              <TouchableOpacity
                                style={styles.acceptButton}
                                onPress={() => enviarCotizacionAProveedores(item.id || "")}
                              >
                              <Text style={styles.acceptButtonText}>Enviar</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}

                        {returnToClientId === String(item.id) ? (
                          <View style={styles.returnClientCard}>
                            <View style={styles.returnClientForm}>
                              <TextInput
                                style={styles.returnClientInput}
                                value={returnToClientComment}
                                onChangeText={(value) => setReturnToClientComment(value.slice(0, 100))}
                                placeholder="Comentario para devolver al cliente"
                                placeholderTextColor="#94a3b8"
                                multiline
                                maxLength={100}
                              />
                              <Text style={styles.returnClientCounter}>{returnToClientComment.length}/100</Text>
                              <TouchableOpacity
                                style={styles.returnClientSubmitButton}
                                onPress={() => devolverSolicitudAlCliente(item.id)}
                              >
                                <Text style={styles.returnClientSubmitText}>Devolver al cliente</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <View style={styles.requestPrimaryActions}>
                          <TouchableOpacity
                            style={styles.quoteButton}
                            onPress={() => {
                              if (quoteRequestId === String(item.id)) {
                                setQuoteRequestId(null);
                                setSelectedProviderIds([]);
                                return;
                              }

                              setQuoteRequestId(String(item.id));
                              setSelectedProviderIds([]);
                            }}
                          >
                            <Text style={styles.quoteButtonText}>Talleres</Text>
                            <MaterialCommunityIcons
                              name={quoteRequestId === String(item.id) ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#2563eb"
                            />
                          </TouchableOpacity>
                        </View>

                        {quoteRequestId === String(item.id) ? (
                          <View style={styles.providerSelectionCard}>
                            <Text style={styles.providerSelectionTitle}>Elegir talleres</Text>
                            {talleres.length > 0 ? (
                              talleres.map((taller) => {
                                const tallerId = Number(taller.id);
                                const selected = selectedProviderIds.includes(tallerId);

                                return (
                                  <TouchableOpacity
                                    key={`taller-${taller.id}`}
                                    style={[
                                      styles.providerOption,
                                      selected && styles.providerOptionSelected,
                                    ]}
                                    onPress={() => toggleProveedorSeleccionado(tallerId)}
                                  >
                                    <Text
                                      style={[
                                        styles.providerOptionTitle,
                                        selected && styles.providerOptionTitleSelected,
                                      ]}
                                    >
                                      {taller.nombre || "Taller"}
                                    </Text>
                                    <Text style={styles.providerOptionText}>
                                      {taller.email || "Sin email"}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })
                            ) : (
                              <Text style={styles.requestText}>No hay talleres disponibles para esta solicitud.</Text>
                            )}

                            <View style={styles.providerActions}>
                              <TouchableOpacity
                                style={styles.acceptButton}
                                onPress={() => enviarSolicitudATalleres(item.id || "")}
                              >
                                <Text style={styles.acceptButtonText}>Enviar</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : null}
                      </>
                    )}
                  </View>
                  );
                })
              ) : (
                <View style={styles.emptyNotice}>
                  <MaterialCommunityIcons name="bell-check-outline" size={24} color="#9eff6f" />
                  <Text style={styles.emptyNoticeText}>
                    No hay solicitudes pendientes en este momento.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.notificationPanel}>
              <View style={styles.notificationHeader}>
                <View>
                  <Text style={styles.notificationTitle}>Seguimiento de solicitudes</Text>
                  <Text style={styles.notificationSubtitle}>
                    Aqui ves las solicitudes enviadas a taller, los diagnosticos recibidos, las cotizaciones y la propuesta al cliente.
                  </Text>
                </View>
              </View>

              {quoteRequests.length > 0 ? (
                quoteRequests.map((item) => (
                  <View key={`quote-${item.id}`} style={styles.requestCard}>
                    {(() => {
                      const estadoCotizacion = obtenerEstadoCotizacion(item.estado);
                      const respuestasCotizacion = obtenerRespuestasCotizacion(item);
                      const expandedQuote = expandedQuoteResponseId === String(item.id);
                      const solicitudTaller = esSolicitudMantenimientoTaller(item.tipo_servicio);
                      const puedeEnviarDirectoCliente =
                        solicitudTaller &&
                        (isDiagnosedStatus(item.estado) || isProposalReadyStatus(item.estado));

                      return (
                    <>
                    <TouchableOpacity
                      activeOpacity={0.92}
                      onPress={() =>
                        setExpandedQuoteResponseId((current) =>
                          current === String(item.id) ? null : String(item.id)
                        )
                      }
                    >
                      <View style={styles.requestHeader}>
                        <Text style={styles.requestId}>{obtenerTituloSolicitud(item.tipo_servicio)}</Text>
                        <View style={[styles.requestStatusPill, estadoCotizacion.pillStyle]}>
                          <Text style={[styles.requestStatusText, estadoCotizacion.textStyle]}>
                            {estadoCotizacion.label}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.requestText}>
                        Cliente: {item.cliente?.nombre || "Cliente"}
                      </Text>
                      <Text style={styles.requestText}>
                        Vehiculo:{" "}
                        {`${item.vehiculo?.marca || ""} ${item.vehiculo?.modelo || ""}`.trim() ||
                          "Vehiculo"}
                      </Text>
                      <Text style={styles.requestText}>Placa: {item.vehiculo?.placa || "N/A"}</Text>
                      <Text style={styles.requestText}>Orden #{item.id}</Text>
                      <Text style={styles.requestText}>
                        Fecha y hora de recepcion: {formatDateTime(item.fecha)}
                      </Text>
                      <Text style={styles.requestText}>
                        Problema: {item.problema || "Sin descripcion"}
                      </Text>
                      <Text style={styles.quoteExpandHint}>
                        {expandedQuote ? "Toca para ocultar detalle" : "Toca la orden para ver detalle"}
                      </Text>
                    </TouchableOpacity>

                    {expandedQuote && solicitudTaller && isDiagnosedStatus(item.estado) ? (
                      <View style={styles.providerSelectionCard}>
                        {item.taller_diagnostico?.diagnostico || item.taller_diagnostico?.servicios || item.taller_diagnostico?.horas || item.taller_diagnostico?.materiales ? (
                          <View style={styles.quoteSummaryCard}>
                            <Text style={styles.quoteSummaryTitle}>Diagnostico del taller</Text>
                            <Text style={styles.requestText}>Diagnostico: {item.taller_diagnostico?.diagnostico || "Sin diagnostico"}</Text>
                            <Text style={styles.requestText}>Servicios: {item.taller_diagnostico?.servicios || "Sin servicios"}</Text>
                            <Text style={styles.requestText}>Horas: {item.taller_diagnostico?.horas || "Sin horas"}</Text>
                            <Text style={styles.requestText}>Materiales: {item.taller_diagnostico?.materiales || "Sin materiales"}</Text>
                          </View>
                        ) : null}

                        <Text style={styles.providerSelectionTitle}>Definir siguiente paso</Text>
                        <Text style={styles.requestText}>
                          El diagnostico ya fue recibido. Ahora puedes enviar materiales a proveedores o mandar la propuesta directo al cliente.
                        </Text>

                        <View style={styles.requestPrimaryActions}>
                          <TouchableOpacity
                            style={styles.quoteButton}
                            onPress={() => {
                              if (quoteRequestId === String(item.id)) {
                                setQuoteRequestId(null);
                                setSelectedProviderIds([]);
                                return;
                              }

                              setQuoteRequestId(String(item.id));
                              setSelectedProviderIds([]);
                            }}
                          >
                            <Text style={styles.quoteButtonText}>Proveedores</Text>
                            <MaterialCommunityIcons
                              name={quoteRequestId === String(item.id) ? "chevron-up" : "chevron-down"}
                              size={18}
                              color="#2563eb"
                            />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.acceptButton}
                            onPress={() => enviarCotizacionAlCliente(item.id)}
                          >
                            <Text style={styles.acceptButtonText}>Enviar directo al cliente</Text>
                          </TouchableOpacity>
                        </View>

                        {quoteRequestId === String(item.id) ? (
                          <View style={styles.providerSelectionCard}>
                            <Text style={styles.providerSelectionTitle}>Elegir proveedores</Text>
                            {proveedores.length > 0 ? (
                              proveedores.map((proveedor) => {
                                const proveedorId = Number(proveedor.id);
                                const selected = selectedProviderIds.includes(proveedorId);

                                return (
                                  <TouchableOpacity
                                    key={`diagnosed-provider-${item.id}-${proveedor.id}`}
                                    style={[
                                      styles.providerOption,
                                      selected && styles.providerOptionSelected,
                                    ]}
                                    onPress={() => toggleProveedorSeleccionado(proveedorId)}
                                  >
                                    <Text
                                      style={[
                                        styles.providerOptionTitle,
                                        selected && styles.providerOptionTitleSelected,
                                      ]}
                                    >
                                      {proveedor.nombre || "Proveedor"}
                                    </Text>
                                    <Text style={styles.providerOptionText}>
                                      {proveedor.email || "Sin email"}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })
                            ) : (
                              <Text style={styles.requestText}>No hay proveedores disponibles.</Text>
                            )}

                            <View style={styles.providerActions}>
                              <TouchableOpacity
                                style={styles.acceptButton}
                                onPress={() => enviarCotizacionAProveedores(item.id || "")}
                              >
                                <Text style={styles.acceptButtonText}>Enviar a proveedores</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {expandedQuote && respuestasCotizacion.length > 0 ? (
                      respuestasCotizacion.map((respuesta, index) => (
                        <View key={`respuesta-${item.id}-${index}`} style={styles.quoteSummaryCard}>
                          <Text style={styles.quoteSummaryTitle}>
                            {respuesta.proveedorNombre || `Respuesta del proveedor ${index + 1}`}
                          </Text>
                          <Text style={styles.requestText}>Marca: {respuesta.marca}</Text>
                          <Text style={styles.requestText}>Referencia: {respuesta.referencia}</Text>
                          <Text style={styles.requestText}>Garantia: {respuesta.garantia}</Text>
                          <Text style={styles.requestText}>
                            Disponibilidad: {respuesta.disponibilidad}
                          </Text>
                          <Text style={styles.requestText}>Precio: {formatCurrency(respuesta.precio)}</Text>
                          <Text style={styles.requestText}>
                            Observacion: {respuesta.observacion}
                          </Text>
                          {isQuotedStatus(item.estado) ? (
                            <View style={styles.quoteDecisionRow}>
                              <TouchableOpacity
                                style={[styles.quoteDecisionButton, styles.quoteDecisionSendButton]}
                                onPress={() =>
                                  enviarCotizacionAlCliente(item.id, respuesta.proveedorId, respuesta.responseIndex)
                                }
                              >
                                <Text style={styles.quoteDecisionSendText}>Enviar</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.quoteDecisionButton, styles.quoteDecisionSkipButton]}
                                onPress={() =>
                                  omitirCotizacionCliente(item.id, respuesta.proveedorId, respuesta.responseIndex)
                                }
                              >
                                <Text style={styles.quoteDecisionSkipText}>Omitir</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      ))
                    ) : null}

                    {expandedQuote && puedeEnviarDirectoCliente && !isDiagnosedStatus(item.estado) ? (
                      <View style={styles.quoteDecisionRow}>
                        <TouchableOpacity
                          style={[styles.quoteDecisionButton, styles.quoteDecisionSendButton]}
                          onPress={() => enviarCotizacionAlCliente(item.id)}
                        >
                          <Text style={styles.quoteDecisionSendText}>Enviar al cliente</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    </>
                      );
                    })()}
                    {isRejectedProviderStatus(item.estado) && item.cotizacion?.observacion ? (
                      <View style={styles.quoteSummaryCard}>
                        <Text style={styles.quoteSummaryTitle}>Comentario del proveedor</Text>
                        <Text style={styles.requestText}>{item.cotizacion.observacion}</Text>
                      </View>
                    ) : null}
                    {isRejectedProviderStatus(item.estado) ? (
                      <View style={styles.returnClientCard}>
                        <TouchableOpacity
                          style={styles.returnClientToggleButton}
                          onPress={() =>
                            setReturnToClientId((current) =>
                              current === String(item.id) ? null : String(item.id)
                            )
                          }
                        >
                          <Text style={styles.returnClientToggleText}>Devolver al cliente</Text>
                        </TouchableOpacity>

                        {returnToClientId === String(item.id) ? (
                          <View style={styles.returnClientForm}>
                            <TextInput
                              style={styles.returnClientInput}
                              value={returnToClientComment}
                              onChangeText={(value) => setReturnToClientComment(value.slice(0, 100))}
                              placeholder="Comentario para el cliente"
                              placeholderTextColor="#94a3b8"
                              multiline
                              maxLength={100}
                            />
                            <Text style={styles.returnClientCounter}>{returnToClientComment.length}/100</Text>
                            <TouchableOpacity
                              style={styles.returnClientSubmitButton}
                              onPress={() => devolverSolicitudAlCliente(item.id)}
                            >
                              <Text style={styles.returnClientSubmitText}>Enviar al cliente</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))
              ) : (
                <View style={styles.emptyNotice}>
                  <MaterialCommunityIcons name="clipboard-clock-outline" size={24} color="#ffb84d" />
                  <Text style={styles.emptyNoticeText}>
                    No hay solicitudes en cotizacion en este momento.
                  </Text>
                </View>
              )}
            </View>

          </View>
          )}

          {selectedSection === "Historial" && (
          <View style={styles.panelFull}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Historial</Text>
              <Text style={styles.panelMeta}>{archivedRequests.length} registros</Text>
            </View>

            {archivedRequests.length > 0 ? (
              archivedRequests.map((item) => (
                <View key={`archived-${item.id}`} style={styles.requestCard}>
                  {(() => {
                    const respuestasCotizacion = obtenerRespuestasCotizacion(item);

                    return (
                      <>
                  <View style={styles.requestHeader}>
                    <Text style={styles.requestId}>Orden #{item.id}</Text>
                    <View style={[styles.requestStatusPill, styles.archivedStatusPill]}>
                      <Text style={[styles.requestStatusText, styles.archivedStatusText]}>
                        {(item.estado || "").toLowerCase() === "omitida_admin"
                          ? "Omitida"
                          : (item.estado || "").toLowerCase() === "devuelta"
                            ? "Devuelta"
                            : "Archivada"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.requestText}>Cliente: {item.cliente?.nombre || "Cliente"}</Text>
                  <Text style={styles.requestText}>
                    Vehiculo: {`${item.vehiculo?.marca || ""} ${item.vehiculo?.modelo || ""}`.trim() || "Vehiculo"}
                  </Text>
                  <Text style={styles.requestText}>Servicio: {item.tipo_servicio || "Sin tipo"}</Text>
                  <Text style={styles.requestText}>Problema: {item.problema || "Sin descripcion"}</Text>
                  {(item.estado || "").toLowerCase() === "rechazada_taller" && item.observacion ? (
                    <Text style={styles.requestText}>Comentario taller: {item.observacion}</Text>
                  ) : null}
                  {["omitida_admin", "devuelta"].includes((item.estado || "").toLowerCase()) &&
                  respuestasCotizacion.length > 0
                    ? respuestasCotizacion.map((respuesta, index) => (
                        <View key={`archived-response-${item.id}-${index}`} style={styles.quoteSummaryCard}>
                          <Text style={styles.quoteSummaryTitle}>
                            {respuesta.proveedorNombre || `Respuesta del proveedor ${index + 1}`}
                          </Text>
                          <Text style={styles.requestText}>Marca: {respuesta.marca}</Text>
                          <Text style={styles.requestText}>Referencia: {respuesta.referencia}</Text>
                          <Text style={styles.requestText}>Garantia: {respuesta.garantia}</Text>
                          <Text style={styles.requestText}>
                            Disponibilidad: {respuesta.disponibilidad}
                          </Text>
                          <Text style={styles.requestText}>Precio: {formatCurrency(respuesta.precio)}</Text>
                          <Text style={styles.requestText}>Observacion: {respuesta.observacion}</Text>
                        </View>
                      ))
                    : null}
                  {(item.proveedores_estado || []).filter((proveedor) => (proveedor.estado || "").toLowerCase() === "devuelto").length > 0 ? (
                    <View style={styles.providerStatusCard}>
                      <Text style={styles.providerStatusTitle}>Devoluciones registradas</Text>
                      {(item.proveedores_estado || [])
                        .filter((proveedor) => (proveedor.estado || "").toLowerCase() === "devuelto")
                        .map((proveedor) => (
                          <View key={`history-return-${item.id}-${proveedor.id}`} style={styles.providerStatusRow}>
                            <Text style={styles.providerStatusName}>{proveedor.nombre || proveedor.email || "Proveedor"}</Text>
                            <View style={[styles.providerStatusBadge, styles.providerStatusBadgeReturned]}>
                              <Text style={[styles.providerStatusBadgeText, styles.providerStatusBadgeTextReturned]}>
                                Devuelto
                              </Text>
                            </View>
                            {proveedor.comentario ? (
                              <Text style={styles.providerStatusComment}>{proveedor.comentario}</Text>
                            ) : null}
                          </View>
                        ))}
                    </View>
                  ) : null}
                      </>
                    );
                  })()}
                </View>
              ))
            ) : (
              <View style={styles.emptyNotice}>
                <MaterialCommunityIcons name="archive-outline" size={24} color="#94a3b8" />
                <Text style={styles.emptyNoticeText}>Aun no hay solicitudes en el historial.</Text>
              </View>
            )}
          </View>
          )}

          {selectedSection === "Talleres" && (
          <View style={[styles.bottomGrid, isMobile && styles.bottomGridMobile]}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Modulo: Talleres</Text>
              {workshops.map((item) => (
                <View key={item.name} style={styles.infoCard}>
                  <Text style={styles.infoTitle}>{item.name}</Text>
                  <Text style={styles.infoText}>Calificacion: {item.rating}</Text>
                  <Text style={styles.infoText}>Ordenes activas: {item.activeOrders}</Text>
                  <Text style={styles.infoText}>Estado: {item.status}</Text>
                  {"email" in item ? <Text style={styles.infoText}>Email: {item.email}</Text> : null}
                  {"telefono" in item ? <Text style={styles.infoText}>Telefono: {item.telefono}</Text> : null}
                  <View style={styles.actionWrap}>
                    <Text style={styles.actionLink}>Aprobar</Text>
                    {"id" in item && "rawStatus" in item ? (
                      <TouchableOpacity
                        onPress={() =>
                          actualizarEstadoUsuario(
                            item.id,
                            item.rawStatus === "bloqueado" ? "activo" : "bloqueado"
                          )
                        }
                      >
                        <Text style={styles.actionLink}>
                          {item.rawStatus === "bloqueado" ? "Habilitar" : "Bloquear"}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.actionLink}>Bloquear</Text>
                    )}
                    <Text style={styles.actionLink}>Ver rendimiento</Text>
                  </View>
                </View>
              ))}
            </View>

          </View>
          )}

          {selectedSection === "Proveedores" && (
          <View style={[styles.bottomGrid, isMobile && styles.bottomGridMobile]}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Modulo: Proveedores</Text>
              {suppliers.map((item) => (
                <View key={item.name} style={styles.infoCard}>
                  <Text style={styles.infoTitle}>{item.name}</Text>
                  <Text style={styles.infoText}>Cotizaciones enviadas: {item.quotes}</Text>
                  <Text style={styles.infoText}>Tiempo promedio: {item.avgTime}</Text>
                  {"status" in item ? <Text style={styles.infoText}>Estado: {item.status}</Text> : null}
                  {"email" in item ? <Text style={styles.infoText}>Email: {item.email}</Text> : null}
                  {"telefono" in item ? <Text style={styles.infoText}>Telefono: {item.telefono}</Text> : null}
                  {"id" in item && "rawStatus" in item ? (
                    <View style={styles.actionWrap}>
                      <TouchableOpacity
                        onPress={() =>
                          actualizarEstadoUsuario(
                            item.id,
                            item.rawStatus === "bloqueado" ? "activo" : "bloqueado"
                          )
                        }
                      >
                        <Text style={styles.actionLink}>
                          {item.rawStatus === "bloqueado" ? "Habilitar" : "Bloquear"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
          )}

          {(selectedSection === "Usuarios" || selectedSection === "Pagos") && (
          <View style={[styles.bottomGrid, isMobile && styles.bottomGridMobile]}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Modulo: Usuarios</Text>
              {userGroups.map((item) => (
                <View key={item.label} style={styles.infoCard}>
                  <Text style={styles.infoTitle}>{item.label}</Text>
                  <Text style={styles.infoText}>Cantidad: {item.count}</Text>
                  <View style={styles.actionWrap}>
                    <Text style={styles.actionLink}>Bloquear</Text>
                    <Text style={styles.actionLink}>Editar</Text>
                    <Text style={styles.actionLink}>Ver actividad</Text>
                  </View>
                </View>
              ))}

              {usuarios.length > 0
                ? usuarios.map((item) => (
                    <View key={`user-${item.id}`} style={styles.infoCard}>
                      <Text style={styles.infoTitle}>{item.nombre || "Usuario"}</Text>
                      <Text style={styles.infoText}>Rol: {item.rol || "Sin rol"}</Text>
                      <Text style={styles.infoText}>Email: {item.email || "Sin email"}</Text>
                      <Text style={styles.infoText}>Telefono: {item.telefono || "Sin telefono"}</Text>
                    </View>
                  ))
                : null}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Modulo: Pagos</Text>
              {payments.map((item) => (
                <View key={item.label} style={styles.infoCard}>
                  <Text style={styles.infoTitle}>{item.label}</Text>
                  <Text style={styles.infoText}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>
          )}

          {(selectedSection === "Reportes" || selectedSection === "Configuracion") && (
          <View style={[styles.bottomGrid, isMobile && styles.bottomGridMobile]}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Modulo: Reportes</Text>
              {reports.map((item) => (
                <View key={item} style={styles.simpleRow}>
                  <MaterialCommunityIcons name="chart-line" size={18} color="#9eff6f" />
                  <Text style={styles.simpleText}>{item}</Text>
                </View>
              ))}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Configuracion</Text>
              {configItems.map((item) => (
                <View key={item} style={styles.simpleRow}>
                  <MaterialCommunityIcons name="cog-outline" size={18} color="#73d0ff" />
                  <Text style={styles.simpleText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef3f9",
  },
  content: {
    padding: 20,
  },
  layout: {
    width: "100%",
  },
  menuWrapper: {
    position: "relative",
    zIndex: 20,
  },
  topActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
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
    width: 320,
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
  logoBox: {
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
  sideItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  sideItemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sideItemActive: {
    backgroundColor: "#dfe9f7",
  },
  sideText: {
    color: "#c2cbe0",
    marginLeft: 12,
    fontWeight: "600",
  },
  sideTextActive: {
    color: "#08121f",
    fontWeight: "800",
  },
  sideBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ff7a18",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  sideBadgeText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 12,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 18,
    backgroundColor: "rgba(255,91,46,0.12)",
  },
  logoutButtonText: {
    color: "#ffb4a8",
    fontSize: 15,
    fontWeight: "700",
  },
  main: {
    flex: 1,
    gap: 18,
  },
  topBar: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  topBarMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 16,
  },
  pageTitle: {
    color: "#08121f",
    fontSize: 32,
    fontWeight: "800",
  },
  pageSubtitle: {
    color: "#5f6b7c",
    marginTop: 8,
    fontSize: 16,
    lineHeight: 22,
    maxWidth: 560,
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
  notificationBadgeTop: {
    position: "absolute",
    top: 6,
    right: 5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ff5b2e",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notificationBadgeTextTop: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
  notificationsDropdown: {
    position: "absolute",
    top: 110,
    right: 0,
    left: 0,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    marginTop: -4,
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
    color: "#08121f",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
  },
  notificationItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e6edf6",
  },
  notificationItemTitle: {
    color: "#08121f",
    fontWeight: "800",
  },
  notificationItemText: {
    color: "#5f6b7c",
    marginTop: 4,
  },
  panelText: {
    color: "#5f6b7c",
    lineHeight: 22,
  },
  secondaryActionButton: {
    backgroundColor: "#eef2ff",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    color: "#334155",
    fontWeight: "800",
  },
  acceptButton: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  kpiCard: {
    minWidth: 160,
    flexGrow: 1,
    width: "31%",
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  kpiCardMobile: {
    width: "47%",
    minWidth: 0,
  },
  kpiPill: {
    width: 42,
    height: 6,
    borderRadius: 999,
    marginBottom: 18,
  },
  kpiLabel: {
    color: "#6b778a",
    fontWeight: "700",
    marginTop: 6,
  },
  kpiValue: {
    color: "#08121f",
    fontSize: 28,
    fontWeight: "800",
  },
  chartRow: {
    flexDirection: "row",
    gap: 16,
  },
  chartRowMobile: {
    flexDirection: "column",
  },
  panelLarge: {
    flex: 1.25,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  panelMedium: {
    flex: 0.75,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  panelFull: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  panel: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  panelTitle: {
    color: "#08121f",
    fontSize: 20,
    fontWeight: "800",
  },
  panelMeta: {
    color: "#7a8699",
    fontWeight: "700",
  },
  barChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 18,
    height: 220,
    paddingTop: 18,
  },
  barItem: {
    alignItems: "center",
    flex: 1,
  },
  barFill: {
    width: 34,
    borderRadius: 14,
    backgroundColor: "#2f8fff",
    marginBottom: 10,
  },
  barLabel: {
    color: "#7a8699",
    fontWeight: "700",
  },
  incomeChart: {
    gap: 14,
    marginTop: 6,
  },
  incomeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  incomeLabel: {
    color: "#7a8699",
    width: 32,
    fontWeight: "700",
  },
  incomeTrack: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: "#eef3f9",
    overflow: "hidden",
  },
  incomeFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#ff8a3d",
  },
  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  typeLabel: {
    width: 110,
    color: "#08121f",
    fontWeight: "700",
  },
  typeTrack: {
    flex: 1,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#eef3f9",
    overflow: "hidden",
    marginHorizontal: 12,
  },
  typeFill: {
    height: "100%",
    borderRadius: 999,
  },
  typeValue: {
    color: "#08121f",
    fontWeight: "800",
    width: 46,
    textAlign: "right",
  },
  filterWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
  tableRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e6edf6",
  },
  tableStrong: {
    color: "#08121f",
    fontWeight: "800",
  },
  tableText: {
    color: "#425066",
    fontWeight: "600",
  },
  notificationPanel: {
    backgroundColor: "#f8fbff",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e6edf6",
    marginBottom: 18,
  },
  notificationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    gap: 12,
  },
  notificationTitle: {
    color: "#08121f",
    fontSize: 18,
    fontWeight: "800",
  },
  notificationSubtitle: {
    color: "#7a8699",
    marginTop: 4,
    fontWeight: "600",
  },
  notificationBadge: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#ff7a18",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  notificationBadgeText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  requestCard: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  requestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  requestId: {
    color: "#08121f",
    fontSize: 16,
    fontWeight: "800",
    flex: 1,
    flexShrink: 1,
    paddingRight: 8,
  },
  requestStatusPill: {
    marginLeft: "auto",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,122,24,0.16)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,122,24,0.35)",
  },
  requestStatusText: {
    color: "#ffb066",
    fontWeight: "800",
  },
  requestStatusPillSuccess: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  requestStatusPillReturned: {
    backgroundColor: "#fee2e2",
    borderColor: "#fecaca",
  },
  requestStatusTextSuccess: {
    color: "#15803d",
  },
  requestStatusTextReturned: {
    color: "#b91c1c",
  },
  requestText: {
    color: "#425066",
    marginTop: 4,
    fontWeight: "600",
  },
  quoteExpandHint: {
    color: "#64748b",
    marginTop: 10,
    fontSize: 12,
    fontWeight: "700",
  },
  quoteDecisionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  quoteDecisionButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
  },
  quoteDecisionSendButton: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  quoteDecisionSkipButton: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
  },
  quoteDecisionSendText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  quoteDecisionSkipText: {
    color: "#475569",
    fontWeight: "800",
  },
  quoteSummaryCard: {
    marginTop: 14,
    backgroundColor: "#f0fdf4",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  quoteSummaryTitle: {
    color: "#166534",
    fontWeight: "800",
    marginBottom: 6,
  },
  providerStatusCard: {
    marginTop: 14,
    backgroundColor: "#f8fbff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d7e4fb",
    gap: 10,
  },
  providerStatusTitle: {
    color: "#08121f",
    fontWeight: "800",
  },
  providerStatusRow: {
    gap: 8,
  },
  providerStatusName: {
    color: "#334155",
    fontWeight: "700",
  },
  providerStatusBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  providerStatusBadgePending: {
    backgroundColor: "#fff7d6",
    borderColor: "#fde68a",
  },
  providerStatusBadgeSuccess: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
  },
  providerStatusBadgeReturned: {
    backgroundColor: "#fee2e2",
    borderColor: "#fecaca",
  },
  providerStatusBadgeText: {
    fontWeight: "800",
    fontSize: 12,
  },
  providerStatusBadgeTextPending: {
    color: "#b7791f",
  },
  providerStatusBadgeTextSuccess: {
    color: "#15803d",
  },
  providerStatusBadgeTextReturned: {
    color: "#b91c1c",
  },
  providerStatusComment: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 18,
  },
  returnClientCard: {
    marginTop: 14,
    gap: 10,
  },
  returnClientToggleButton: {
    alignSelf: "flex-start",
    backgroundColor: "#fff1f2",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#fecdd3",
  },
  returnClientToggleText: {
    color: "#be123c",
    fontWeight: "800",
  },
  returnClientForm: {
    backgroundColor: "#fff8f8",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  returnClientInput: {
    minHeight: 90,
    textAlignVertical: "top",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    color: "#08121f",
  },
  returnClientCounter: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "right",
    marginTop: 6,
  },
  returnClientSubmitButton: {
    marginTop: 10,
    backgroundColor: "#dc2626",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  returnClientSubmitText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  deleteQuoteButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  requestPrimaryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  quoteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: "#eef4ff",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#d7e4fb",
    minWidth: 170,
  },
  quoteButtonText: {
    color: "#2563eb",
    fontWeight: "800",
  },
  providerSelectionCard: {
    marginTop: 14,
    backgroundColor: "#f8fbff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#d7e4fb",
  },
  providerSelectionTitle: {
    color: "#08121f",
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 10,
  },
  providerOption: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e6edf6",
    marginTop: 10,
  },
  providerOptionSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eef4ff",
  },
  providerOptionTitle: {
    color: "#08121f",
    fontWeight: "700",
  },
  providerOptionTitleSelected: {
    color: "#1d4ed8",
  },
  providerOptionText: {
    color: "#5f6b7c",
    marginTop: 4,
  },
  providerActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    flexWrap: "wrap",
  },
  emptyNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  emptyNoticeText: {
    color: "#6b778a",
    fontWeight: "700",
  },
  archivedStatusPill: {
    backgroundColor: "#e2e8f0",
    borderColor: "#cbd5e1",
  },
  archivedStatusText: {
    color: "#475569",
  },
  bottomGrid: {
    flexDirection: "row",
    gap: 16,
  },
  bottomGridMobile: {
    flexDirection: "column",
  },
  infoCard: {
    backgroundColor: "#f8fbff",
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  infoTitle: {
    color: "#08121f",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 8,
  },
  infoText: {
    color: "#5f6b7c",
    marginTop: 4,
  },
  actionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  actionLink: {
    color: "#23b26d",
    fontWeight: "800",
  },
  simpleRow: {
    marginTop: 14,
    backgroundColor: "#f8fbff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  summaryRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  simpleText: {
    color: "#2f3a49",
    fontWeight: "700",
    flex: 1,
  },
  summaryInlineValue: {
    color: "#64748b",
    fontWeight: "800",
  },
  summaryExpandedText: {
    color: "#08121f",
    fontWeight: "800",
    marginTop: 10,
  },
  summaryExpandedBlock: {
    marginTop: 10,
    gap: 8,
  },
  summaryDetailText: {
    color: "#475569",
    lineHeight: 20,
  },
  summaryDetailEmpty: {
    color: "#94a3b8",
    fontStyle: "italic",
  },
});
