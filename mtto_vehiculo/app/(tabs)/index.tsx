import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
  problema?: string;
  estado?: string;
  vehiculo?: {
    id?: number | string;
    marca?: string;
    modelo?: string;
    placa?: string;
  };
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
  "Mis vehiculos",
  "Mis servicios",
  "Pagos",
  "Historial",
  "Soporte",
  "Configuracion",
];

const sectionIcons: Record<string, string> = {
  "Vista general": "view-dashboard-outline",
  "Mis vehiculos": "car-outline",
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
  const [userName, setUserName] = useState("Usuario");
  const [selectedSection, setSelectedSection] = useState("Mis vehiculos");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [newKilometraje, setNewKilometraje] = useState("");

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

      if (response.status === 401 || solicitudesResponse.status === 401) {
        await cerrarSesion();
        return;
      }

      const data = await response.json();
      const solicitudesData = await solicitudesResponse.json();
      const items = Array.isArray(data) ? data : [];
      setVehiculos(items);
      setSolicitudes(Array.isArray(solicitudesData) ? solicitudesData : []);

      if (items[0]?.id != null) {
        if (!selectedVehicleId || !items.some((item) => String(item.id) === String(selectedVehicleId))) {
          setSelectedVehicleId(String(items[0].id));
          setNewKilometraje(String(items[0].kilometraje ?? ""));
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
    (item) => ["pendiente", "cotizando"].includes((item.estado || "").toLowerCase())
  ).length;
  const solicitudesProceso = solicitudes.filter((item) =>
    ["diagnostico", "esperando_repuestos", "en_reparacion", "pruebas"].includes(
      (item.estado || "").toLowerCase()
    )
  ).length;
  const solicitudesFinalizadas = solicitudes.filter(
    (item) => (item.estado || "").toLowerCase() === "finalizado"
  ).length;

  const normalizarTexto = (value?: string) =>
    (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

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
      const estado = (item.estado || "").toLowerCase();
      const servicio = normalizarTexto(item.tipo_servicio);
      return (
        String(item.vehiculo?.id) === String(vehicleId) &&
        ["pendiente", "cotizando"].includes(estado) &&
        palabrasClave.some((palabra) => servicio.includes(palabra))
      );
    });
  };

  const eliminarVehiculo = async (vehicleId: string | number) => {
    try {
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
    } catch (error) {
      console.log("Error eliminando vehiculo", error);
      alert("Error eliminando el vehiculo");
    }
  };

  const confirmarEliminacion = (vehicle: Vehiculo) => {
    const vehicleName = `${vehicle.marca ?? ""} ${vehicle.modelo ?? ""}`.trim() || "este vehiculo";

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
    setNewKilometraje(String(vehicle.kilometraje ?? ""));
  };

  const guardarKilometraje = async (vehicleId: string | number) => {
    const value = Number(newKilometraje);

    if (isNaN(value)) {
      alert("El kilometraje debe ser numerico");
      return;
    }

    try {
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
          descripcion: `Solicitud rapida de ${serviceTitle.replace("\n", " ")} para ${vehicle.marca} ${vehicle.modelo} placa ${vehicle.placa}.`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert("No se pudo crear la solicitud" + (data?.detail ? `: ${data.detail}` : ""));
        return;
      }

      await cargarDatos();
      setSelectedSection("Mis servicios");
      alert("Solicitud enviada al administrador correctamente");
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
                  <Text style={styles.kmValue}>{item.kilometraje} km</Text>

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
                        onChangeText={setNewKilometraje}
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
                  <Text style={styles.gaugeText}>{item.kilometraje} km</Text>
                  <MaterialCommunityIcons name="car-sports" size={42} color="#4a7dff" />
                </View>
              </View>
            </TouchableOpacity>

            {selected ? (
              <View style={styles.expandedPanel}>
                <View style={styles.servicesGrid}>
                  {dashboardServices.map((service) => {
                    const isBlocked =
                      !!service.quickRequest &&
                      tieneSolicitudPendientePorServicio(item.id, service.title);

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
                          <Text style={styles.serviceDisabledHint}>En cotizacion</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.deleteVehicleButton}
                    onPress={() => confirmarEliminacion(item)}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color="#dc2626" />
                    <Text style={styles.deleteVehicleText}>Eliminar vehiculo</Text>
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

  const renderEstadoServicio = (estado?: string) => {
    const normalizado = (estado || "").toLowerCase();

    if (normalizado === "pendiente" || normalizado === "cotizando") {
      return { label: "Cotizacion", backgroundColor: "#fff7d6", color: "#b7791f" };
    }

    if (normalizado === "diagnostico") {
      return { label: "Diagnostico", backgroundColor: "#e0f2fe", color: "#0369a1" };
    }

    if (normalizado === "esperando_repuestos") {
      return { label: "Esperando repuestos", backgroundColor: "#ede9fe", color: "#6d28d9" };
    }

    if (normalizado === "en_reparacion") {
      return { label: "En reparacion", backgroundColor: "#dcfce7", color: "#15803d" };
    }

    if (normalizado === "pruebas") {
      return { label: "Pruebas", backgroundColor: "#e0f2fe", color: "#1d4ed8" };
    }

    if (normalizado === "finalizado") {
      return { label: "Finalizado", backgroundColor: "#dcfce7", color: "#166534" };
    }

    return { label: estado || "Cotizacion", backgroundColor: "#eef2ff", color: "#3730a3" };
  };

  const renderServicesSection = () => {
    if (solicitudes.length === 0) {
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
        {solicitudes.map((item) => {
          const estadoInfo = renderEstadoServicio(item.estado);

          return (
            <View key={String(item.id)} style={styles.serviceRequestCard}>
              <View style={styles.serviceRequestHeader}>
                <View>
                  <Text style={styles.serviceRequestTitle}>
                    {item.tipo_servicio || "Servicio solicitado"}
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

              <Text style={styles.serviceRequestDescription}>
                {item.problema || "Solicitud enviada al administrador para revision."}
              </Text>

              <Text style={styles.serviceRequestMeta}>Orden #{item.id}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
                  <TouchableOpacity
                    key={section}
                    style={[
                      styles.sidebarItem,
                      selectedSection === section && styles.sidebarItemActive,
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
                  </TouchableOpacity>
                ))}

              </View>
            ) : null}
          </View>

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

                <View style={styles.headerActions}>
                  <TouchableOpacity style={styles.bellButton}>
                    <MaterialCommunityIcons name="bell-outline" size={24} color="#2563eb" />
                    <View style={styles.notificationBadge}>
                      <Text style={styles.notificationText}>{solicitudesCotizacion}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.quickStats}>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#2f8fff" }]} />
                  <Text style={styles.statValue}>{totalVehiculos}</Text>
                  <Text style={styles.statLabel}>Mis vehiculos</Text>
                </View>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#ff8a3d" }]} />
                  <Text style={styles.statValue}>{solicitudesCotizacion}</Text>
                  <Text style={styles.statLabel}>En cotizacion</Text>
                </View>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#23b26d" }]} />
                  <Text style={styles.statValue}>{solicitudesProceso}</Text>
                  <Text style={styles.statLabel}>En proceso</Text>
                </View>
                <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
                  <View style={[styles.statBar, { backgroundColor: "#7b61ff" }]} />
                  <Text style={styles.statValue}>{solicitudesFinalizadas}</Text>
                  <Text style={styles.statLabel}>Finalizados</Text>
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
                  onPress={() => setSelectedSection("Mis vehiculos")}
                >
                  <Text style={styles.dashboardHeroButtonText}>Ir a Mis vehiculos</Text>
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
                    {selectedVehicle?.kilometraje != null ? `${selectedVehicle.kilometraje} km` : "--"}
                  </Text>
                </View>
                <View style={[styles.summaryCard, isMobile && styles.summaryCardMobile]}>
                  <Text style={styles.summaryLabel}>Servicios solicitados</Text>
                  <Text style={styles.summaryValue}>{solicitudes.length}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {selectedSection === "Mis vehiculos" ? (
            <>
              <View style={[styles.vehiclesHeader, isMobile && styles.vehiclesHeaderMobile]}>
                <Text style={styles.vehiclesSectionTitle}>Mis vehiculos</Text>
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
            ? renderPlaceholderSection(
                "Pagos",
                "Esta seccion mostrara pagos pendientes, recibidos y facturas.",
                "credit-card-outline"
              )
            : null}
          {selectedSection === "Historial"
            ? renderPlaceholderSection(
                "Historial",
                "Aqui podras consultar el historial de servicios realizados a tus vehiculos.",
                "history"
              )
            : null}
          {selectedSection === "Soporte"
            ? renderPlaceholderSection(
                "Soporte",
                "Esta area servira para ayuda, contacto y seguimiento de casos.",
                "lifebuoy"
              )
            : null}
          {selectedSection === "Configuracion"
            ? renderPlaceholderSection(
                "Configuracion",
                "Aqui podras ajustar preferencias, perfil y notificaciones.",
                "cog-outline"
              )
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
    gap: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sidebarItemActive: {
    backgroundColor: "#dfe9f7",
  },
  sidebarItemText: {
    color: "#c2cbe0",
    fontSize: 15,
    fontWeight: "600",
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
  serviceRequestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  serviceRequestHeaderMobile: {
    flexDirection: "column",
  },
  serviceRequestTitle: {
    color: "#102447",
    fontSize: 18,
    fontWeight: "800",
  },
  serviceRequestVehicle: {
    color: "#64748b",
    marginTop: 6,
    fontWeight: "600",
  },
  serviceStatusPill: {
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
});
