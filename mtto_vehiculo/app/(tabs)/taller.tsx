import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { API_BASE_URL } from "../../constants/api";
import { formatDateTime } from "../../constants/formatters";
import {
  getStatusLabel,
  isApprovedStatus,
  isDiagnosedStatus,
  isFinishedStatus,
  isInDiagnosisStatus,
  isInProcessStatus,
  isRejectedWorkshopStatus,
  normalizeStatus,
} from "../../constants/request-status";
import storage from "../../constants/storage";

type Solicitud = {
  id?: number | string;
  numero_caso?: number | string | null;
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
};

type Notificacion = {
  id?: number | string;
  titulo?: string;
  mensaje?: string;
  leida?: boolean;
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

const getCaseNumber = (item: Solicitud) => item.numero_caso ?? item.id;

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

const getStateLabel = (value?: string) => {
  const state = normalizeStatus(value);
  if (state === "creada") return "Creada";
  return getStatusLabel(state);
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
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [openQuoteFormId, setOpenQuoteFormId] = useState<string | null>(null);
  const [quoteForms, setQuoteForms] = useState<
    Record<string, { comentario: string; fechaDisponible: string; horarioDisponible: string }>
  >({});

  useEffect(() => {
    cargarDashboard();
  }, []);

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
    }
  };

  const actualizarCampoCotizacion = (
    solicitudId: string,
    field: "comentario" | "fechaDisponible" | "horarioDisponible",
    value: string
  ) => {
    setQuoteForms((current) => ({
      ...current,
      [solicitudId]: {
        comentario: current[solicitudId]?.comentario || "",
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
        comentario: item.respuesta_taller?.comentario || item.observacion || "",
        fechaDisponible: item.respuesta_taller?.fecha_disponible || "",
        horarioDisponible: item.respuesta_taller?.horario_disponible || "",
      },
    }));
  };

  const aprobarSolicitudTaller = async (item: Solicitud) => {
    const solicitudId = String(item.id ?? "");
    const form = quoteForms[solicitudId] || {
      comentario: "",
      fechaDisponible: "",
      horarioDisponible: "",
    };

    if (!form.comentario.trim() || !form.fechaDisponible.trim() || !form.horarioDisponible.trim()) {
      Alert.alert("Campos requeridos", "Debes completar comentario, fecha y horario disponible.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fechaDisponible.trim())) {
      Alert.alert("Fecha invalida", "La fecha debe ir en formato YYYY-MM-DD.");
      return;
    }

    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/respuesta-taller`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          comentario: form.comentario.trim(),
          fecha_disponible: form.fechaDisponible.trim(),
          horario_disponible: form.horarioDisponible.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo enviar la respuesta al administrador");
        return;
      }

      setOpenQuoteFormId(null);
      await cargarSolicitudes();
      Alert.alert("Enviado", "La aprobacion del taller fue enviada al administrador.");
    } catch (error) {
      console.log("error enviando respuesta taller", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
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
        return !["cotizando", "cotizado", "devuelta", "devuelto_proveedor", "omitida_admin", "archivada", "enviado_cliente"].includes(state);
      }),
    [solicitudes]
  );

  const requestsReceived = useMemo(
    () => workshopRequests.filter((item) => isInDiagnosisStatus(item.estado)),
    [workshopRequests]
  );
  const diagnosticRequests = useMemo(
    () => workshopRequests.filter((item) => isInDiagnosisStatus(item.estado)),
    [workshopRequests]
  );
  const waitingAdminRequests = useMemo(
    () => workshopRequests.filter((item) => isDiagnosedStatus(item.estado)),
    [workshopRequests]
  );
  const approvedRequests = useMemo(
    () => workshopRequests.filter((item) => isApprovedStatus(item.estado)),
    [workshopRequests]
  );
  const inProgressRequests = useMemo(
    () => workshopRequests.filter((item) => isInProcessStatus(item.estado)),
    [workshopRequests]
  );
  const finishedRequests = useMemo(
    () => workshopRequests.filter((item) => isFinishedStatus(item.estado)),
    [workshopRequests]
  );
  const returnedRequests = useMemo(
    () => workshopRequests.filter((item) => isRejectedWorkshopStatus(item.estado)),
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
  const kpis = [
    { label: "Solicitudes nuevas", value: requestsReceived.length, color: "#2563eb" },
    { label: "En diagnostico", value: diagnosticRequests.length, color: "#f97316" },
    { label: "En reparacion", value: inProgressRequests.length, color: "#16a34a" },
    { label: "Pendientes admin", value: waitingAdminRequests.length, color: "#7c3aed" },
    { label: "Finalizadas", value: finishedRequests.length, color: "#0f766e" },
  ];

  const renderRequestCard = (
    item: Solicitud,
    options?: {
      showQuote?: boolean;
      showReturn?: boolean;
      showDiagnosticSend?: boolean;
      showStart?: boolean;
      showProgress?: boolean;
      showFinish?: boolean;
      showInfo?: boolean;
    }
  ) => {
    const id = String(item.id ?? "");
    const isExpanded = expandedRequestId === id;
    const isHighlighted = highlightedOrderId === id;
    const priority = priorities[getPriority(item)];
    const isQuoteFormOpen = openQuoteFormId === id;
    const quoteForm = quoteForms[id] || {
      comentario: item.respuesta_taller?.comentario || item.observacion || "",
      fechaDisponible: item.respuesta_taller?.fecha_disponible || "",
      horarioDisponible: item.respuesta_taller?.horario_disponible || "",
    };

    return (
      <TouchableOpacity
        key={id}
        style={[styles.requestCard, isHighlighted && styles.highlightedCard]}
        activeOpacity={0.92}
        onPress={() => setExpandedRequestId((current) => (current === id ? null : id))}
      >
        <View style={styles.requestHeader}>
          <View style={styles.requestHeaderMain}>
            <Text style={styles.requestTitle}>Solicitud #{getCaseNumber(item)}</Text>
            <Text style={styles.requestSubtitle}>{getRequestTitle(item.tipo_servicio)}</Text>
          </View>
          <View style={styles.statePill}>
            <Text style={styles.statePillText}>{getStateLabel(item.estado)}</Text>
          </View>
        </View>

        <Text style={styles.metaText}>Cliente: {item.cliente?.nombre || "Sin nombre"}</Text>
        <Text style={styles.metaText}>Vehiculo: {getVehicleName(item)}</Text>
        <Text style={styles.metaText}>Problema: {item.problema || "Sin descripcion"}</Text>
        <Text style={styles.metaText}>Disponibilidad cliente: {item.disponibilidad_cliente || "Sin registrar"}</Text>
        <Text style={styles.metaText}>Fecha: {formatDateTime(item.fecha)}</Text>

        <View style={[styles.priorityPill, { backgroundColor: priority.bg, borderColor: priority.border }]}>
          <Text style={[styles.priorityText, { color: priority.text }]}>Prioridad {getPriority(item)}</Text>
        </View>

        <Text style={styles.expandHint}>{isExpanded ? "Toca para ocultar detalle" : "Toca para ver detalle"}</Text>

        {isExpanded ? (
          <View style={styles.expandedBlock}>
            <Text style={styles.expandedText}>Placa: {item.vehiculo?.placa || "Sin placa"}</Text>
            <Text style={styles.expandedText}>Servicio: {item.tipo_servicio || "Sin servicio"}</Text>
            <Text style={styles.expandedText}>Recepcion en taller: {formatDateTime(item.fecha)}</Text>
            {options?.showInfo ? (
              <View style={styles.infoBanner}>
                <MaterialCommunityIcons name="information-outline" size={18} color="#2563eb" />
                <Text style={styles.infoBannerText}>Aprueba o rechaza la solicitud. Si la apruebas, envias fecha, horario y comentario al administrador.</Text>
              </View>
            ) : null}
            <View style={styles.actionRow}>
              {options?.showQuote ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => abrirFormularioCotizacion(item)}
                >
                  <Text style={styles.primaryButtonText}>
                    {isQuoteFormOpen ? "Ocultar formulario" : "Aprobar servicio"}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {options?.showReturn ? (
                <View style={styles.returnBlock}>
                  <TextInput
                    style={[styles.quoteInput, styles.quoteInputMultiline]}
                    value={quoteForm.comentario}
                    onChangeText={(value) => actualizarCampoCotizacion(id, "comentario", value)}
                    placeholder="Comentario para devolver al administrador"
                    placeholderTextColor="#94a3b8"
                    multiline
                    maxLength={200}
                  />
                  <Text style={styles.commentCounter}>{quoteForm.comentario.length}/200</Text>
                  <TouchableOpacity
                    style={styles.dangerButton}
                    onPress={() => {
                      const comentario = quoteForm.comentario.trim();
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
                  onPress={() => actualizarEstadoSolicitud(id, "en_proceso", "El trabajo fue iniciado.")}
                >
                  <Text style={styles.primaryButtonText}>Iniciar trabajo</Text>
                </TouchableOpacity>
              ) : null}
              {options?.showProgress ? (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => Alert.alert("Progreso", "La orden sigue en proceso.")}>
                  <Text style={styles.secondaryButtonText}>Actualizar progreso</Text>
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
                <Text style={styles.quoteFormTitle}>Aprobacion del taller</Text>

                <Text style={styles.quoteFormLabel}>Comentario</Text>
                <TextInput
                  style={[styles.quoteInput, styles.quoteInputMultiline]}
                  value={quoteForm.comentario}
                  onChangeText={(value) => actualizarCampoCotizacion(id, "comentario", value)}
                  placeholder="Comentario para el administrador y el cliente"
                  placeholderTextColor="#94a3b8"
                  multiline
                />

                <Text style={styles.quoteFormLabel}>Fecha disponible</Text>
                <TextInput
                  style={styles.quoteInput}
                  value={quoteForm.fechaDisponible}
                  onChangeText={(value) => actualizarCampoCotizacion(id, "fechaDisponible", value)}
                  placeholder="2026-03-30"
                  placeholderTextColor="#94a3b8"
                />

                <Text style={styles.quoteFormLabel}>Horario disponible</Text>
                <TextInput
                  style={styles.quoteInput}
                  value={quoteForm.horarioDisponible}
                  onChangeText={(value) => actualizarCampoCotizacion(id, "horarioDisponible", value)}
                  placeholder="8:00 a. m. a 11:00 a. m."
                  placeholderTextColor="#94a3b8"
                />

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => aprobarSolicitudTaller(item)}
                >
                  <Text style={styles.primaryButtonText}>Enviar al admin</Text>
                </TouchableOpacity>
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
              <View style={styles.simpleRow}><MaterialCommunityIcons name="bell-ring-outline" size={18} color="#f97316" /><Text style={styles.simpleRowText}>{waitingAdminRequests.length} pendientes de respuesta al administrador</Text></View>
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
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Solicitudes recibidas</Text>
          <Text style={styles.panelSubtitle}>Aqui llegan las solicitudes enviadas por el administrador. Desde aqui puedes aprobar el servicio con fecha y horario o rechazarlo.</Text>
          {requestsReceived.length > 0 ? requestsReceived.map((item) => renderRequestCard(item, { showQuote: true, showReturn: true, showInfo: true })) : <Text style={styles.emptyText}>No hay solicitudes nuevas en este momento.</Text>}
        </View>
      );
    }

    if (selectedSection === "Diagnostico") {
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Pendientes de administrador</Text>
          <Text style={styles.panelSubtitle}>Aqui ves las solicitudes aprobadas por el taller y pendientes de que el administrador envie la informacion al cliente.</Text>
          {waitingAdminRequests.length > 0 ? waitingAdminRequests.map((item) => renderRequestCard(item, { showInfo: true })) : <Text style={styles.emptyText}>No hay respuestas pendientes para el administrador.</Text>}
        </View>
      );
    }

    if (selectedSection === "Intervencion") {
      const interventionItems = [...approvedRequests, ...inProgressRequests];
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Intervencion</Text>
          <Text style={styles.panelSubtitle}>Solo ingresan aqui las solicitudes aprobadas por el administrador.</Text>
          {interventionItems.length > 0 ? interventionItems.map((item) => renderRequestCard(item, {
            showStart: isApprovedStatus(item.estado),
            showProgress: isInProcessStatus(item.estado),
            showFinish: isInProcessStatus(item.estado),
          })) : <Text style={styles.emptyText}>No hay ordenes en intervencion.</Text>}
        </View>
      );
    }

    if (selectedSection === "Materiales / Repuestos") {
      const materialSource = [...approvedRequests, ...inProgressRequests];
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
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Entrega / Informe</Text>
          <Text style={styles.panelSubtitle}>El taller devuelve la informacion final al administrador.</Text>
          {inProgressRequests.length > 0 ? inProgressRequests.map((item) => (
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
        {[...finishedRequests, ...returnedRequests].length > 0 ? [...finishedRequests, ...returnedRequests].map((item) => renderRequestCard(item)) : <Text style={styles.emptyText}>No hay historial disponible.</Text>}
      </View>
    );
  };

  return (
    <View style={styles.screen}>
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
  requestCard: { backgroundColor: "#f8fbff", borderRadius: 20, padding: 16, marginTop: 14, borderWidth: 1, borderColor: "#e6edf6" },
  highlightedCard: { borderColor: "#2563eb", borderWidth: 2, shadowColor: "#2563eb", shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  requestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  requestHeaderMain: { flex: 1 },
  requestTitle: { color: "#08121f", fontWeight: "800", fontSize: 18 },
  requestSubtitle: { color: "#475569", marginTop: 4, fontWeight: "700" },
  statePill: { backgroundColor: "#eef4ff", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#d7e4fb" },
  statePillText: { color: "#2563eb", fontWeight: "800" },
  metaText: { color: "#475569", marginTop: 6, fontWeight: "600" },
  priorityPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, marginTop: 12 },
  priorityText: { fontWeight: "800", textTransform: "capitalize" },
  expandHint: { color: "#64748b", marginTop: 10, fontSize: 12, fontWeight: "700" },
  expandedBlock: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#dbe4f0" },
  expandedText: { color: "#334155", marginTop: 4, lineHeight: 20 },
  infoBanner: { marginTop: 12, backgroundColor: "#eff6ff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#bfdbfe", flexDirection: "row", alignItems: "flex-start", gap: 8 },
  infoBannerText: { color: "#1d4ed8", flex: 1, lineHeight: 20, fontWeight: "600" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  returnBlock: { flex: 1, minWidth: 220 },
  quoteFormCard: { marginTop: 14, backgroundColor: "#ffffff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#dbe4f0", gap: 10 },
  quoteFormTitle: { color: "#08121f", fontSize: 16, fontWeight: "800" },
  quoteFormLabel: { color: "#334155", fontWeight: "700", marginTop: 2 },
  quoteInput: { backgroundColor: "#f8fbff", borderRadius: 14, borderWidth: 1, borderColor: "#dbe4f0", paddingHorizontal: 14, paddingVertical: 12, color: "#08121f" },
  quoteInputMultiline: { minHeight: 92, textAlignVertical: "top" },
  commentCounter: { marginTop: 6, marginBottom: 8, color: "#64748b", fontSize: 12, textAlign: "right" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#ffffff", fontWeight: "800" },
  secondaryButton: { backgroundColor: "#eef2ff", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: "#334155", fontWeight: "800" },
  successButton: { backgroundColor: "#16a34a", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  successButtonText: { color: "#ffffff", fontWeight: "800" },
  dangerButton: { backgroundColor: "#fee2e2", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#fecaca" },
  dangerButtonText: { color: "#b91c1c", fontWeight: "800" },
  emptyText: { color: "#94a3b8", marginTop: 14, fontStyle: "italic" },
});
