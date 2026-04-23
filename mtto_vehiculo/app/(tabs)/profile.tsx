import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "../../constants/api";
import { formatCurrency, formatDateTime, formatNumberWithDots } from "../../constants/formatters";
import {
  getStatusTone,
  isApprovedStatus,
  isFinishedStatus,
  isInProcessStatus,
  isInQuotationStatus,
  isQuoteWorkflowService,
  isQuotedStatus,
  isRejectedProviderStatus,
  isWaitingClientStatus,
  normalizeStatus,
} from "../../constants/request-status";
import storage from "../../constants/storage";

type Solicitud = {
  id?: number | string;
  numero_caso?: number | string | null;
  solicitud_origen_id?: number | string | null;
  tipo_servicio?: string;
  problema?: string;
  estado?: string;
  fecha?: string | null;
  fecha_recepcion?: string | null;
  vehiculo?: {
    marca?: string;
    modelo?: string;
    placa?: string;
  };
  cliente?: {
    nombre?: string;
  };
  proveedores_estado?: {
    id?: number | string | null;
    estado?: string | null;
    comentario?: string | null;
  }[];
  cotizacion?: {
    proveedor_id?: number | string | null;
    marca?: string | null;
    referencia?: string | null;
    garantia?: string | null;
    disponibilidad?: string | null;
    precio?: string | null;
    observacion?: string | null;
    documento_excel_nombre?: string | null;
  };
  respuesta_proveedor?: {
    comentario?: string | null;
  };
  flujo_mantenimiento?: {
    repuestos_solicitados?: {
      nombre?: string | null;
      cantidad?: number | null;
    }[];
    timeline?: Record<string, string | null>;
    confirmaciones?: Record<string, boolean | string | null>;
  };
};

type Notificacion = {
  id?: number | string;
  titulo?: string;
  mensaje?: string;
  tipo?: string;
  leida?: boolean;
};

type QuoteFormState = {
  marca: string;
  referencia: string;
  garantia: string;
  disponibilidad: string;
  precio: string;
  observacion: string;
};

type UploadedExcelState = {
  name: string;
  mime: string;
  base64: string;
};

const providerSections = [
  "Vista general",
  "Cotizaciones",
  "Pedidos",
  "Historial",
  "Configuracion",
];

const sectionIcons: Record<string, string> = {
  "Vista general": "view-dashboard-outline",
  Cotizaciones: "file-document-edit-outline",
  Pedidos: "clipboard-list-outline",
  Historial: "history",
  Configuracion: "cog-outline",
};

const emptyForm = (): QuoteFormState => ({
  marca: "",
  referencia: "",
  garantia: "",
  disponibilidad: "",
  precio: "",
  observacion: "",
});

const getCaseNumber = (item: Solicitud) => item.numero_caso ?? item.id;

const parseUserIdFromToken = (token?: string | null) => {
  if (!token) return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    if (typeof globalThis.atob !== "function") return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = globalThis.atob(padded);
    const data = JSON.parse(decoded);
    const id = Number(data?.id);
    return Number.isFinite(id) ? id : null;
  } catch (error) {
    console.log("No se pudo leer el id del proveedor desde el token", error);
    return null;
  }
};

const getProviderResponseState = (item: Solicitud, providerId?: number | null) => {
  if (!providerId) return null;

  const providerState = (item.proveedores_estado || []).find(
    (provider) => String(provider.id) === String(providerId)
  );

  return normalizeStatus(providerState?.estado);
};

const hasProviderFinishedQuotation = (item: Solicitud, providerId?: number | null) => {
  const providerState = getProviderResponseState(item, providerId);
  return providerState === "cotizado" || providerState === "devuelto";
};

const isSelectedProviderForOrder = (item: Solicitud, providerId?: number | null) => {
  if (!providerId) return false;
  return String(item.cotizacion?.proveedor_id ?? "") === String(providerId);
};

const hasClientApprovedFlow = (item: Solicitud) =>
  Boolean(item.flujo_mantenimiento?.timeline?.cliente_aprueba_propuesta_en) ||
  isApprovedStatus(item.estado) ||
  isInProcessStatus(item.estado);

const getProviderRequestPriority = (item: Solicitud) => {
  const status = normalizeStatus(item.estado);

  if (isWaitingClientStatus(status)) return 5;
  if (isInProcessStatus(status)) return 4;
  if (isApprovedStatus(status)) return 3;
  if (isInQuotationStatus(status)) return 2;
  return 1;
};

const dedupeProviderRequests = (items: Solicitud[]) => {
  const itemsByCase = new Map<string, Solicitud[]>();

  items.forEach((item) => {
    const caseKey = String(item.numero_caso ?? item.solicitud_origen_id ?? item.id ?? "");
    const current = itemsByCase.get(caseKey) || [];
    current.push(item);
    itemsByCase.set(caseKey, current);
  });

  return Array.from(itemsByCase.values()).map((group) =>
    group.sort((left, right) => {
      const priorityDiff = getProviderRequestPriority(right) - getProviderRequestPriority(left);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const childDiff = Number(Boolean(right.solicitud_origen_id)) - Number(Boolean(left.solicitud_origen_id));
      if (childDiff !== 0) {
        return childDiff;
      }

      return Number(right.id || 0) - Number(left.id || 0);
    })[0]
  );
};

