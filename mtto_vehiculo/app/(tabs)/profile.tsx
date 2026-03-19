import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { formatCurrency, formatNumberWithDots } from "../../constants/formatters";
import storage from "../../constants/storage";

type Solicitud = {
  id?: number | string;
  tipo_servicio?: string;
  problema?: string;
  estado?: string;
  vehiculo?: {
    marca?: string;
    modelo?: string;
    placa?: string;
  };
  cliente?: {
    nombre?: string;
  };
  cotizacion?: {
    proveedor_id?: number | string | null;
    marca?: string | null;
    referencia?: string | null;
    garantia?: string | null;
    disponibilidad?: string | null;
    precio?: string | null;
    observacion?: string | null;
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

export default function ProviderDashboardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const isMobile = width < 900;
  const [providerName, setProviderName] = useState("Proveedor");
  const [selectedSection, setSelectedSection] = useState("Cotizaciones");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null);
  const [quoteForms, setQuoteForms] = useState<QuoteFormState[]>([emptyForm()]);
  const [returningQuoteId, setReturningQuoteId] = useState<string | null>(null);
  const [returnComment, setReturnComment] = useState("");

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
      if (name) setProviderName(name);
    };

    loadUser();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      cargarSolicitudes();
      cargarNotificaciones();
    }, [])
  );

  useEffect(() => {
    if (!isMobile) {
      setMenuOpen(false);
    }
  }, [isMobile]);

  const cotizaciones = useMemo(
    () => solicitudes.filter((item) => (item.estado || "").toLowerCase() === "cotizando"),
    [solicitudes]
  );

  const pedidos = useMemo(
    () =>
      solicitudes.filter((item) =>
        ["asignada", "diagnostico", "esperando_repuestos", "en_reparacion", "pruebas"].includes(
          (item.estado || "").toLowerCase()
        )
      ),
    [solicitudes]
  );

  const entregas = useMemo(
    () =>
      solicitudes.filter((item) =>
        ["cotizado", "finalizado", "devuelto_proveedor"].includes((item.estado || "").toLowerCase())
      ),
    [solicitudes]
  );

  const unreadNotifications = useMemo(
    () => notificaciones.filter((item) => !item.leida).length,
    [notificaciones]
  );

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
    const estado = (solicitud?.estado || "").toLowerCase();

    setShowNotifications(false);
    setSelectedSection(estado === "cotizado" || estado === "finalizado" ? "Historial" : "Cotizaciones");

    if (solicitud) {
      abrirFormularioCotizacion(solicitud);
    }

    setNotificaciones((current) =>
      current.map((notification) =>
        notification.id === item.id ? { ...notification, leida: true } : notification
      )
    );
  };

  const enviarCotizacion = async (solicitudId: string | number | undefined) => {
    if (solicitudId == null) return;

    const camposVacios = quoteForms.some((form) =>
      Object.entries(form).some(([, value]) => !value.trim())
    );
    if (camposVacios) {
      Alert.alert("Campos requeridos", "Debes completar todos los campos de la cotizacion.");
      return;
    }

    const payload = {
      marca: quoteForms.map((item) => item.marca.trim()).join(" | "),
      referencia: quoteForms.map((item) => item.referencia.trim()).join(" | "),
      garantia: quoteForms.map((item) => item.garantia.trim()).join(" | "),
      disponibilidad: quoteForms.map((item) => item.disponibilidad.trim()).join(" | "),
      precio: quoteForms.map((item) => item.precio.trim()).join(" | "),
      observacion: quoteForms.map((item) => item.observacion.trim()).join(" | "),
    };

    try {
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
      await cargarSolicitudes();
      Alert.alert("Enviado", "La cotizacion fue enviada al administrador.");
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
    } catch (error) {
      console.log("Error devolviendo solicitud", error);
      Alert.alert("Error", "No se pudo conectar con el servidor");
    }
  };

  const renderStatus = (estado?: string) => {
    const normalized = (estado || "").toLowerCase();

    if (normalized === "cotizado") {
      return {
        label: "Cotizado",
        containerStyle: styles.statusPillSuccess,
        textStyle: styles.statusTextSuccess,
      };
    }

    if (normalized === "devuelto_proveedor") {
      return {
        label: "Devuelto por el proveedor",
        containerStyle: styles.statusPillReturned,
        textStyle: styles.statusTextReturned,
      };
    }

    return {
      label: "Cotizacion",
      containerStyle: styles.statusPillPending,
      textStyle: styles.statusTextPending,
    };
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
                    <Text style={styles.notificationItemText}>{item.mensaje || ""}</Text>
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
              <Text style={styles.panelTitle}>Cotizaciones</Text>
              {cotizaciones.length > 0 ? (
                cotizaciones.map((item) => {
                  const statusInfo = renderStatus(item.estado);
                  const isExpanded = expandedQuoteId === String(item.id);
                  const isQuoted = (item.estado || "").toLowerCase() === "cotizado";

                  return (
                    <View key={String(item.id)} style={styles.orderCard}>
                      <TouchableOpacity
                        activeOpacity={0.95}
                        onPress={() => alternarFormularioCotizacion(item)}
                      >
                        <View style={styles.orderHeader}>
                          <Text style={styles.orderTitle}>Cotizacion #{item.id}</Text>
                          <View style={[styles.statusPill, statusInfo.containerStyle]}>
                            <Text style={[styles.statusText, statusInfo.textStyle]}>
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
                        <Text style={styles.orderText}>
                          Servicio: {item.tipo_servicio || "Sin servicio"}
                        </Text>
                        <Text style={styles.orderText}>
                          Problema: {item.problema || "Sin descripcion"}
                        </Text>
                      </TouchableOpacity>

                      {isExpanded ? (
                        <View style={styles.quoteFormCard}>
                          <Text style={styles.quoteFormTitle}>Responder cotizacion</Text>

                          {quoteForms.map((form, index) => (
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
                          ))}

                          {!isQuoted ? (
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
              <Text style={styles.panelTitle}>Pedidos</Text>
              {pedidos.length > 0 ? (
                pedidos.map((item) => (
                  <View key={String(item.id)} style={styles.orderCard}>
                    <Text style={styles.orderTitle}>Pedido #{item.id}</Text>
                    <Text style={styles.orderText}>Cliente: {item.cliente?.nombre || "Cliente"}</Text>
                    <Text style={styles.orderText}>
                      Vehiculo: {item.vehiculo?.marca || ""} {item.vehiculo?.modelo || ""}
                    </Text>
                    <Text style={styles.orderText}>Servicio: {item.tipo_servicio || "Sin servicio"}</Text>
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
                <Text style={styles.panelTitle}>Historial</Text>
                {entregas.length > 0 ? (
                  entregas.map((item) => (
                    <View key={String(item.id)} style={styles.orderCard}>
                      <View style={styles.orderHeader}>
                        <Text style={styles.orderTitle}>Registro #{item.id}</Text>
                        <View
                          style={[
                            styles.statusPill,
                            (item.estado || "").toLowerCase() === "devuelto_proveedor"
                              ? styles.statusPillReturned
                              : styles.statusPillSuccess,
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusText,
                              (item.estado || "").toLowerCase() === "devuelto_proveedor"
                                ? styles.statusTextReturned
                                : styles.statusTextSuccess,
                            ]}
                          >
                            {(item.estado || "").toLowerCase() === "cotizado"
                              ? "Cotizado"
                              : (item.estado || "").toLowerCase() === "devuelto_proveedor"
                                ? "Devuelto"
                                : "Finalizado"}
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
    backgroundColor: "#f8fbff",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e6edf6",
    marginTop: 12,
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
    paddingVertical: 6,
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
  returnBlock: {
    marginTop: 6,
    gap: 10,
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
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
});
