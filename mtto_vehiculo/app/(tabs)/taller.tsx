import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE_URL } from "../../constants/api";
import { formatDateTime } from "../../constants/formatters";
import {
  getStatusTone,
  isFinishedStatus,
  isInProcessStatus,
  isRejectedWorkshopStatus,
  normalizeStatus,
} from "../../constants/request-status";
import storage from "../../constants/storage";

type Solicitud = {
  id?: number | string;
  numero_caso?: number | string | null;
  solicitud_origen_id?: number | string | null;
  vehiculo?: { marca?: string; modelo?: string; placa?: string };
  cliente?: { nombre?: string };
  tipo_servicio?: string;
  problema?: string;
  estado?: string;
  observacion?: string | null;
  disponibilidad_cliente?: string | null;
  fecha?: string | null;
  respuesta_taller?: {
    comentario?: string | null;
    fecha_disponible?: string | null;
    horario_disponible?: string | null;
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
};

type Notificacion = {
  id?: number | string;
  titulo?: string;
  mensaje?: string;
  leida?: boolean;
};

type DiagnosticFormState = {
  diagnostico: string;
  servicios: string;
  horas: string;
  materiales: string;
  repuestos: { nombre: string; cantidad: string }[];
};

const sections = [
  { label: "Vista general", icon: "view-dashboard-outline" },
  { label: "Solicitudes recibidas", icon: "inbox-arrow-down-outline" },
  { label: "Diagnostico", icon: "stethoscope" },
  { label: "Intervencion", icon: "tools" },
  { label: "Materiales / Repuestos", icon: "package-variant-closed" },
  { label: "Entrega / Informe", icon: "clipboard-text-outline" },
  { label: "Historial", icon: "history" },
] as const;

const priorities = {
  alta: { bg: "#fee2e2", border: "#fecaca", text: "#b91c1c" },
  media: { bg: "#fef3c7", border: "#fde68a", text: "#b45309" },
  baja: { bg: "#dcfce7", border: "#86efac", text: "#15803d" },
};

const getToken = async () => {
  const browserToken = globalThis.localStorage?.getItem("token");
  if (browserToken) return browserToken;
  return storage.getItem("token");
};

const getVehicleName = (item: Solicitud) =>
  [item.vehiculo?.marca, item.vehiculo?.modelo].filter(Boolean).join(" ") || "Vehiculo sin nombre";

const getCaseNumber = (item: Solicitud) => item.numero_caso ?? item.solicitud_origen_id ?? item.id;

const hasClientApprovedFlow = (item: Solicitud) =>
  Boolean(item.flujo_mantenimiento?.timeline?.cliente_aprueba_propuesta_en) ||
  ["aprobada", "repuestos_despachados", "intervencion_iniciada", "repuestos_recibidos_taller", "en_proceso", "en_reparacion", "finalizada"].includes(
    normalizeStatus(item.estado)
  );

const hasWorkshopDiagnosticSummary = (item: Solicitud) =>
  Boolean(
    item.taller_diagnostico?.diagnostico ||
    item.taller_diagnostico?.servicios ||
    item.taller_diagnostico?.horas ||
    item.taller_diagnostico?.materiales
  );

const isWorkshopFinalized = (item: Solicitud) =>
  Boolean(item.flujo_mantenimiento?.confirmaciones?.taller_reparacion_finalizada);

const getWorkshopPriority = (item: Solicitud) => {
  const state = normalizeStatus(item.estado);

  if (isFinishedStatus(state)) return 700;
  if (isInProcessStatus(state)) return 600;
  if (["aprobada", "repuestos_despachados"].includes(state)) return 500;
  if (["diagnosticada", "pendiente_envio_cliente_taller", "espera_cliente"].includes(state)) return 400;
  if (state === "en_diagnostico") return 300;
  if (state === "en_asignacion_taller") return 200;
  return 100;
};

const dedupeWorkshopRequests = (items: Solicitud[]) => {
  const grouped = new Map<string, Solicitud[]>();

  items.forEach((item) => {
    const key = String(getCaseNumber(item) ?? item.id ?? "");
    const current = grouped.get(key) || [];
    current.push(item);
    grouped.set(key, current);
  });

  return Array.from(grouped.values()).map((group) =>
    [...group].sort((left, right) => {
      const priorityDiff = getWorkshopPriority(right) - getWorkshopPriority(left);
      if (priorityDiff !== 0) return priorityDiff;
      return Number(right.id || 0) - Number(left.id || 0);
    })[0]
  );
};

const getRequestTitle = (tipoServicio?: string) => {
  const value = (tipoServicio || "").toLowerCase();
  if (
    value.includes(",") ||
    value.includes(":") ||
    value.includes("mantenimiento") ||
    value.includes("diagnostico")
  ) {
    return tipoServicio || "Solicitud de mantenimiento";
  }
  if (value.includes("llanta")) return "Solicitud de llantas";
  if (value.includes("bateria")) return "Solicitud de bateria";
  if (value.includes("aceite") || value.includes("filtro")) return "Solicitud de aceite";
  return tipoServicio || "Solicitud de mantenimiento";
};

const getPriority = (item: Solicitud): keyof typeof priorities => {
  const service = (item.tipo_servicio || "").toLowerCase();
  const problem = (item.problema || "").toLowerCase();
  if (service.includes("freno") || service.includes("motor") || problem.includes("seguridad")) return "alta";
  if (service.includes("bateria") || service.includes("llanta") || service.includes("aceite")) return "media";
  return "baja";
};

const extractOrderId = (item: Notificacion) => {
  const match = `${item.titulo || ""} ${item.mensaje || ""}`.match(/#(\d+)/);
  return match?.[1] || null;
};

type PickerModalState = {
  requestId: string;
  field: "fechaDisponible" | "horarioDisponible";
} | null;

const formatDateFieldLabel = (value: string) => {
  if (!value) return "Seleccionar fecha";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatTimeFieldLabel = (value: string) => {
  if (!value) return "Seleccionar hora";
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  const formatHourRange = (hour: number) => {
    const normalizedHour = ((hour % 24) + 24) % 24;
    const period = normalizedHour < 12 ? "am" : "pm";
    const displayHour = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
    return { displayHour, period };
  };

  const start = formatHourRange(hours);
  const end = formatHourRange(hours + 2);
  const samePeriod = start.period === end.period;

  return samePeriod
    ? `${start.displayHour}-${end.displayHour} ${start.period}`
    : `${start.displayHour} ${start.period}-${end.displayHour} ${end.period}`;
};

const formatWorkshopDateLabel = (value?: string | null) => {
  if (!value) return "Sin fecha";
  return formatDateFieldLabel(value);
};

const formatWorkshopTimeLabel = (value?: string | null) => {
  if (!value) return "Sin horario";
  return formatTimeFieldLabel(value);
};

export default function TallerDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 960;
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [tallerName, setTallerName] = useState("Taller");
  const [selectedSection, setSelectedSection] = useState("Vista general");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedVehicleFilter, setSelectedVehicleFilter] = useState("Todos");
  const [selectedDateFilter, setSelectedDateFilter] = useState("Todas");
  const [actionLoadingMessage, setActionLoadingMessage] = useState<string | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [openQuoteFormId, setOpenQuoteFormId] = useState<string | null>(null);
  const [pickerModal, setPickerModal] = useState<PickerModalState>(null);
  const [quoteForms, setQuoteForms] = useState<
    Record<string, { comentarioCliente: string; comentarioAdmin: string; fechaDisponible: string; horarioDisponible: string }>
  >({});
  const [openDiagnosticFormId, setOpenDiagnosticFormId] = useState<string | null>(null);
  const [diagnosticForms, setDiagnosticForms] = useState<Record<string, DiagnosticFormState>>({});

  useEffect(() => {
    cargarDashboard();
  }, []);

  useFocusEffect(
    useCallback(() => {
      cargarDashboard();

      const interval = setInterval(() => {
        cargarDashboard();
      }, 8000);

      return () => clearInterval(interval);
    }, [])
  );

  const cargarDashboard = async () => {
    await Promise.all([cargarSolicitudes(), cargarNotificaciones()]);
  };

  const cargarSolicitudes = async () => {
    try {
      const storedName = await storage.getItem("user_name");
      const token = await getToken();

      if (storedName) setTallerName(storedName);

      const response = await fetch(`${API_BASE_URL}/solicitudes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (Array.isArray(data)) setSolicitudes(data);
      else if (Array.isArray(data?.solicitudes)) setSolicitudes(data.solicitudes);
      else setSolicitudes([]);
    } catch (error) {
      console.log("error cargando solicitudes taller", error);
      setSolicitudes([]);
    }
  };

  const cargarNotificaciones = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/notificaciones`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      setNotificaciones(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log("error cargando notificaciones taller", error);
      setNotificaciones([]);
    }
  };

  const cerrarSesion = async () => {
    try {
      await storage.removeItem("token");
      await storage.removeItem("user_name");
      await storage.removeItem("user_role");
    } catch (error) {
      console.log("logout storage fallback", error);
    }

    globalThis.localStorage?.removeItem("token");
    globalThis.localStorage?.removeItem("user_name");
    globalThis.localStorage?.removeItem("user_role");

    if (Platform.OS === "web") {
      window.location.href = "/";
      return;
    }
    router.replace("/");
  };

  const actualizarEstadoSolicitud = async (
    solicitudId: string,
    estado: string,
    successMessage: string,
    comentario?: string
  ) => {
    try {
      setActionLoadingMessage("Actualizando solicitud...");
      const token = await getToken();
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
        Alert.alert("Error", data.detail || "No se pudo actualizar la solicitud");
        return;
      }

      await cargarSolicitudes();
      Alert.alert("Actualizado", successMessage);
    } catch (error) {
      console.log("error actualizando solicitud taller", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    } finally {
      setActionLoadingMessage(null);
    }
  };

  const actualizarCampoCotizacion = (
    solicitudId: string,
    field: "comentarioCliente" | "comentarioAdmin" | "fechaDisponible" | "horarioDisponible",
    value: string
  ) => {
    setQuoteForms((current) => ({
      ...current,
      [solicitudId]: {
        comentarioCliente: current[solicitudId]?.comentarioCliente || "",
        comentarioAdmin: current[solicitudId]?.comentarioAdmin || "",
        fechaDisponible: current[solicitudId]?.fechaDisponible || "",
        horarioDisponible: current[solicitudId]?.horarioDisponible || "",
        [field]: value,
      },
    }));
  };

  const abrirFormularioCotizacion = (item: Solicitud) => {
    const solicitudId = String(item.id ?? "");
    setOpenQuoteFormId((current) => (current === solicitudId ? null : solicitudId));
    setExpandedRequestId(solicitudId);
    setQuoteForms((current) => ({
      ...current,
      [solicitudId]: current[solicitudId] || {
        comentarioCliente: item.respuesta_taller?.comentario || "",
        comentarioAdmin: item.observacion || "",
        fechaDisponible: item.respuesta_taller?.fecha_disponible || "",
        horarioDisponible: item.respuesta_taller?.horario_disponible || "",
      },
    }));
  };

  const abrirFormularioDiagnostico = (item: Solicitud) => {
    const solicitudId = String(item.id ?? "");
    setOpenDiagnosticFormId((current) => (current === solicitudId ? null : solicitudId));
    setExpandedRequestId(solicitudId);
    setDiagnosticForms((current) => ({
      ...current,
      [solicitudId]: current[solicitudId] || {
        diagnostico: item.taller_diagnostico?.diagnostico || "",
        servicios: item.taller_diagnostico?.servicios || item.tipo_servicio || "",
        horas: item.taller_diagnostico?.horas || "",
        materiales: item.taller_diagnostico?.materiales || "",
        repuestos:
          item.flujo_mantenimiento?.repuestos_solicitados?.length
            ? item.flujo_mantenimiento.repuestos_solicitados.map((repuesto) => ({
                nombre: repuesto.nombre || "",
                cantidad: String(repuesto.cantidad || ""),
              }))
            : [{ nombre: "", cantidad: "1" }],
      },
    }));
  };

  const actualizarCampoDiagnostico = (
    solicitudId: string,
    field: "diagnostico" | "servicios" | "horas" | "materiales",
    value: string
  ) => {
    setDiagnosticForms((current) => ({
      ...current,
      [solicitudId]: {
        ...(current[solicitudId] || {
          diagnostico: "",
          servicios: "",
          horas: "",
          materiales: "",
          repuestos: [{ nombre: "", cantidad: "1" }],
        }),
        [field]: value,
      },
    }));
  };

  const actualizarRepuestoDiagnostico = (
    solicitudId: string,
    index: number,
    field: "nombre" | "cantidad",
    value: string
  ) => {
    setDiagnosticForms((current) => {
      const form = current[solicitudId] || {
        diagnostico: "",
        servicios: "",
        horas: "",
        materiales: "",
        repuestos: [{ nombre: "", cantidad: "1" }],
      };

      return {
        ...current,
        [solicitudId]: {
          ...form,
          repuestos: form.repuestos.map((item, itemIndex) =>
            itemIndex === index
              ? { ...item, [field]: field === "cantidad" ? value.replace(/\D/g, "").slice(0, 3) : value.slice(0, 120) }
              : item
          ),
        },
      };
    });
  };

  const agregarRepuestoDiagnostico = (solicitudId: string) => {
    setDiagnosticForms((current) => ({
      ...current,
      [solicitudId]: {
        ...(current[solicitudId] || {
          diagnostico: "",
          servicios: "",
          horas: "",
          materiales: "",
          repuestos: [],
        }),
        repuestos: [...(current[solicitudId]?.repuestos || []), { nombre: "", cantidad: "1" }],
      },
    }));
  };

  const enviarDiagnostico = async (item: Solicitud) => {
    const solicitudId = String(item.id ?? "");
    const form = diagnosticForms[solicitudId];

    if (!form?.diagnostico.trim() || !form?.servicios.trim() || !form?.horas.trim()) {
      Alert.alert("Campos requeridos", "Debes completar diagnostico, servicios y horas estimadas.");
      return;
    }

    const repuestos = (form.repuestos || [])
      .filter((repuesto) => String(repuesto.nombre || "").trim().length > 0)
      .map((repuesto) => ({
        nombre: String(repuesto.nombre || "").trim(),
        cantidad: Math.max(1, Number(repuesto.cantidad || "1")),
      }));

    try {
      setActionLoadingMessage("Enviando diagnostico...");
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/diagnostico-taller`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          diagnostico: form.diagnostico.trim(),
          servicios: form.servicios.trim(),
          horas: form.horas.trim(),
          materiales: form.materiales.trim(),
          repuestos,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo enviar el diagnostico");
        return;
      }

      setOpenDiagnosticFormId(null);
      await cargarSolicitudes();
      Alert.alert("Enviado", "El diagnostico y los repuestos solicitados fueron enviados al administrador.");
    } catch (error) {
      console.log("error enviando diagnostico taller", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    } finally {
      setActionLoadingMessage(null);
    }
  };

  const aprobarSolicitudTaller = async (item: Solicitud) => {
    const solicitudId = String(item.id ?? "");
    const form = quoteForms[solicitudId] || {
      comentarioCliente: "",
      comentarioAdmin: "",
      fechaDisponible: "",
      horarioDisponible: "",
    };

    if (!form.comentarioCliente.trim() || !form.fechaDisponible.trim() || !form.horarioDisponible.trim()) {
      Alert.alert("Campos requeridos", "Debes completar comentario, fecha y horario disponible.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fechaDisponible.trim())) {
      Alert.alert("Fecha invalida", "La fecha debe ir en formato YYYY-MM-DD.");
      return;
    }

    try {
      setActionLoadingMessage("Confirmando disponibilidad...");
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/respuesta-taller`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          comentario: form.comentarioCliente.trim(),
          fecha_disponible: form.fechaDisponible.trim(),
          horario_disponible: form.horarioDisponible.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo confirmar la disponibilidad del taller");
        return;
      }

      setOpenQuoteFormId(null);
      await cargarSolicitudes();
      Alert.alert("Disponibilidad enviada", "La informacion fue enviada al cliente y el administrador fue notificado.");
    } catch (error) {
      console.log("error enviando respuesta taller", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    } finally {
      setActionLoadingMessage(null);
    }
  };

  const abrirDesdeNotificacion = async (item: Notificacion) => {
    try {
      const token = await getToken();
      await fetch(`${API_BASE_URL}/notificaciones/${item.id}/leer`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.log("error marcando notificacion taller", error);
    }

    const solicitudId = extractOrderId(item);
    setHighlightedOrderId(solicitudId);
    setExpandedRequestId(solicitudId);
    setSelectedSection("Solicitudes recibidas");
    setShowNotifications(false);
    setNotificaciones((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, leida: true } : notification
      )
    );
  };

  const workshopRequests = useMemo(
    () =>
      solicitudes.filter((item) => {
        const state = normalizeStatus(item.estado);
        return !["cotizando", "cotizado", "devuelta", "devuelto_proveedor", "omitida_admin", "archivada", "enviado_cliente", "enviada_cliente"].includes(state);
      }),
    [solicitudes]
  );

  const requestsReceived = useMemo(
    () => dedupeWorkshopRequests(workshopRequests.filter((item) => normalizeStatus(item.estado) === "en_asignacion_taller")),
    [workshopRequests]
  );
  const diagnosticRequests = useMemo(
    () => dedupeWorkshopRequests(workshopRequests.filter((item) => normalizeStatus(item.estado) === "en_diagnostico")),
    [workshopRequests]
  );
  const waitingAdminRequests = useMemo(
    () =>
      dedupeWorkshopRequests(
        workshopRequests.filter((item) =>
          (
            ["diagnosticada", "pendiente_envio_cliente_taller", "espera_cliente", "en_cotizacion", "cotizando", "cotizada", "propuesta_armada", "enviada_cliente"].includes(normalizeStatus(item.estado)) ||
            hasWorkshopDiagnosticSummary(item)
          ) &&
          !hasClientApprovedFlow(item)
        )
      ),
    [workshopRequests]
  );
  const approvedRequests = useMemo(
    () =>
      dedupeWorkshopRequests(
        workshopRequests.filter((item) =>
          hasClientApprovedFlow(item) &&
          ["aprobada", "repuestos_despachados"].includes(normalizeStatus(item.estado))
        )
      ),
    [workshopRequests]
  );
  const inProgressRequests = useMemo(
    () =>
      dedupeWorkshopRequests(
        workshopRequests.filter((item) =>
          !isWorkshopFinalized(item) &&
          ["intervencion_iniciada", "repuestos_recibidos_taller", "en_proceso", "en_reparacion"].includes(
            normalizeStatus(item.estado)
          )
        )
      ),
    [workshopRequests]
  );
  const finishedRequests = useMemo(
    () =>
      dedupeWorkshopRequests(
        workshopRequests.filter((item) => isFinishedStatus(item.estado) || isWorkshopFinalized(item))
      ),
    [workshopRequests]
  );
  const returnedRequests = useMemo(
    () => dedupeWorkshopRequests(workshopRequests.filter((item) => isRejectedWorkshopStatus(item.estado))),
    [workshopRequests]
  );
  const delayedRequests = useMemo(
    () =>
      workshopRequests.filter((item) => {
        if (!item.fecha) return false;
        const created = new Date(item.fecha).getTime();
        if (Number.isNaN(created)) return false;
        return Date.now() - created > 1000 * 60 * 60 * 48 && !isFinishedStatus(item.estado);
      }),
    [workshopRequests]
  );

  const unreadNotifications = notificaciones.filter((item) => !item.leida).length;
  const workshopVehicleFilters = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set(
          solicitudes
            .map((item) => getVehicleName(item))
            .filter((item) => item && item !== "Vehiculo sin nombre")
        )
      ),
    ],
    [solicitudes]
  );
  const workshopDateFilters = ["Todas", "Hoy", "Ultimos 7 dias", "Sin fecha"];
  const kpis = [
    { label: "Solicitudes nuevas", value: requestsReceived.length, color: "#2563eb" },
    { label: "En diagnostico", value: diagnosticRequests.length, color: "#f97316" },
    { label: "En reparacion", value: inProgressRequests.length, color: "#16a34a" },
    { label: "Pendientes admin", value: waitingAdminRequests.length, color: "#7c3aed" },
    { label: "Finalizadas", value: finishedRequests.length, color: "#0f766e" },
  ];

  const matchesQuickFilters = useCallback(
    (item: Solicitud) => {
      const vehicleMatch =
        selectedVehicleFilter === "Todos" || getVehicleName(item) === selectedVehicleFilter;

      const rawDate = item.fecha;
      const parsedDate = rawDate ? new Date(rawDate) : null;
      const hasDate = parsedDate != null && !Number.isNaN(parsedDate.getTime());
      const now = new Date();
      const diffMs = hasDate ? now.getTime() - parsedDate.getTime() : null;
      const dayMs = 1000 * 60 * 60 * 24;

      const dateMatch =
        selectedDateFilter === "Todas" ||
        (selectedDateFilter === "Sin fecha" && !hasDate) ||
        (selectedDateFilter === "Hoy" &&
          hasDate &&
          parsedDate!.toDateString() === now.toDateString()) ||
        (selectedDateFilter === "Ultimos 7 dias" &&
          hasDate &&
          diffMs != null &&
          diffMs <= dayMs * 7);

      return vehicleMatch && dateMatch;
    },
    [selectedDateFilter, selectedVehicleFilter]
  );

  const filtrarSolicitudes = useCallback(
    (items: Solicitud[]) => items.filter((item) => matchesQuickFilters(item)),
    [matchesQuickFilters]
  );

  const mobileDateOptions = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 30 }, (_, index) => {
      const current = new Date(today);
      current.setDate(today.getDate() + index);
      const value = current.toISOString().slice(0, 10);
      return { value, label: formatDateFieldLabel(value) };
    });
  }, []);

  const mobileTimeOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (let hour = 6; hour <= 18; hour += 2) {
      const value = `${String(hour).padStart(2, "0")}:00`;
      options.push({ value, label: formatTimeFieldLabel(value) });
    }
    return options;
  }, []);

  const renderQuickFilterModal = () =>
    showFilterModal ? (
      <View style={styles.quickFilterOverlay} pointerEvents="box-none">
        <Pressable style={styles.quickFilterBackdrop} onPress={() => setShowFilterModal(false)} />
        <View style={styles.quickFilterCard}>
          <Text style={styles.quickFilterTitle}>Filtros rapidos</Text>
          <Text style={styles.quickFilterLabel}>Vehiculo</Text>
          <View style={styles.quickFilterChipWrap}>
            {workshopVehicleFilters.map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.quickFilterChip,
                  selectedVehicleFilter === filter && styles.quickFilterChipActive,
                ]}
                onPress={() => setSelectedVehicleFilter(filter)}
              >
                <Text
                  style={[
                    styles.quickFilterChipText,
                    selectedVehicleFilter === filter && styles.quickFilterChipTextActive,
                  ]}
                >
                  {filter}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.quickFilterLabel}>Fecha</Text>
          <View style={styles.quickFilterChipWrap}>
            {workshopDateFilters.map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.quickFilterChip,
                  selectedDateFilter === filter && styles.quickFilterChipActive,
                ]}
                onPress={() => setSelectedDateFilter(filter)}
              >
                <Text
                  style={[
                    styles.quickFilterChipText,
                    selectedDateFilter === filter && styles.quickFilterChipTextActive,
                  ]}
                >
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

  const renderSchedulePickerModal = () => {
    if (!pickerModal || Platform.OS === "web") return null;

    const options = pickerModal.field === "fechaDisponible" ? mobileDateOptions : mobileTimeOptions;
    const selectedValue = quoteForms[pickerModal.requestId]?.[pickerModal.field] || "";
    const title = pickerModal.field === "fechaDisponible" ? "Seleccionar fecha disponible" : "Seleccionar horario disponible";

    return (
      <View style={styles.quickFilterOverlay} pointerEvents="box-none">
        <Pressable style={styles.quickFilterBackdrop} onPress={() => setPickerModal(null)} />
        <View style={styles.pickerModalCard}>
          <Text style={styles.quickFilterTitle}>{title}</Text>
          <ScrollView style={styles.pickerScrollArea} showsVerticalScrollIndicator={false}>
            <View style={styles.pickerOptionList}>
              {options.map((option) => {
                const active = selectedValue === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.pickerOptionButton, active && styles.pickerOptionButtonActive]}
                    onPress={() => {
                      actualizarCampoCotizacion(pickerModal.requestId, pickerModal.field, option.value);
                      setPickerModal(null);
                    }}
                  >
                    <Text style={[styles.pickerOptionText, active && styles.pickerOptionTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.quickFilterActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setPickerModal(null)}>
              <Text style={styles.secondaryButtonText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderRequestCard = (
    item: Solicitud,
    options?: {
      showQuote?: boolean;
      showReturn?: boolean;
      showDiagnosticSend?: boolean;
      showStart?: boolean;
      showReceiveParts?: boolean;
      showFinish?: boolean;
      showInfo?: boolean;
    }
  ) => {
    const id = String(item.id ?? "");
    const isExpanded = expandedRequestId === id;
    const isHighlighted = highlightedOrderId === id;
    const priority = priorities[getPriority(item)];
    const isQuoteFormOpen = openQuoteFormId === id;
    const isDiagnosticFormOpen = openDiagnosticFormId === id;
    const hasWorkshopAvailability = Boolean(
      item.respuesta_taller?.fecha_disponible ||
      item.respuesta_taller?.horario_disponible ||
      item.respuesta_taller?.comentario
    );
    const quoteForm = quoteForms[id] || {
      comentarioCliente: item.respuesta_taller?.comentario || "",
      comentarioAdmin: item.observacion || "",
      fechaDisponible: item.respuesta_taller?.fecha_disponible || "",
      horarioDisponible: item.respuesta_taller?.horario_disponible || "",
    };
    const diagnosticForm = diagnosticForms[id] || {
      diagnostico: item.taller_diagnostico?.diagnostico || "",
      servicios: item.taller_diagnostico?.servicios || item.tipo_servicio || "",
      horas: item.taller_diagnostico?.horas || "",
      materiales: item.taller_diagnostico?.materiales || "",
      repuestos: [{ nombre: "", cantidad: "1" }],
    };
    const statusTone = isWorkshopFinalized(item) && !isFinishedStatus(item.estado)
      ? {
          label: "Finalizado por taller",
          backgroundColor: "#dcfce7",
          borderColor: "#86efac",
          color: "#166534",
        }
      : getStatusTone(item.estado);
    const trackingSteps = [
      {
        label: "Proveedor despacho repuestos",
        completed: Boolean(item.flujo_mantenimiento?.confirmaciones?.proveedor_despacho_confirmado),
      },
      {
        label: "Taller inicio intervencion",
        completed: Boolean(item.flujo_mantenimiento?.confirmaciones?.taller_inicio_intervencion_confirmado),
      },
      {
        label: "Taller recibio repuestos",
        completed: Boolean(item.flujo_mantenimiento?.confirmaciones?.taller_recibe_repuestos_confirmado),
      },
      {
        label: "Reparacion final",
        completed: Boolean(item.flujo_mantenimiento?.confirmaciones?.taller_reparacion_finalizada),
      },
    ];

    return (
      <TouchableOpacity
        key={id}
        style={[styles.requestCard, isHighlighted && styles.highlightedCard]}
        activeOpacity={0.92}
        onPress={() => setExpandedRequestId((current) => (current === id ? null : id))}
      >
        <View style={styles.requestHeader}>
          <View style={styles.requestHeaderMain}>
            <Text style={styles.requestTitle}>{getRequestTitle(item.tipo_servicio)}</Text>
            <Text style={styles.requestSubtitle}>{getVehicleName(item)}{item.vehiculo?.placa ? ` • ${item.vehiculo.placa}` : ""}</Text>
          </View>
          <View style={[styles.statePill, { backgroundColor: statusTone.backgroundColor, borderColor: statusTone.borderColor }]}>
            <Text style={[styles.statePillText, { color: statusTone.color }]}>{statusTone.label}</Text>
          </View>
        </View>

        <View style={styles.requestMetaList}>
          <View style={styles.requestMetaRow}>
            <MaterialCommunityIcons name="account-outline" size={16} color="#6b7280" />
            <Text style={styles.metaText}>Cliente: {item.cliente?.nombre || "Sin nombre"}</Text>
          </View>
          <View style={styles.requestMetaRow}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={16} color="#6b7280" />
            <Text style={styles.metaText}>{formatDateTime(item.fecha)}</Text>
          </View>
          <View style={styles.requestMetaRow}>
            <MaterialCommunityIcons name="tools" size={16} color="#6b7280" />
            <Text style={styles.metaText}>Problema: {item.problema || "Sin descripcion"}</Text>
          </View>
        </View>

        <View style={[styles.priorityPill, { backgroundColor: priority.bg, borderColor: priority.border }]}>
          <Text style={[styles.priorityText, { color: priority.text }]}>Prioridad {getPriority(item)}</Text>
        </View>

        <Text style={styles.expandHint}>{isExpanded ? "Toca para ocultar detalle" : "Toca para ver detalle"}</Text>

        {isExpanded ? (
          <View style={styles.expandedBlock}>
            <Text style={styles.expandedText}>Placa: {item.vehiculo?.placa || "Sin placa"}</Text>
            <Text style={styles.expandedText}>Servicio: {item.tipo_servicio || "Sin servicio"}</Text>
            <Text style={styles.expandedText}>Recepcion en taller: {formatDateTime(item.fecha)}</Text>
            <Text style={styles.expandedText}>Disponibilidad del cliente: {item.disponibilidad_cliente || "Sin registrar"}</Text>
            {options?.showInfo && !hasWorkshopAvailability ? (
              <View style={styles.infoBanner}>
                <MaterialCommunityIcons name="information-outline" size={18} color="#2563eb" />
                <Text style={styles.infoBannerText}>
                  {options?.showDiagnosticSend
                    ? "Despues de que el cliente confirme la llegada al taller, registra el diagnostico y los repuestos requeridos."
                    : "Aprueba o rechaza la solicitud. Si la apruebas, registras fecha, horario y comentario para que el cliente confirme su llegada al taller."}
                </Text>
              </View>
            ) : null}
            {hasWorkshopAvailability ? (
              <View style={styles.sentAvailabilityCard}>
                <Text style={styles.sentAvailabilityTitle}>Disponibilidad enviada al cliente</Text>
                <Text style={styles.expandedText}>
                  Fecha disponible: {formatWorkshopDateLabel(item.respuesta_taller?.fecha_disponible)}
                </Text>
                <Text style={styles.expandedText}>
                  Horario disponible: {formatWorkshopTimeLabel(item.respuesta_taller?.horario_disponible)}
                </Text>
                <Text style={styles.expandedText}>
                  Comentario enviado: {item.respuesta_taller?.comentario || "Sin comentario"}
                </Text>
              </View>
            ) : null}
            {hasWorkshopDiagnosticSummary(item) ? (
              <View style={styles.sentAvailabilityCard}>
                <Text style={styles.sentAvailabilityTitle}>Diagnostico del taller</Text>
                <Text style={styles.expandedText}>
                  Diagnostico: {item.taller_diagnostico?.diagnostico || "Sin diagnostico"}
                </Text>
                <Text style={styles.expandedText}>
                  Servicios: {item.taller_diagnostico?.servicios || "Sin servicios"}
                </Text>
                <Text style={styles.expandedText}>
                  Horas estimadas: {item.taller_diagnostico?.horas || "Sin horas"}
                </Text>
                <Text style={styles.expandedText}>
                  Repuestos solicitados: {item.taller_diagnostico?.materiales || "Sin materiales"}
                </Text>
              </View>
            ) : null}
            <View style={styles.actionRow}>
              {options?.showQuote ? (
                <TouchableOpacity
                  style={[styles.primaryButton, styles.inlineActionButton]}
                  onPress={() => abrirFormularioCotizacion(item)}
                >
                  <Text style={styles.primaryButtonText}>
                    {isQuoteFormOpen ? "Ocultar formulario" : "Aprobar servicio"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {options?.showReturn && !isQuoteFormOpen ? (
                <View style={styles.returnBlock}>
                  <TextInput
                    style={[styles.quoteInput, styles.quoteInputMultiline]}
                    value={quoteForm.comentarioAdmin}
                    onChangeText={(value) => actualizarCampoCotizacion(id, "comentarioAdmin", value)}
                    placeholder="Comentario para devolver al administrador"
                    placeholderTextColor="#94a3b8"
                    multiline
                    maxLength={200}
                  />
                  <Text style={styles.commentCounter}>{quoteForm.comentarioAdmin.length}/200</Text>
                  <TouchableOpacity
                    style={[styles.dangerButton, styles.inlineActionButton]}
                    onPress={() => {
                      const comentario = quoteForm.comentarioAdmin.trim();
                      if (!comentario) {
                        Alert.alert("Comentario requerido", "Debes escribir un comentario para devolver la solicitud.");
                        return;
                      }
                      actualizarEstadoSolicitud(
                        id,
                        "rechazada_taller",
                        "La solicitud fue devuelta al administrador.",
                        comentario
                      );
                    }}
                  >
                    <Text style={styles.dangerButtonText}>Rechazar servicio</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {options?.showStart ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => actualizarEstadoSolicitud(id, "intervencion_iniciada", "La intervencion fue iniciada.")}
                >
                  <Text style={styles.primaryButtonText}>Iniciar intervencion</Text>
                </TouchableOpacity>
              ) : null}
              {options?.showReceiveParts ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => actualizarEstadoSolicitud(id, "repuestos_recibidos_taller", "Los repuestos fueron recibidos por el taller.")}
                >
                  <Text style={styles.secondaryButtonText}>Recibir repuestos</Text>
                </TouchableOpacity>
              ) : null}
              {options?.showFinish ? (
                <TouchableOpacity
                  style={styles.successButton}
                  onPress={() => actualizarEstadoSolicitud(id, "finalizada", "La orden fue finalizada.")}
                >
                  <Text style={styles.successButtonText}>Finalizar</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {options?.showQuote && isQuoteFormOpen ? (
              <View style={styles.quoteFormCard}>
                <Text style={styles.quoteFormTitle}>Disponibilidad del taller</Text>

                <Text style={styles.quoteFormLabel}>Comentario</Text>
                <TextInput
                  style={[styles.quoteInput, styles.quoteInputMultiline]}
                  value={quoteForm.comentarioCliente}
                  onChangeText={(value) => actualizarCampoCotizacion(id, "comentarioCliente", value)}
                  placeholder="Comentario para el cliente"
                  placeholderTextColor="#94a3b8"
                  multiline
                />

                <Text style={styles.quoteFormLabel}>Fecha disponible</Text>
                {Platform.OS === "web" ? (
                  <View style={styles.webPickerShell}>
                    {React.createElement("input" as any, {
                      type: "date",
                      value: quoteForm.fechaDisponible,
                      min: new Date().toISOString().slice(0, 10),
                      onChange: (event: { target: { value: string } }) =>
                        actualizarCampoCotizacion(id, "fechaDisponible", event.target.value),
                      style: {
                        width: "100%",
                        minHeight: 48,
                        borderWidth: 0,
                        outlineStyle: "none",
                        backgroundColor: "transparent",
                        color: "#08121f",
                        fontSize: 16,
                        padding: "0 2px",
                      },
                    })}
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.mobilePickerField}
                    activeOpacity={0.88}
                    onPress={() => setPickerModal({ requestId: id, field: "fechaDisponible" })}
                  >
                    <View style={styles.mobilePickerFieldContent}>
                      <MaterialCommunityIcons name="calendar-month-outline" size={18} color="#64748b" />
                      <Text
                        style={[
                          styles.mobilePickerFieldText,
                          !quoteForm.fechaDisponible && styles.mobilePickerPlaceholderText,
                        ]}
                      >
                        {formatDateFieldLabel(quoteForm.fechaDisponible)}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
                  </TouchableOpacity>
                )}

                <Text style={styles.quoteFormLabel}>Horario disponible</Text>
                {Platform.OS === "web" ? (
                  <View style={styles.webPickerShell}>
                    {React.createElement("input" as any, {
                      type: "time",
                      value: quoteForm.horarioDisponible,
                      onChange: (event: { target: { value: string } }) =>
                        actualizarCampoCotizacion(id, "horarioDisponible", event.target.value),
                      style: {
                        width: "100%",
                        minHeight: 48,
                        borderWidth: 0,
                        outlineStyle: "none",
                        backgroundColor: "transparent",
                        color: "#08121f",
                        fontSize: 16,
                        padding: "0 2px",
                      },
                    })}
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.mobilePickerField}
                    activeOpacity={0.88}
                    onPress={() => setPickerModal({ requestId: id, field: "horarioDisponible" })}
                  >
                    <View style={styles.mobilePickerFieldContent}>
                      <MaterialCommunityIcons name="clock-time-four-outline" size={18} color="#64748b" />
                      <Text
                        style={[
                          styles.mobilePickerFieldText,
                          !quoteForm.horarioDisponible && styles.mobilePickerPlaceholderText,
                        ]}
                      >
                        {formatTimeFieldLabel(quoteForm.horarioDisponible)}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.primaryButton, styles.formSubmitButton]}
                  onPress={() => aprobarSolicitudTaller(item)}
                >
                  <Text style={styles.primaryButtonText}>Confirmar disponibilidad</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {options?.showDiagnosticSend ? (
              <View style={styles.quoteFormCard}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => abrirFormularioDiagnostico(item)}
                >
                  <Text style={styles.primaryButtonText}>
                    {isDiagnosticFormOpen ? "Ocultar diagnostico" : "Registrar diagnostico"}
                  </Text>
                </TouchableOpacity>

                {isDiagnosticFormOpen ? (
                  <>
                    <Text style={styles.quoteFormLabel}>Diagnostico</Text>
                    <TextInput
                      style={[styles.quoteInput, styles.quoteInputMultiline]}
                      value={diagnosticForm.diagnostico}
                      onChangeText={(value) => actualizarCampoDiagnostico(id, "diagnostico", value)}
                      placeholder="Descripcion del diagnostico"
                      placeholderTextColor="#94a3b8"
                      multiline
                    />

                    <Text style={styles.quoteFormLabel}>Servicios a realizar</Text>
                    <TextInput
                      style={[styles.quoteInput, styles.quoteInputMultiline]}
                      value={diagnosticForm.servicios}
                      onChangeText={(value) => actualizarCampoDiagnostico(id, "servicios", value)}
                      placeholder="Servicios y labores a ejecutar"
                      placeholderTextColor="#94a3b8"
                      multiline
                    />

                    <Text style={styles.quoteFormLabel}>Horas estimadas</Text>
                    <TextInput
                      style={styles.quoteInput}
                      value={diagnosticForm.horas}
                      onChangeText={(value) => actualizarCampoDiagnostico(id, "horas", value)}
                      placeholder="4 horas"
                      placeholderTextColor="#94a3b8"
                    />

                    <Text style={styles.quoteFormLabel}>Observaciones de repuestos</Text>
                    <TextInput
                      style={[styles.quoteInput, styles.quoteInputMultiline]}
                      value={diagnosticForm.materiales}
                      onChangeText={(value) => actualizarCampoDiagnostico(id, "materiales", value)}
                      placeholder="Notas para el administrador sobre repuestos"
                      placeholderTextColor="#94a3b8"
                      multiline
                    />

                    <Text style={styles.quoteFormLabel}>Repuestos requeridos</Text>
                    {diagnosticForm.repuestos.map((repuesto, index) => (
                      <View key={`${id}-diag-repuesto-${index}`} style={styles.returnBlock}>
                        <TextInput
                          style={styles.quoteInput}
                          value={repuesto.nombre}
                          onChangeText={(value) => actualizarRepuestoDiagnostico(id, index, "nombre", value)}
                          placeholder={`Repuesto ${index + 1}`}
                          placeholderTextColor="#94a3b8"
                        />
                        <TextInput
                          style={styles.quoteInput}
                          value={repuesto.cantidad}
                          onChangeText={(value) => actualizarRepuestoDiagnostico(id, index, "cantidad", value)}
                          placeholder="Cantidad"
                          placeholderTextColor="#94a3b8"
                          keyboardType="numeric"
                        />
                      </View>
                    ))}

                    <TouchableOpacity
                      style={styles.secondaryButton}
                      onPress={() => agregarRepuestoDiagnostico(id)}
                    >
                      <Text style={styles.secondaryButtonText}>Agregar repuesto</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => enviarDiagnostico(item)}
                    >
                      <Text style={styles.primaryButtonText}>Enviar diagnostico al admin</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            ) : null}

            <View style={styles.timelineCard}>
              <Text style={styles.timelineCardTitle}>Seguimiento de la intervencion</Text>
              {trackingSteps.map((step) => (
                <View key={`${id}-${step.label}`} style={styles.timelineStep}>
                  <View style={[styles.timelineIcon, step.completed && styles.timelineIconCompleted]}>
                    <MaterialCommunityIcons
                      name={step.completed ? "check" : "clock-outline"}
                      size={14}
                      color={step.completed ? "#1d4ed8" : "#64748b"}
                    />
                  </View>
                  <View style={styles.timelineTextGroup}>
                    <Text style={styles.timelineLabel}>{step.label}</Text>
                    <Text style={styles.timelineState}>{step.completed ? "Confirmado" : "Pendiente"}</Text>
                  </View>
                </View>
              ))}
            </View>

            {item.flujo_mantenimiento?.encuesta_satisfaccion?.calificacion ? (
              <View style={styles.timelineCard}>
                <Text style={styles.timelineCardTitle}>Calificacion del cliente</Text>
                <Text style={styles.expandedText}>
                  Calificacion: {"★".repeat(Number(item.flujo_mantenimiento.encuesta_satisfaccion.calificacion || 0))}
                  {"☆".repeat(5 - Number(item.flujo_mantenimiento.encuesta_satisfaccion.calificacion || 0))}
                </Text>
                {item.flujo_mantenimiento.encuesta_satisfaccion.comentario ? (
                  <Text style={styles.expandedText}>
                    Comentario: {item.flujo_mantenimiento.encuesta_satisfaccion.comentario}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderSectionContent = () => {
    if (selectedSection === "Vista general") {
      return (
        <>
          <View style={styles.kpiGrid}>
            {kpis.map((item) => (
              <View key={item.label} style={[styles.kpiCard, isMobile && styles.kpiCardMobile]}>
                <View style={[styles.kpiBar, { backgroundColor: item.color }]} />
                <Text style={styles.kpiValue}>{item.value}</Text>
                <Text style={styles.kpiLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.grid, isMobile && styles.gridMobile]}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Alertas</Text>
              <View style={styles.simpleRow}><MaterialCommunityIcons name="bell-ring-outline" size={18} color="#f97316" /><Text style={styles.simpleRowText}>{waitingAdminRequests.length} esperando confirmacion del cliente</Text></View>
              <View style={styles.simpleRow}><MaterialCommunityIcons name="clock-alert-outline" size={18} color="#f97316" /><Text style={styles.simpleRowText}>{delayedRequests.length} tiempos atrasados</Text></View>
              <View style={styles.simpleRow}><MaterialCommunityIcons name="backup-restore" size={18} color="#f97316" /><Text style={styles.simpleRowText}>{returnedRequests.length} solicitudes devueltas</Text></View>
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Tiempos atrasados</Text>
              {delayedRequests.length > 0 ? delayedRequests.map((item) => (
                <View key={String(item.id)} style={styles.simpleInfoCard}>
                  <Text style={styles.simpleInfoTitle}>Solicitud #{getCaseNumber(item)}</Text>
                  <Text style={styles.simpleInfoText}>{item.cliente?.nombre || "Sin cliente"}</Text>
                  <Text style={styles.simpleInfoText}>{getVehicleName(item)}</Text>
                </View>
              )) : <Text style={styles.emptyText}>No hay ordenes atrasadas.</Text>}
            </View>
          </View>
        </>
      );
    }

    if (selectedSection === "Solicitudes recibidas") {
      const items = filtrarSolicitudes(requestsReceived);
      return (
        <View style={styles.panel}>
          <View style={styles.moduleHeaderCard}>
            <View style={styles.moduleHeaderText}>
              <Text style={styles.moduleHeaderTitle}>Modulo: Taller</Text>
              <Text style={styles.moduleHeaderSubtitle}>Gestion de solicitudes recibidas y aprobacion inicial.</Text>
            </View>
            <View style={styles.moduleHeaderBadge}>
              <MaterialCommunityIcons name="clipboard-list-outline" size={18} color="#2563eb" />
              <Text style={styles.moduleHeaderBadgeText}>{items.length}</Text>
            </View>
          </View>
          <View style={styles.sectionToolbar}>
            <Text style={styles.sectionToolbarTitle}>Solicitudes</Text>
            <TouchableOpacity style={styles.filterActionButton} onPress={() => setShowFilterModal(true)}>
              <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
            </TouchableOpacity>
          </View>
          {items.length > 0 ? items.map((item) => renderRequestCard(item, { showQuote: true, showReturn: true, showInfo: true })) : <Text style={styles.emptyText}>No hay solicitudes nuevas en este momento.</Text>}
        </View>
      );
    }

    if (selectedSection === "Diagnostico") {
      const items = filtrarSolicitudes(diagnosticRequests);
      const waitingItems = filtrarSolicitudes(waitingAdminRequests);
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Diagnostico</Text>
          <Text style={styles.panelSubtitle}>Cuando el cliente confirma la llegada al taller, aqui aparece el formulario de diagnostico y repuestos. Debajo veras lo que ya fue enviado al administrador.</Text>
          <View style={styles.sectionToolbar}>
            <Text style={styles.sectionToolbarTitle}>Solicitudes</Text>
            <TouchableOpacity style={styles.filterActionButton} onPress={() => setShowFilterModal(true)}>
              <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
            </TouchableOpacity>
          </View>
          {items.length > 0 ? items.map((item) => renderRequestCard(item, { showDiagnosticSend: true, showInfo: true })) : <Text style={styles.emptyText}>No hay vehiculos pendientes por diagnostico.</Text>}
          {waitingItems.length > 0 ? waitingItems.map((item) => renderRequestCard(item, { showInfo: true })) : null}
        </View>
      );
    }

    if (selectedSection === "Intervencion") {
      const interventionItems = filtrarSolicitudes(
        dedupeWorkshopRequests([...approvedRequests, ...inProgressRequests])
      );
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Intervencion</Text>
          <Text style={styles.panelSubtitle}>Solo ingresan aqui las solicitudes aprobadas por el administrador.</Text>
          <View style={styles.sectionToolbar}>
            <Text style={styles.sectionToolbarTitle}>Solicitudes</Text>
            <TouchableOpacity style={styles.filterActionButton} onPress={() => setShowFilterModal(true)}>
              <MaterialCommunityIcons name="tune-variant" size={18} color="#1f2937" />
            </TouchableOpacity>
          </View>
          {interventionItems.length > 0 ? interventionItems.map((item) => renderRequestCard(item, {
            showStart:
              hasClientApprovedFlow(item) &&
              !isWorkshopFinalized(item) &&
              ["aprobada", "repuestos_despachados"].includes(normalizeStatus(item.estado)),
            showReceiveParts:
              hasClientApprovedFlow(item) &&
              !isWorkshopFinalized(item) &&
              ["repuestos_despachados", "intervencion_iniciada"].includes(normalizeStatus(item.estado)),
            showFinish:
              hasClientApprovedFlow(item) &&
              !isWorkshopFinalized(item) &&
              normalizeStatus(item.estado) === "repuestos_recibidos_taller",
          })) : <Text style={styles.emptyText}>No hay ordenes en intervencion.</Text>}
        </View>
      );
    }

    if (selectedSection === "Materiales / Repuestos") {
      const materialSource = filtrarSolicitudes(
        dedupeWorkshopRequests([...approvedRequests, ...inProgressRequests])
      );
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Materiales / Repuestos</Text>
          <Text style={styles.panelSubtitle}>Control de insumos usados por cada orden.</Text>
          {materialSource.length > 0 ? materialSource.map((item) => (
            <View key={String(item.id)} style={styles.simpleInfoCard}>
              <Text style={styles.simpleInfoTitle}>Solicitud #{getCaseNumber(item)}</Text>
              <Text style={styles.simpleInfoText}>{getRequestTitle(item.tipo_servicio)}</Text>
              <Text style={styles.simpleInfoText}>Materiales solicitados: revisar segun diagnostico</Text>
              <Text style={styles.simpleInfoText}>Materiales aprobados: pendientes por confirmar</Text>
              <Text style={styles.simpleInfoText}>Materiales usados: por registrar</Text>
            </View>
          )) : <Text style={styles.emptyText}>No hay materiales o repuestos activos.</Text>}
        </View>
      );
    }

    if (selectedSection === "Entrega / Informe") {
      const items = filtrarSolicitudes(inProgressRequests);
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Entrega / Informe</Text>
          <Text style={styles.panelSubtitle}>El taller devuelve la informacion final al administrador.</Text>
          {items.length > 0 ? items.map((item) => (
            <View key={String(item.id)} style={styles.requestCard}>
              <Text style={styles.requestTitle}>Solicitud #{getCaseNumber(item)}</Text>
              <Text style={styles.requestSubtitle}>{getVehicleName(item)}</Text>
              <Text style={styles.metaText}>Cliente: {item.cliente?.nombre || "Sin nombre"}</Text>
              <Text style={styles.metaText}>Diagnostico final: listo para enviar</Text>
              <Text style={styles.metaText}>Servicios realizados: {item.tipo_servicio || "Revision general"}</Text>
              <Text style={styles.metaText}>Horas reales: pendientes por cargar</Text>
              <Text style={styles.metaText}>Materiales utilizados: pendientes por confirmar</Text>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.primaryButton} onPress={() => Alert.alert("Informe", "El informe quedo listo para el administrador.")}>
                  <Text style={styles.primaryButtonText}>Enviar informe al administrador</Text>
                </TouchableOpacity>
              </View>
            </View>
          )) : <Text style={styles.emptyText}>No hay ordenes listas para informe.</Text>}
        </View>
      );
    }

    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Historial</Text>
        <Text style={styles.panelSubtitle}>Ordenes finalizadas y solicitudes devueltas.</Text>
        {filtrarSolicitudes([...finishedRequests, ...returnedRequests]).length > 0 ? filtrarSolicitudes([...finishedRequests, ...returnedRequests]).map((item) => renderRequestCard(item)) : <Text style={styles.emptyText}>No hay historial disponible.</Text>}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <Modal transparent visible={Boolean(actionLoadingMessage)} animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>{actionLoadingMessage || "Procesando..."}</Text>
          </View>
        </View>
      </Modal>
      {renderQuickFilterModal()}
      {renderSchedulePickerModal()}
      {showNotifications ? (
        <View style={styles.overlayLayer} pointerEvents="box-none">
          <Pressable style={styles.overlayBackdrop} onPress={() => { setShowNotifications(false); }} />
        </View>
      ) : null}

      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.topActionsRow}>
          <View style={styles.topActionGroup}>
            <TouchableOpacity style={styles.iconActionButton} onPress={() => { setMenuOpen((current) => !current); setShowNotifications(false); }}>
              <MaterialCommunityIcons name="menu" size={28} color="#08121f" />
            </TouchableOpacity>

            {menuOpen ? (
              <View style={[styles.dropdownMenu, isMobile && styles.dropdownMenuMobile]}>
                <View style={styles.dropdownHeader}>
                  <View style={styles.logoBox}><MaterialCommunityIcons name="car-cog" size={24} color="#ffffff" /></View>
                  <View>
                    <Text style={styles.sidebarEyebrow}>Taller</Text>
                    <Text style={styles.sidebarTitle}>{tallerName}</Text>
                  </View>
                </View>

                {sections.map((item) => {
                  const active = selectedSection === item.label;
                  return (
                    <TouchableOpacity key={item.label} style={[styles.sideItem, active && styles.sideItemActive]} onPress={() => { setSelectedSection(item.label); setMenuOpen(false); }}>
                      <View style={styles.sideItemRow}>
                        <MaterialCommunityIcons name={item.icon as any} size={20} color={active ? "#08121f" : "#c2cbe0"} />
                        <Text style={[styles.sideText, active && styles.sideTextActive]}>{item.label}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity style={styles.logoutButton} onPress={cerrarSesion}>
                  <MaterialCommunityIcons name="logout" size={20} color="#ffb4a8" />
                  <Text style={styles.logoutButtonText}>Cerrar sesion</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <TouchableOpacity style={[styles.iconActionButton, styles.logoutIconButton]} onPress={cerrarSesion}>
            <MaterialCommunityIcons name="power" size={26} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.main}>
          <View style={[styles.hero, isMobile && styles.heroMobile]}>
            <View style={styles.heroTextGroup}>
              <Text style={styles.pageTitle}>Modulo: Taller</Text>
              <Text style={styles.pageSubtitle}>Gestiona la recepcion, diagnostico, intervencion e informe final de cada orden.</Text>
              <View style={styles.currentSectionPill}>
                <Text style={styles.currentSectionText}>{selectedSection}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.bellButton} onPress={() => { setShowNotifications((current) => !current); setMenuOpen(false); }}>
              <MaterialCommunityIcons name="bell-outline" size={24} color="#2563eb" />
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>{unreadNotifications}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {showNotifications ? (
            <View style={styles.notificationsDropdown}>
              <Text style={styles.notificationsTitle}>Notificaciones</Text>
              {notificaciones.length > 0 ? notificaciones.map((item) => (
                <TouchableOpacity key={String(item.id)} style={styles.notificationItem} onPress={() => abrirDesdeNotificacion(item)}>
                  <Text style={styles.notificationItemTitle}>{item.titulo || "Notificacion"}</Text>
                </TouchableOpacity>
              )) : <Text style={styles.emptyText}>No tienes notificaciones nuevas.</Text>}
            </View>
          ) : null}

          {renderSectionContent()}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#eef3f9" },
  content: { padding: 20 },
  overlayLayer: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  overlayBackdrop: { ...StyleSheet.absoluteFillObject },
  quickFilterOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 40, justifyContent: "center", padding: 20 },
  quickFilterBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,18,31,0.28)" },
  quickFilterCard: { backgroundColor: "#ffffff", borderRadius: 24, padding: 18, borderWidth: 1, borderColor: "#dbe4f0", shadowColor: "#08121f", shadowOpacity: 0.14, shadowRadius: 18, elevation: 8 },
  quickFilterTitle: { color: "#102447", fontSize: 18, fontWeight: "800", marginBottom: 12 },
  quickFilterLabel: { color: "#475569", fontWeight: "700", marginTop: 8, marginBottom: 8 },
  quickFilterChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,18,31,0.32)", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 60 },
  loadingCard: { minWidth: 220, backgroundColor: "#ffffff", borderRadius: 22, padding: 20, alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#dbe4f0" },
  loadingText: { color: "#102447", fontWeight: "800", textAlign: "center" },
  quickFilterChip: { backgroundColor: "#eef3f9", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  quickFilterChipActive: { backgroundColor: "#dbeafe" },
  quickFilterChipText: { color: "#425066", fontWeight: "700" },
  quickFilterChipTextActive: { color: "#1d4ed8" },
  quickFilterActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 16 },
  topActionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18, zIndex: 30 },
  topActionGroup: { position: "relative" },
  iconActionButton: { width: 56, height: 56, borderRadius: 18, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#dbe4f0", alignItems: "center", justifyContent: "center", shadowColor: "#08121f", shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  logoutIconButton: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  dropdownMenu: { position: "absolute", top: 68, left: 0, width: 320, backgroundColor: "#08121f", borderRadius: 28, padding: 20, shadowColor: "#08121f", shadowOpacity: 0.24, shadowRadius: 20, elevation: 8 },
  dropdownMenuMobile: { width: 280 },
  dropdownHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  logoBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#ff5b2e", alignItems: "center", justifyContent: "center" },
  sidebarEyebrow: { color: "#8fa1c2", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  sidebarTitle: { color: "#ffffff", fontSize: 20, fontWeight: "700" },
  sideItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, borderRadius: 16, marginBottom: 8 },
  sideItemRow: { flexDirection: "row", alignItems: "center" },
  sideItemActive: { backgroundColor: "#dfe9f7" },
  sideText: { color: "#c2cbe0", marginLeft: 12, fontWeight: "600" },
  sideTextActive: { color: "#08121f", fontWeight: "800" },
  logoutButton: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, marginTop: 18, backgroundColor: "rgba(255,91,46,0.12)" },
  logoutButtonText: { color: "#ffb4a8", fontSize: 15, fontWeight: "700" },
  main: { gap: 18 },
  hero: { backgroundColor: "#ffffff", borderRadius: 28, padding: 24, borderWidth: 1, borderColor: "#dbe4f0", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroMobile: { flexDirection: "column", alignItems: "flex-start", gap: 16 },
  heroTextGroup: { flex: 1 },
  pageTitle: { color: "#08121f", fontSize: 32, fontWeight: "800" },
  pageSubtitle: { color: "#5f6b7c", marginTop: 8, lineHeight: 22, maxWidth: 620 },
  currentSectionPill: { alignSelf: "flex-start", marginTop: 14, backgroundColor: "#eef4ff", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "#d7e4fb" },
  currentSectionText: { color: "#2563eb", fontWeight: "800" },
  bellButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e5ebf5" },
  notificationBadge: { position: "absolute", top: 6, right: 5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#ff5b2e", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  notificationBadgeText: { color: "#ffffff", fontSize: 10, fontWeight: "800" },
  notificationsDropdown: { backgroundColor: "#ffffff", borderRadius: 24, padding: 18, borderWidth: 1, borderColor: "#dbe4f0", zIndex: 25 },
  notificationsTitle: { color: "#08121f", fontSize: 18, fontWeight: "800", marginBottom: 10 },
  notificationItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#e6edf6" },
  notificationItemTitle: { color: "#08121f", fontWeight: "800" },
  panel: { backgroundColor: "#ffffff", borderRadius: 24, padding: 22, borderWidth: 1, borderColor: "#dbe4f0", flex: 1 },
  moduleHeaderCard: { backgroundColor: "#ffffff", borderRadius: 24, padding: 18, borderWidth: 1, borderColor: "#e8edf6", flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, shadowColor: "#08121f", shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  moduleHeaderText: { flex: 1, gap: 4 },
  moduleHeaderTitle: { color: "#102447", fontSize: 18, fontWeight: "900" },
  moduleHeaderSubtitle: { color: "#64748b", lineHeight: 18 },
  moduleHeaderBadge: { minWidth: 44, height: 44, borderRadius: 16, backgroundColor: "#eff6ff", alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 8 },
  moduleHeaderBadgeText: { color: "#1d4ed8", fontWeight: "800", fontSize: 12 },
  sectionToolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sectionToolbarTitle: { color: "#102447", fontSize: 17, fontWeight: "800" },
  filterActionButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#dbe4f0", alignItems: "center", justifyContent: "center" },
  panelTitle: { color: "#08121f", fontSize: 22, fontWeight: "800" },
  panelSubtitle: { color: "#64748b", marginTop: 8, lineHeight: 22 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  kpiCard: { minWidth: 160, width: "31%", flexGrow: 1, backgroundColor: "#ffffff", borderRadius: 22, padding: 18, borderWidth: 1, borderColor: "#dbe4f0" },
  kpiCardMobile: { width: "47%", minWidth: 0 },
  kpiBar: { width: 42, height: 6, borderRadius: 999, marginBottom: 18 },
  kpiValue: { color: "#08121f", fontSize: 28, fontWeight: "800" },
  kpiLabel: { color: "#6b778a", marginTop: 6, fontWeight: "700" },
  grid: { flexDirection: "row", gap: 16 },
  gridMobile: { flexDirection: "column" },
  simpleRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#f8fbff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#e6edf6", marginTop: 12 },
  simpleRowText: { color: "#334155", fontWeight: "700", flex: 1 },
  simpleInfoCard: { backgroundColor: "#f8fbff", borderRadius: 18, padding: 16, marginTop: 12, borderWidth: 1, borderColor: "#e6edf6" },
  simpleInfoTitle: { color: "#08121f", fontWeight: "800", marginBottom: 6 },
  simpleInfoText: { color: "#475569", marginTop: 4 },
  requestCard: { backgroundColor: "#ffffff", borderRadius: 22, padding: 18, marginTop: 14, borderWidth: 1, borderColor: "#e6edf6", shadowColor: "#08121f", shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  highlightedCard: { borderColor: "#2563eb", borderWidth: 2, shadowColor: "#2563eb", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  requestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  requestHeaderMain: { flex: 1 },
  requestTitle: { color: "#08121f", fontWeight: "800", fontSize: 18 },
  requestSubtitle: { color: "#475569", marginTop: 4, fontWeight: "700" },
  statePill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
  statePillText: { fontWeight: "800" },
  requestMetaList: { marginTop: 10, gap: 8 },
  requestMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { color: "#475569", fontWeight: "600", flex: 1 },
  priorityPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, marginTop: 12 },
  priorityText: { fontWeight: "800", textTransform: "capitalize" },
  expandHint: { color: "#64748b", marginTop: 10, fontSize: 12, fontWeight: "700" },
  expandedBlock: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#dbe4f0" },
  expandedText: { color: "#334155", marginTop: 4, lineHeight: 20 },
  infoBanner: { marginTop: 12, backgroundColor: "#eff6ff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#bfdbfe", flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoBannerText: { color: "#1d4ed8", flex: 1, lineHeight: 20, fontWeight: "600" },
  sentAvailabilityCard: { marginTop: 12, backgroundColor: "#f8fbff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#d7e4fb" },
  sentAvailabilityTitle: { color: "#102447", fontWeight: "800", marginBottom: 4 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  returnBlock: { flex: 1, minWidth: 220 },
  quoteFormCard: { marginTop: 14, backgroundColor: "#ffffff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#dbe4f0", gap: 10 },
  quoteFormTitle: { color: "#08121f", fontSize: 16, fontWeight: "800" },
  quoteFormLabel: { color: "#334155", fontWeight: "700", marginTop: 2 },
  quoteInput: { backgroundColor: "#f8fbff", borderRadius: 14, borderWidth: 1, borderColor: "#dbe4f0", paddingHorizontal: 14, paddingVertical: 12, color: "#08121f" },
  quoteInputMultiline: { minHeight: 92, textAlignVertical: "top" },
  webPickerShell: { backgroundColor: "#f8fbff", borderRadius: 14, borderWidth: 1, borderColor: "#dbe4f0", paddingHorizontal: 12, minHeight: 50, justifyContent: "center" },
  pickerModalCard: { backgroundColor: "#ffffff", borderRadius: 24, padding: 18, borderWidth: 1, borderColor: "#dbe4f0", shadowColor: "#08121f", shadowOpacity: 0.14, shadowRadius: 18, elevation: 8, maxHeight: "74%" },
  pickerScrollArea: { maxHeight: 360 },
  pickerOptionList: { gap: 10 },
  pickerOptionButton: { borderRadius: 16, borderWidth: 1, borderColor: "#dbe4f0", backgroundColor: "#f8fbff", paddingHorizontal: 14, paddingVertical: 14 },
  pickerOptionButtonActive: { backgroundColor: "#dbeafe", borderColor: "#93c5fd" },
  pickerOptionText: { color: "#334155", fontWeight: "700" },
  pickerOptionTextActive: { color: "#1d4ed8" },
  mobilePickerField: { backgroundColor: "#f8fbff", borderRadius: 14, borderWidth: 1, borderColor: "#dbe4f0", paddingHorizontal: 14, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  mobilePickerFieldContent: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  mobilePickerFieldText: { color: "#08121f", fontSize: 15, fontWeight: "600", flex: 1 },
  mobilePickerPlaceholderText: { color: "#94a3b8", fontWeight: "500" },
  commentCounter: { marginTop: 6, marginBottom: 8, color: "#64748b", fontSize: 12, textAlign: "right" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "800" },
  secondaryButton: { backgroundColor: "#eef2ff", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#334155", fontWeight: "800" },
  successButton: { backgroundColor: "#16a34a", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  successButtonText: { color: "#ffffff", fontWeight: "800" },
  dangerButton: { backgroundColor: "#fee2e2", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fecaca" },
  dangerButtonText: { color: "#b91c1c", fontWeight: "800" },
  inlineActionButton: { alignSelf: "flex-start", minWidth: 160 },
  formSubmitButton: { marginTop: 6 },
  emptyText: { color: "#94a3b8", marginTop: 14, fontStyle: "italic" },
  timelineCard: { marginTop: 14, backgroundColor: "#f8fbff", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "#d7e4fb", gap: 10 },
  timelineCardTitle: { color: "#102447", fontWeight: "800", marginBottom: 2 },
  timelineStep: { flexDirection: "row", alignItems: "center", gap: 12 },
  timelineIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#e2e8f0", alignItems: "center", justifyContent: "center" },
  timelineIconCompleted: { backgroundColor: "#dbeafe" },
  timelineTextGroup: { flex: 1, gap: 2 },
  timelineLabel: { color: "#0f172a", fontWeight: "700" },
  timelineState: { color: "#64748b", fontSize: 12, fontWeight: "600" },
});