export default function ProviderDashboardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const isMobile = width < 900;
  const [providerName, setProviderName] = useState("Proveedor");
  const [selectedSection, setSelectedSection] = useState("Cotizaciones");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedVehicleFilter, setSelectedVehicleFilter] = useState("Todos");
  const [selectedDateFilter, setSelectedDateFilter] = useState("Todas");
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [quoteForms, setQuoteForms] = useState<QuoteFormState[]>([emptyForm()]);
  const [returningQuoteId, setReturningQuoteId] = useState<string | null>(null);
  const [returnComment, setReturnComment] = useState("");
  const [orderComments, setOrderComments] = useState<Record<string, string>>({});
  const [uploadedExcelDocs, setUploadedExcelDocs] = useState<Record<string, UploadedExcelState>>({});
  const [providerId, setProviderId] = useState<number | null>(null);
  const [actionLoadingMessage, setActionLoadingMessage] = useState<string | null>(null);

  const withActionLoading = async <T,>(message: string, action: () => Promise<T>) => {
    try {
      setActionLoadingMessage(message);
      return await action();
    } finally {
      setActionLoadingMessage(null);
    }
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

  const cargarSolicitudes = async () => {
    try {
      const token = await storage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/solicitudes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      setSolicitudes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log("Error cargando solicitudes proveedor", error);
      setSolicitudes([]);
    }
  };

  const cargarNotificaciones = async () => {
    try {
      const token = await storage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/notificaciones`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      setNotificaciones(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log("Error cargando notificaciones proveedor", error);
      setNotificaciones([]);
    }
  };

  useEffect(() => {
    const loadUser = async () => {
      const name = await storage.getItem("user_name");
      const token = await storage.getItem("token");
      if (name) setProviderName(name);
      setProviderId(parseUserIdFromToken(token));
    };

    loadUser();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      setActionLoadingMessage(null);
      cargarSolicitudes();
      cargarNotificaciones();

      const interval = setInterval(() => {
        cargarSolicitudes();
        cargarNotificaciones();
      }, 8000);

      return () => clearInterval(interval);
    }, [])
  );

  useEffect(() => {
    if (!isMobile) {
      setMenuOpen(false);
    }
  }, [isMobile]);

  const cotizaciones = useMemo(
    () =>
      dedupeProviderRequests(solicitudes).filter(
        (item) => isInQuotationStatus(item.estado) && !hasProviderFinishedQuotation(item, providerId)
      ),
    [providerId, solicitudes]
  );

  const pedidos = useMemo(
    () =>
      dedupeProviderRequests(solicitudes).filter((item) =>
        isSelectedProviderForOrder(item, providerId) &&
        hasClientApprovedFlow(item) &&
        !item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado
      ).sort((a, b) => Number(b.id || 0) - Number(a.id || 0)),
    [providerId, solicitudes]
  );

  const entregas = useMemo(
    () =>
      dedupeProviderRequests(solicitudes).filter((item) =>
        isQuotedStatus(item.estado) ||
        isFinishedStatus(item.estado) ||
        isRejectedProviderStatus(item.estado) ||
        hasProviderFinishedQuotation(item, providerId) ||
        Boolean(item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado)
      ),
    [providerId, solicitudes]
  );

  const unreadNotifications = useMemo(
    () => notificaciones.filter((item) => !item.leida).length,
    [notificaciones]
  );

  const obtenerTituloSolicitud = (tipoServicio?: string) => {
    const value = (tipoServicio || "").toLowerCase();

    if (
      value.includes(",") ||
      value.includes(":") ||
      value.includes("mantenimiento") ||
      value.includes("diagnostico")
    ) {
      return tipoServicio || "Solicitud";
    }

    if (value.includes("llanta")) return "Solicitud de llantas";
    if (value.includes("bateria")) return "Solicitud de bateria";
    if (value.includes("aceite") || value.includes("filtro")) return "Solicitud de aceite";

    return tipoServicio || "Solicitud";
  };

  const esSolicitudMantenimientoTaller = (
    tipoServicio?: string,
    flujoMantenimiento?: Solicitud["flujo_mantenimiento"]
  ) => {
    const value = (tipoServicio || "").toLowerCase();
    const tieneFlujoMantenimiento = Boolean(
      flujoMantenimiento?.repuestos_solicitados?.length || flujoMantenimiento?.confirmaciones
    );
    return (
      tieneFlujoMantenimiento ||
      (
        !isQuoteWorkflowService(tipoServicio) &&
        (value.includes(",") ||
          value.includes(":") ||
          value.includes("mantenimiento") ||
          value.includes("diagnostico") ||
          value.includes("motor") ||
          value.includes("suspension") ||
          value.includes("alineacion") ||
          value.includes("enfriamiento") ||
          value.includes("recalentamiento") ||
          value.includes("temperatura") ||
          value.includes("radiador"))
      )
    );
  };

  const seleccionarDocumentoExcel = async (solicitudId: string) => {
    const acceptedMime =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    if (Platform.OS === "web" && typeof document !== "undefined") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const base64 = result.includes(",") ? result.split(",")[1] || "" : result;
          setUploadedExcelDocs((current) => ({
            ...current,
            [solicitudId]: {
              name: file.name,
              mime: file.type || acceptedMime,
              base64,
              },
          }));
          Alert.alert("Documento cargado", `Se adjunto ${file.name}.`);
        };
        reader.readAsDataURL(file);
      };

      input.click();
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const uri = asset.uri;
      if (!uri) {
        Alert.alert("Error", "No se pudo leer el archivo seleccionado.");
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setUploadedExcelDocs((current) => ({
        ...current,
        [solicitudId]: {
          name: asset.name || `cotizacion-${solicitudId}.xlsx`,
          mime: asset.mimeType || acceptedMime,
          base64,
        },
      }));
      Alert.alert("Documento cargado", `Se adjunto ${asset.name || "el archivo Excel"}.`);
    } catch (error) {
      console.log("Error seleccionando documento Excel", error);
      Alert.alert("Error", "No se pudo cargar el archivo de Excel.");
    }
  };

  const eliminarDocumentoExcel = (solicitudId: string) => {
    setUploadedExcelDocs((current) => {
      const next = { ...current };
      delete next[solicitudId];
      return next;
    });
  };

  const abrirFormularioCotizacion = (item: Solicitud) => {
    setExpandedQuoteId(String(item.id));
    setReturningQuoteId(null);
    setReturnComment("");
    setQuoteForms([emptyForm()]);
  };

  const alternarFormularioCotizacion = (item: Solicitud) => {
    if (expandedQuoteId === String(item.id)) {
      setExpandedQuoteId(null);
      setQuoteForms([emptyForm()]);
      setReturningQuoteId(null);
      setReturnComment("");
      return;
    }

    abrirFormularioCotizacion(item);
  };

  const actualizarCampo = (index: number, field: keyof QuoteFormState, value: string) => {
    if (field === "precio") {
      setQuoteForms((current) =>
        current.map((item, currentIndex) =>
          currentIndex === index
            ? { ...item, precio: formatNumberWithDots(value.replace(/\D/g, "").slice(0, 20)) }
            : item
        )
      );
      return;
    }

    const limit = field === "observacion" ? 100 : 20;
    setQuoteForms((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, [field]: value.slice(0, limit) } : item
      )
    );
  };

  const agregarFormulario = () => {
    setQuoteForms((current) => [...current, emptyForm()]);
  };

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
      console.log("Error marcando notificacion proveedor", error);
    }

    const solicitudId = extraerSolicitudId(item.mensaje);
    const solicitud = solicitudes.find((current) => String(current.id) === String(solicitudId));
    const estado = normalizeStatus(solicitud?.estado);

    setShowNotifications(false);
    setSelectedSection(
      isApprovedStatus(estado) || isInProcessStatus(estado)
        ? "Pedidos"
        : isQuotedStatus(estado) || isFinishedStatus(estado)
          ? "Historial"
          : "Cotizaciones"
    );

    if (solicitud) {
      if (isApprovedStatus(estado) || isInProcessStatus(estado)) {
        setExpandedQuoteId(String(solicitud.id));
        setOrderComments((current) => ({
          ...current,
          [String(solicitud.id)]: current[String(solicitud.id)] ?? solicitud.respuesta_proveedor?.comentario ?? "",
        }));
      } else {
        abrirFormularioCotizacion(solicitud);
      }
    }

    setNotificaciones((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, leida: true } : notification
      )
    );
  };

  const enviarCotizacion = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    const solicitud = solicitudes.find((item) => String(item.id) === String(solicitudId));
    const esMantenimiento = esSolicitudMantenimientoTaller(
      solicitud?.tipo_servicio,
      solicitud?.flujo_mantenimiento
    );
    const excelDoc = uploadedExcelDocs[String(solicitudId)];

    const camposVacios = quoteForms.some((form) =>
      Object.entries(form).some(([, value]) => !value.trim())
    );
    if (!esMantenimiento && camposVacios) {
      Alert.alert("Campos requeridos", "Debes completar todos los campos de la cotizacion.");
      return;
    }

    if (esMantenimiento && !excelDoc?.base64) {
      Alert.alert("Excel requerido", "Debes cargar el documento Excel de la cotizacion.");
      return;
    }

    const payload = {
      marca: quoteForms.map((item) => item.marca.trim()).join(" | "),
      referencia: quoteForms.map((item) => item.referencia.trim()).join(" | "),
      garantia: quoteForms.map((item) => item.garantia.trim()).join(" | "),
      disponibilidad: quoteForms.map((item) => item.disponibilidad.trim()).join(" | "),
      precio: quoteForms.map((item) => item.precio.trim()).join(" | "),
      observacion: quoteForms.map((item) => item.observacion.trim()).join(" | "),
      documento_excel_nombre: excelDoc?.name || null,
      documento_excel_mime: excelDoc?.mime || null,
      documento_excel_base64: excelDoc?.base64 || null,
    };

    try {
      await withActionLoading("Enviando cotizacion...", async () => {
        const token = await storage.getItem("token");
        const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/respuesta-proveedor`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          Alert.alert("Error", data.detail || "No se pudo enviar la cotizacion");
          return;
        }

        setExpandedQuoteId(null);
        setQuoteForms([emptyForm()]);
        setUploadedExcelDocs((current) => {
          const next = { ...current };
          delete next[String(solicitudId)];
          return next;
        });
        await cargarSolicitudes();
        Alert.alert("Enviado", "La cotizacion fue enviada al administrador.");
      });
    } catch (error) {
      console.log("Error enviando cotizacion", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const devolverSolicitud = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    if (!returnComment.trim()) {
      Alert.alert("Comentario requerido", "Debes escribir un comentario para devolver la solicitud.");
      return;
    }

    try {
      await withActionLoading("Devolviendo solicitud...", async () => {
        const token = await storage.getItem("token");
        const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/devolver-proveedor`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ comentario: returnComment.trim() }),
        });

        const data = await response.json();

        if (!response.ok) {
          Alert.alert("Error", data.detail || "No se pudo devolver la solicitud");
          return;
        }

        setReturningQuoteId(null);
        setReturnComment("");
        setExpandedQuoteId(null);
        await cargarSolicitudes();
        Alert.alert("Devuelta", "La solicitud fue devuelta al administrador.");
      });
    } catch (error) {
      console.log("Error devolviendo solicitud", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const actualizarEstadoPedido = async (
    solicitudId: string | number | undefined,
    estado: "espera_cliente" | "en_reparacion" | "finalizada" | "repuestos_despachados",
    successMessage: string
  ) => {
    if (solicitudId == null) return;

    try {
      await withActionLoading("Actualizando pedido...", async () => {
        const comentario = (orderComments[String(solicitudId)] || "").trim();
        const token = await storage.getItem("token");
        const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/estado`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ estado, comentario }),
        });

        const data = await response.json();

        if (!response.ok) {
          Alert.alert("Error", data.detail || "No se pudo actualizar el pedido");
          return;
        }

        await cargarSolicitudes();
        Alert.alert("Actualizado", successMessage);
      });
    } catch (error) {
      console.log("Error actualizando estado proveedor", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const renderStatus = (estado?: string) => {
    return getStatusTone(estado);
  };

  const providerVehicleFilters = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set(
          solicitudes
            .map((item) => [item.vehiculo?.marca, item.vehiculo?.modelo].filter(Boolean).join(" ") || "Vehiculo")
            .filter(Boolean)
        )
      ),
    ],
    [solicitudes]
  );
  const providerDateFilters = ["Todas", "Hoy", "Ultimos 7 dias", "Sin fecha"];

  const matchesQuickFilters = useCallback(
    (item: Solicitud) => {
      const vehicleName = [item.vehiculo?.marca, item.vehiculo?.modelo].filter(Boolean).join(" ") || "Vehiculo";
      const vehicleMatch = selectedVehicleFilter === "Todos" || vehicleName === selectedVehicleFilter;

      const rawDate = item.fecha_recepcion || item.fecha;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const hasDate = parsedDate != null && !Number.isNaN(parsedDate.getTime());
      const now = new Date();
      const diffMs = hasDate ? now.getTime() - parsedDate.getTime() : null;
      const dayMs = 1000 * 60 * 60 * 24;

      const dateMatch =
        selectedDateFilter === "Todas" ||
        (selectedDateFilter === "Sin fecha" && !hasDate) ||
        (selectedDateFilter === "Hoy" && hasDate && parsedDate!.toDateString() === now.toDateString()) ||
        (selectedDateFilter === "Ultimos 7 dias" && hasDate && diffMs != null && diffMs <= dayMs * 7);

      return vehicleMatch && dateMatch;
    },
    [selectedDateFilter, selectedVehicleFilter]
  );

  const filtrarSolicitudes = useCallback(
    (items: Solicitud[]) => items.filter((item) => matchesQuickFilters(item)),
    [matchesQuickFilters]
  );

  const renderQuickFilterModal = () =>
    showFilterModal ? (
      <View style={styles.quickFilterOverlay} pointerEvents="box-none">
        <Pressable style={styles.quickFilterBackdrop} onPress={() => setShowFilterModal(false)} />
        <View style={styles.quickFilterCard}>
          <Text style={styles.quickFilterTitle}>Filtros rapidos</Text>
          <Text style={styles.quickFilterLabel}>Vehiculo</Text>
          <View style={styles.quickFilterChipWrap}>
            {providerVehicleFilters.map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.quickFilterChip,
                  selectedVehicleFilter === filter && styles.quickFilterChipActive,
                ]}
                onPress={() => setSelectedVehicleFilter(filter)}
              >
                <Text style={[styles.quickFilterChipText, selectedVehicleFilter === filter && styles.quickFilterChipTextActive]}>
                  {filter}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.quickFilterLabel}>Fecha</Text>
          <View style={styles.quickFilterChipWrap}>
            {providerDateFilters.map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.quickFilterChip,
                  selectedDateFilter === filter && styles.quickFilterChipActive,
                ]}
                onPress={() => setSelectedDateFilter(filter)}
              >
                <Text style={[styles.quickFilterChipText, selectedDateFilter === filter && styles.quickFilterChipTextActive]}>
                  {filter}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.quickFilterActions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setSelectedVehicleFilter("Todos");
                setSelectedDateFilter("Todas");
              }}
            >
              <Text style={styles.secondaryButtonText}>Limpiar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setShowFilterModal(false)}>
              <Text style={styles.primaryButtonText}>Aplicar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    ) : null;

  const actualizarComentarioPedido = (solicitudId: string, value: string) => {
    setOrderComments((current) => ({
      ...current,
      [solicitudId]: value.slice(0, 300),
    }));
  };

  const renderPlaceholder = (title: string, text: string) => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.panelText}>{text}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
    <Modal transparent visible={Boolean(actionLoadingMessage)} animationType="fade">
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>{actionLoadingMessage || "Procesando..."}</Text>
        </View>
      </View>
    </Modal>
    {renderQuickFilterModal()}
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
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

              <View style={styles.topRightActions}>
                <TouchableOpacity
                  style={styles.bellButton}
                  activeOpacity={0.9}
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
                  <View style={styles.logoBox}>
                    <MaterialCommunityIcons name="truck-delivery-outline" size={22} color="#fff" />
                  </View>
                  <View>
                    <Text style={styles.eyebrow}>PROVEEDOR</Text>
                    <Text style={styles.brandTitle}>{providerName}</Text>
                  </View>
                </View>

                <Text style={styles.sideWelcome}>Bienvenido</Text>

                {providerSections.map((item) => {
                  const active = selectedSection === item;

                  return (
                    <TouchableOpacity
                      key={item}
                      style={[styles.sideItem, active && styles.sideItemActive]}
                      onPress={() => {
                        setSelectedSection(item);
                        setMenuOpen(false);
                      }}
                    >
                      <MaterialCommunityIcons
                        name={(sectionIcons[item] || "circle-outline") as any}
                        size={20}
                        color={active ? "#08121f" : "#c2cbe0"}
                      />
                      <Text style={[styles.sideText, active && styles.sideTextActive]}>{item}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>

          {showNotifications ? (
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
          ) : null}

          <View style={[styles.hero, isMobile && styles.heroMobile]}>
            <View>
              <Text style={styles.greeting}>Buenos dias</Text>
              <Text style={styles.title}>{providerName}</Text>
              <Text style={styles.subtitle}>
                Gestiona cotizaciones, pedidos y seguimiento de repuestos desde tu panel de proveedor.
              </Text>
            </View>

          </View>

          {selectedSection === "Vista general" ? (
            <View style={styles.cardGrid}>
              <View style={[styles.card, isMobile && styles.cardMobile]}>
                <Text style={styles.cardValue}>{cotizaciones.length}</Text>
                <Text style={styles.cardLabel}>Cotizaciones</Text>
              </View>
              <View style={[styles.card, isMobile && styles.cardMobile]}>
                <Text style={styles.cardValue}>{pedidos.length}</Text>
                <Text style={styles.cardLabel}>Pedidos en proceso</Text>
              </View>
              <View style={[styles.card, isMobile && styles.cardMobile]}>
                <Text style={styles.cardValue}>{entregas.length}</Text>
                <Text style={styles.cardLabel}>Entregas completadas</Text>
              </View>
            </View>
          ) : null}

          {selectedSection === "Vista general"
            ? renderPlaceholder(
                "Vista general de proveedor",
                "Aqui veras el resumen de solicitudes enviadas por el administrador y su estado actual."
              )
            : null}

          {selectedSection === "Cotizaciones" ? (
            <View style={styles.panel}>
              <View style={styles.moduleHeaderCard}>
                <View style={styles.moduleHeaderText}>
                  <Text style={styles.moduleHeaderTitle}>Modulo: Proveedor</Text>
                  <Text style={styles.moduleHeaderSubtitle}>Gestion centralizada de cotizaciones y pedidos.</Text>
                </View>
                <View style={styles.moduleHeaderBadge}>
                  <MaterialCommunityIcons name="clipboard-list-outline" size={18} color="#2563eb" />
                  <Text style={styles.moduleHeaderBadgeText}>{filtrarSolicitudes(cotizaciones).length}</Text>
                </View>
              </View>
              <View style={styles.sectionToolbar}>
                <Text style={styles.sectionToolbarTitle}>Cotizaciones</Text>
                <TouchableOpacity style={styles.filterActionButton} onPress={() => setShowFilterModal(true)}>
                  <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
                </TouchableOpacity>
              </View>
              {filtrarSolicitudes(cotizaciones).length > 0 ? (
                filtrarSolicitudes(cotizaciones).map((item) => {
                  const statusInfo = renderStatus(item.estado);
                  const isExpanded = expandedQuoteId === String(item.id);
                  const isQuoted = isQuotedStatus(item.estado);
                  const isMaintenance = esSolicitudMantenimientoTaller(
                    item.tipo_servicio,
                    item.flujo_mantenimiento
                  );
                  const excelDoc = uploadedExcelDocs[String(item.id)];
                  const hasUploadedExcel = Boolean(excelDoc?.base64);

                  return (
                    <View key={String(item.id)} style={styles.orderCard}>
                      <TouchableOpacity
                        activeOpacity={0.95}
                        onPress={() => alternarFormularioCotizacion(item)}
                      >
                        <View style={styles.orderHeader}>
                          <Text style={styles.orderTitle}>{obtenerTituloSolicitud(item.tipo_servicio)}</Text>
                          <View style={[styles.statusPill, { backgroundColor: statusInfo.backgroundColor, borderColor: statusInfo.borderColor }]}>
                            <Text style={[styles.statusText, { color: statusInfo.color }]}>
                              {statusInfo.label}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.orderText}>
                          Cliente: {item.cliente?.nombre || "Cliente"}
                        </Text>
                        <Text style={styles.orderText}>
                          Vehiculo: {item.vehiculo?.marca || ""} {item.vehiculo?.modelo || ""}
                        </Text>
                        <Text style={styles.orderText}>Placa: {item.vehiculo?.placa || "N/A"}</Text>
                        <Text style={styles.orderText}>Solicitud #{getCaseNumber(item)}</Text>
                        <Text style={styles.orderText}>
                          Fecha y hora de recepcion: {formatDateTime(item.fecha_recepcion || item.fecha)}
                        </Text>
                        <Text style={styles.orderText}>
                          Problema: {item.problema || "Sin descripcion"}
                        </Text>
                      </TouchableOpacity>

                      {isExpanded ? (
                        <View style={styles.quoteFormCard}>
                          <Text style={styles.quoteFormTitle}>Responder cotizacion</Text>

                          {isMaintenance ? (
                            <View style={styles.returnBlock}>
                              <Text style={styles.orderText}>
                                Repuestos solicitados: {item.flujo_mantenimiento?.repuestos_solicitados?.length
                                  ? item.flujo_mantenimiento.repuestos_solicitados
                                      .map((repuesto) => `${repuesto.nombre || "Repuesto"} x${repuesto.cantidad || 0}`)
                                      .join(", ")
                                  : "Sin detalle"}
                              </Text>
                              {!isQuoted ? (
                                <>
                                  <TouchableOpacity
                                    style={[
                                      styles.addFormButton,
                                      hasUploadedExcel && styles.addFormButtonDisabled,
                                    ]}
                                    onPress={() => seleccionarDocumentoExcel(String(item.id))}
                                    disabled={hasUploadedExcel}
                                  >
                                    <MaterialCommunityIcons
                                      name="file-excel-outline"
                                      size={18}
                                      color={hasUploadedExcel ? "#94a3b8" : "#2563eb"}
                                    />
                                    <Text
                                      style={[
                                        styles.addFormButtonText,
                                        hasUploadedExcel && styles.addFormButtonTextDisabled,
                                      ]}
                                    >
                                      {hasUploadedExcel ? "Documento cargado" : "Cargar documento Excel"}
                                    </Text>
                                  </TouchableOpacity>

                                  {hasUploadedExcel ? (
                                    <TouchableOpacity
                                      style={styles.removeDocumentButton}
                                      onPress={() => eliminarDocumentoExcel(String(item.id))}
                                    >
                                      <MaterialCommunityIcons name="trash-can-outline" size={18} color="#be123c" />
                                      <Text style={styles.removeDocumentButtonText}>Eliminar documento</Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </>
                              ) : null}
                              <Text style={styles.orderText}>
                                Archivo: {excelDoc?.name || item.cotizacion?.documento_excel_nombre || "Sin documento cargado"}
                              </Text>
                            </View>
                          ) : null}

                          {!isMaintenance ? quoteForms.map((form, index) => (
                            <View key={`quote-form-${index}`} style={styles.extraFormBlock}>
                              <TextInput
                                style={styles.input}
                                value={form.marca}
                                onChangeText={(value) => actualizarCampo(index, "marca", value)}
                                placeholder="Marca"
                                placeholderTextColor="#94a3b8"
                                editable={!isQuoted}
                                maxLength={20}
                              />
                              <TextInput
                                style={styles.input}
                                value={form.referencia}
                                onChangeText={(value) => actualizarCampo(index, "referencia", value)}
                                placeholder="Referencia"
                                placeholderTextColor="#94a3b8"
                                editable={!isQuoted}
                                maxLength={20}
                              />
                              <TextInput
                                style={styles.input}
                                value={form.garantia}
                                onChangeText={(value) => actualizarCampo(index, "garantia", value)}
                                placeholder="Garantia"
                                placeholderTextColor="#94a3b8"
                                editable={!isQuoted}
                                maxLength={20}
                              />
                              <TextInput
                                style={styles.input}
                                value={form.disponibilidad}
                                onChangeText={(value) => actualizarCampo(index, "disponibilidad", value)}
                                placeholder="Disponibilidad"
                                placeholderTextColor="#94a3b8"
                                editable={!isQuoted}
                                maxLength={20}
                              />
                              <TextInput
                                style={styles.input}
                                value={form.precio}
                                onChangeText={(value) => actualizarCampo(index, "precio", value)}
                                placeholder="Precio"
                                placeholderTextColor="#94a3b8"
                                editable={!isQuoted}
                                keyboardType="numeric"
                                maxLength={20}
                              />
                              <TextInput
                                style={[styles.input, styles.textArea]}
                                value={form.observacion}
                                onChangeText={(value) => actualizarCampo(index, "observacion", value)}
                                placeholder="Observacion"
                                placeholderTextColor="#94a3b8"
                                multiline
                                editable={!isQuoted}
                                maxLength={100}
                              />
                            </View>
                          )) : null}

                          {!isQuoted && !isMaintenance ? (
                            <TouchableOpacity style={styles.addFormButton} onPress={agregarFormulario}>
                              <MaterialCommunityIcons name="plus" size={18} color="#2563eb" />
                              <Text style={styles.addFormButtonText}>Agregar otro formulario</Text>
                            </TouchableOpacity>
                          ) : null}

                          {!isQuoted ? (
                            <View style={styles.returnBlock}>
                              <TouchableOpacity
                                style={styles.returnToggleButton}
                                onPress={() =>
                                  setReturningQuoteId((current) =>
                                    current === String(item.id) ? null : String(item.id)
                                  )
                                }
                              >
                                <Text style={styles.returnToggleText}>Devolver con comentario</Text>
                              </TouchableOpacity>

                              {returningQuoteId === String(item.id) ? (
                                <View style={styles.returnCommentCard}>
                                  <TextInput
                                    style={[styles.input, styles.textArea]}
                                    value={returnComment}
                                    onChangeText={(value) => setReturnComment(value.slice(0, 100))}
                                    placeholder="Comentario para devolver"
                                    placeholderTextColor="#94a3b8"
                                    multiline
                                    maxLength={100}
                                  />
                                  <Text style={styles.helperCounter}>{returnComment.length}/100</Text>
                                  <TouchableOpacity
                                    style={styles.returnSubmitButton}
                                    onPress={() => devolverSolicitud(item.id)}
                                  >
                                    <Text style={styles.returnSubmitText}>Devolver al administrador</Text>
                                  </TouchableOpacity>
                                </View>
                              ) : null}
                            </View>
                          ) : null}

                          <View style={styles.formActions}>
                            <TouchableOpacity
                              style={styles.secondaryButton}
                              onPress={() => {
                                setExpandedQuoteId(null);
                                setQuoteForms([emptyForm()]);
                                setReturningQuoteId(null);
                                setReturnComment("");
                              }}
                            >
                              <Text style={styles.secondaryButtonText}>Cerrar</Text>
                            </TouchableOpacity>

                            {!isQuoted ? (
                              <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => enviarCotizacion(item.id)}
                              >
                                <Text style={styles.primaryButtonText}>Enviar</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <Text style={styles.panelText}>No hay cotizaciones enviadas por el administrador.</Text>
              )}
            </View>
          ) : null}

          {selectedSection === "Pedidos" ? (
            <View style={styles.panel}>
              <View style={styles.sectionToolbar}>
                <Text style={styles.sectionToolbarTitle}>Pedidos</Text>
                <TouchableOpacity style={styles.filterActionButton} onPress={() => setShowFilterModal(true)}>
                  <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
                </TouchableOpacity>
              </View>
              {filtrarSolicitudes(pedidos).length > 0 ? (
                filtrarSolicitudes(pedidos).map((item) => (
                  <View key={String(item.id)} style={styles.orderCard}>
                    {(() => {
                      const isWaitingClient = isWaitingClientStatus(item.estado);
                      const isRepairing = normalizeStatus(item.estado) === "en_reparacion";
                      const isMaintenance = esSolicitudMantenimientoTaller(
                        item.tipo_servicio,
                        item.flujo_mantenimiento
                      );
                      const commentValue = orderComments[String(item.id)] ?? item.respuesta_proveedor?.comentario ?? "";

                      return (
                        <>
                    <View style={styles.orderHeader}>
                      <Text style={styles.orderTitle}>{obtenerTituloSolicitud(item.tipo_servicio)}</Text>
                      <View style={[styles.statusPill, { backgroundColor: renderStatus(item.estado).backgroundColor, borderColor: renderStatus(item.estado).borderColor }]}>
                        <Text style={[styles.statusText, { color: renderStatus(item.estado).color }]}>
                          {renderStatus(item.estado).label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.orderText}>Cliente: {item.cliente?.nombre || "Cliente"}</Text>
                    <Text style={styles.orderText}>
                      Vehiculo: {item.vehiculo?.marca || ""} {item.vehiculo?.modelo || ""}
                    </Text>
                    <Text style={styles.orderText}>Solicitud #{getCaseNumber(item)}</Text>
                    <Text style={styles.orderText}>
                      Fecha y hora de recepcion: {formatDateTime(item.fecha_recepcion || item.fecha)}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.textArea, styles.orderCommentInput]}
                      value={commentValue}
                      onChangeText={(value) => actualizarComentarioPedido(String(item.id), value)}
                      placeholder="Mensaje para el cliente sobre esta orden"
                      placeholderTextColor="#94a3b8"
                      multiline
                      maxLength={300}
                      editable={!isWaitingClient && !isRepairing && !isFinishedStatus(item.estado)}
                    />
                    <Text style={styles.helperCounter}>
                      {commentValue.length}/300
                    </Text>
                    {isQuoteWorkflowService(item.tipo_servicio) ? (
                      <View style={styles.actionRow}>
                        {isApprovedStatus(item.estado) ? (
                          <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() =>
                              actualizarEstadoPedido(item.id, "espera_cliente", "El pedido fue recibido y notificado al cliente.")
                            }
                          >
                            <Text style={styles.primaryButtonText}>Recibido y notificado</Text>
                          </TouchableOpacity>
                        ) : null}
                        {isRepairing ? (
                          <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() =>
                              actualizarEstadoPedido(item.id, "finalizada", "El pedido fue finalizado.")
                            }
                          >
                            <Text style={styles.primaryButtonText}>Finalizar</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : isMaintenance ? (
                      <View style={styles.actionRow}>
                        {!item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado &&
                        !isFinishedStatus(item.estado) ? (
                          <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() =>
                              actualizarEstadoPedido(item.id, "repuestos_despachados", "El despacho de repuestos fue confirmado.")
                            }
                          >
                            <Text style={styles.primaryButtonText}>Confirmar despacho</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                        </>
                      );
                    })()}
                  </View>
                ))
              ) : (
                <Text style={styles.panelText}>No hay pedidos en proceso.</Text>
              )}
            </View>
          ) : null}

          {selectedSection === "Historial"
            ? (
              <View style={styles.panel}>
                <View style={styles.sectionToolbar}>
                  <Text style={styles.sectionToolbarTitle}>Historial</Text>
                  <TouchableOpacity style={styles.filterActionButton} onPress={() => setShowFilterModal(true)}>
                    <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
                  </TouchableOpacity>
                </View>
                {filtrarSolicitudes(entregas).length > 0 ? (
                  filtrarSolicitudes(entregas).map((item) => (
                    <View key={String(item.id)} style={styles.orderCard}>
                      <View style={styles.orderHeader}>
                        <Text style={styles.orderTitle}>Registro #{item.id}</Text>
                      <View
                        style={[
                          styles.statusPill,
                          {
                              backgroundColor: item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado
                                ? "#dcfce7"
                                : renderStatus(item.estado).backgroundColor,
                              borderColor: item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado
                                ? "#86efac"
                                : renderStatus(item.estado).borderColor,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusText,
                              {
                                color: item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado
                                  ? "#166534"
                                  : renderStatus(item.estado).color,
                              },
                            ]}
                          >
                            {item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado
                              ? "Finalizada"
                              : renderStatus(item.estado).label}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.orderText}>Cliente: {item.cliente?.nombre || "Cliente"}</Text>
                      <Text style={styles.orderText}>
                        Vehiculo: {item.vehiculo?.marca || ""} {item.vehiculo?.modelo || ""}
                      </Text>
                      {item.cotizacion?.precio ? (
                        <Text style={styles.orderText}>Precio cotizado: {formatCurrency(item.cotizacion.precio)}</Text>
                      ) : null}
                      {item.cotizacion?.observacion ? (
                        <Text style={styles.orderText}>Comentario: {item.cotizacion.observacion}</Text>
                      ) : null}
                    </View>
                  ))
                ) : (
                  <Text style={styles.panelText}>Aun no hay cotizaciones cerradas en el historial.</Text>
                )}
              </View>
            )
            : null}
          {selectedSection === "Configuracion"
            ? renderPlaceholder("Configuracion", "Aqui podras ajustar preferencias del proveedor.")
            : null}
        </View>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef3f9",
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  quickFilterOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    justifyContent: "center",
    padding: 20,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    backgroundColor: "rgba(8,18,31,0.32)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingCard: {
    minWidth: 220,
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 20,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  loadingText: {
    color: "#102447",
    fontWeight: "800",
    textAlign: "center",
  },
  quickFilterBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8,18,31,0.28)",
  },
  quickFilterCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    shadowColor: "#08121f",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  quickFilterTitle: {
    color: "#102447",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 12,
  },
  quickFilterLabel: {
    color: "#475569",
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 8,
  },
  quickFilterChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickFilterChip: {
    backgroundColor: "#eef3f9",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quickFilterChipActive: {
    backgroundColor: "#dbeafe",
  },
  quickFilterChipText: {
    color: "#425066",
    fontWeight: "700",
  },
  quickFilterChipTextActive: {
    color: "#1d4ed8",
  },
  quickFilterActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 16,
  },
  layout: {
    width: "100%",
  },
  main: {
    flex: 1,
    gap: 18,
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
  topRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
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
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#ff5b2e",
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    color: "#8fa1c2",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  brandTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  sideWelcome: {
    color: "#c2cbe0",
    marginBottom: 12,
  },
  sideItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sideItemActive: {
    backgroundColor: "#dfe9f7",
  },
  sideText: {
    color: "#c2cbe0",
    fontSize: 15,
    fontWeight: "600",
  },
  sideTextActive: {
    color: "#08121f",
    fontWeight: "800",
  },
  hero: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    padding: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  heroMobile: {
    padding: 20,
    gap: 16,
  },
  greeting: {
    color: "#7a8699",
    fontSize: 16,
    marginBottom: 6,
  },
  title: {
    color: "#08121f",
    fontSize: 32,
    fontWeight: "800",
  },
  subtitle: {
    color: "#5f6b7c",
    marginTop: 8,
    lineHeight: 22,
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
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  notificationsTitle: {
    color: "#08121f",
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
    color: "#08121f",
    fontWeight: "800",
    marginBottom: 4,
  },
  notificationItemText: {
    color: "#5f6b7c",
    lineHeight: 20,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    minWidth: 180,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  cardMobile: {
    width: "100%",
    minWidth: 0,
  },
  cardValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#08121f",
  },
  cardLabel: {
    color: "#6b778a",
    marginTop: 6,
  },
  panel: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "#dbe4f0",
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
    marginBottom: 14,
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
  sectionToolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionToolbarTitle: {
    color: "#102447",
    fontSize: 17,
    fontWeight: "800",
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
  panelTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#08121f",
    marginBottom: 10,
  },
  panelText: {
    color: "#5f6b7c",
    lineHeight: 22,
  },
  orderCard: {
    backgroundColor: "#ffffff",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e6edf6",
    marginTop: 12,
    shadowColor: "#08121f",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  orderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  orderTitle: {
    color: "#08121f",
    fontWeight: "800",
    fontSize: 16,
    flex: 1,
    flexShrink: 1,
    paddingRight: 8,
  },
  statusPill: {
    marginLeft: "auto",
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  statusPillPending: {
    backgroundColor: "#fff2e8",
  },
  statusPillSuccess: {
    backgroundColor: "#dcfce7",
  },
  statusPillReturned: {
    backgroundColor: "#fee2e2",
  },
  statusText: {
    fontWeight: "800",
    fontSize: 12,
  },
  statusTextPending: {
    color: "#ff8a3d",
  },
  statusTextSuccess: {
    color: "#15803d",
  },
  statusTextReturned: {
    color: "#b91c1c",
  },
  orderText: {
    color: "#425066",
    marginTop: 4,
    fontWeight: "600",
  },
  orderCommentInput: {
    marginTop: 12,
    marginBottom: 0,
  },
  quoteFormCard: {
    marginTop: 16,
    gap: 10,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  quoteFormTitle: {
    color: "#08121f",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe4f0",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#08121f",
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  extraFormBlock: {
    gap: 10,
    marginBottom: 4,
  },
  addFormButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    backgroundColor: "#eef4ff",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#d7e4fb",
  },
  addFormButtonText: {
    color: "#2563eb",
    fontWeight: "800",
  },
  addFormButtonDisabled: {
    backgroundColor: "#f1f5f9",
    borderColor: "#e2e8f0",
  },
  addFormButtonTextDisabled: {
    color: "#94a3b8",
  },
  returnBlock: {
    marginTop: 6,
    gap: 10,
  },
  removeDocumentButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    backgroundColor: "#fff1f2",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#fecdd3",
  },
  removeDocumentButtonText: {
    color: "#be123c",
    fontWeight: "800",
  },
  returnToggleButton: {
    alignSelf: "flex-start",
    backgroundColor: "#fff1f2",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#fecdd3",
  },
  returnToggleText: {
    color: "#be123c",
    fontWeight: "800",
  },
  returnCommentCard: {
    backgroundColor: "#fff8f8",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 16,
    padding: 12,
  },
  helperCounter: {
    color: "#64748b",
    fontSize: 12,
    textAlign: "right",
    marginTop: 6,
  },
  returnSubmitButton: {
    marginTop: 10,
    backgroundColor: "#dc2626",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  returnSubmitText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  secondaryButton: {
    backgroundColor: "#eef2f7",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#475569",
    fontWeight: "800",
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
});
