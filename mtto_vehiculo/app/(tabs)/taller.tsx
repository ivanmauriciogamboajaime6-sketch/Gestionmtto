import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../../constants/api";
import storage from "../../constants/storage";

type Solicitud = {
  id?: number | string;
  vehiculo?: {
    marca?: string;
    modelo?: string;
    placa?: string;
  };
  cliente?: {
    nombre?: string;
  };
  tipo_servicio?: string;
  problema?: string;
  estado?: string;
};

type KanbanCard = {
  id: string;
  estado: "diagnostico" | "repuestos" | "intervencion" | "listos";
  vehiculo: string;
  placa: string;
  cliente?: string;
  problema?: string;
  repuestos?: string[];
  proveedor?: string;
  entrega?: string;
  trabajo?: string;
  mecanico?: string;
  costo?: string;
  accion: string;
};

const menuItems = [
  { label: "Vista general", icon: "view-dashboard-outline", active: true },
  { label: "Recepcion", icon: "car-arrow-right" },
  { label: "Diagnostico", icon: "stethoscope" },
  { label: "Reparaciones", icon: "tools" },
  { label: "Repuestos", icon: "package-variant-closed" },
  { label: "Facturacion", icon: "receipt-text-outline" },
  { label: "Historial", icon: "history" },
  { label: "Configuracion", icon: "cog-outline" },
];

const mechanics = [
  { name: "Carlos Ruiz", vehicles: 2, color: "#ff8a3d" },
  { name: "Pedro Gomez", vehicles: 1, color: "#1e88e5" },
  { name: "Luis Herrera", vehicles: 3, color: "#23b26d" },
];

const spareParts = [
  "Bomba gasolina",
  "Filtro aire",
  "Pastillas freno",
  "Sensor oxigeno",
];

const fallbackBoard: KanbanCard[] = [
  {
    id: "diag-1",
    estado: "diagnostico",
    vehiculo: "Mazda 3",
    placa: "KHT234",
    cliente: "Juan Perez",
    problema: "Ruido suspension",
    accion: "Diagnosticar",
  },
  {
    id: "rep-1",
    estado: "repuestos",
    vehiculo: "Toyota Hilux",
    placa: "JKS882",
    repuestos: ["Pastillas freno", "Disco freno"],
    proveedor: "AutoParts SAS",
    entrega: "Manana",
    accion: "Ver repuestos",
  },
  {
    id: "int-1",
    estado: "intervencion",
    vehiculo: "Chevrolet Spark",
    placa: "LMT901",
    trabajo: "Cambio embrague",
    mecanico: "Carlos Ruiz",
    accion: "Ver avance",
  },
  {
    id: "listo-1",
    estado: "listos",
    vehiculo: "Nissan Frontier",
    placa: "MND345",
    trabajo: "Trabajo finalizado",
    costo: "$850.000",
    accion: "Entregar vehiculo",
  },
];

const columns = [
  { key: "diagnostico", title: "Diagnostico", accent: "#ff8a3d" },
  { key: "repuestos", title: "Esperando repuestos", accent: "#f4b400" },
  { key: "intervencion", title: "En intervencion", accent: "#1e88e5" },
  { key: "listos", title: "Listos", accent: "#23b26d" },
] as const;

function normalizeEstado(estado?: string): KanbanCard["estado"] {
  const value = (estado || "").toLowerCase();

  if (value.includes("repuesto")) return "repuestos";
  if (value.includes("repar") || value.includes("interv")) return "intervencion";
  if (value.includes("listo") || value.includes("entrega")) return "listos";
  return "diagnostico";
}

function mapSolicitudesToBoard(solicitudes: Solicitud[]): KanbanCard[] {
  return solicitudes.map((s, index) => ({
    id: String(s.id ?? `sol-${index}`),
    estado: normalizeEstado(s.estado),
    vehiculo: [s.vehiculo?.marca, s.vehiculo?.modelo].filter(Boolean).join(" ") || "Vehiculo sin nombre",
    placa: s.vehiculo?.placa || "Sin placa",
    cliente: s.cliente?.nombre || "Cliente pendiente",
    problema: s.problema || s.tipo_servicio || "Revision general",
    trabajo: s.tipo_servicio || "Servicio en proceso",
    accion: normalizeEstado(s.estado) === "listos" ? "Entregar vehiculo" : "Ver detalle",
  }));
}

export default function TallerDashboard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 900;
  const boardColumnWidth = isMobile ? Math.max(width - 72, 260) : 280;
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [tallerName, setTallerName] = useState("Taller");

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
    if (Platform.OS === "web") {
      window.location.href = "/";
      return;
    }
    router.replace("/");
  };

  useEffect(() => {
    cargarSolicitudes();
  }, []);

  const cargarSolicitudes = async () => {
    try {
      const storedName = await storage.getItem("user_name");
      const token = await storage.getItem("token");

      if (storedName) {
        setTallerName(storedName);
      }

      const response = await fetch(`${API_BASE_URL}/solicitudes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (Array.isArray(data)) {
        setSolicitudes(data);
      } else if (Array.isArray(data?.solicitudes)) {
        setSolicitudes(data.solicitudes);
      } else {
        console.log("Respuesta inesperada en /solicitudes", data);
        setSolicitudes([]);
      }
    } catch (error) {
      console.log("error cargando solicitudes", error);
      setSolicitudes([]);
    }
  };

  const actualizarEstadoSolicitud = async (solicitudId: string, estado: string) => {
    try {
      const token = await storage.getItem("token");

      const response = await fetch(`${API_BASE_URL}/solicitudes/${solicitudId}/estado`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ estado }),
      });

      const data = await response.json();

      if (!response.ok) {
        Alert.alert("Error", data.detail || "No se pudo actualizar la solicitud");
        return;
      }

      await cargarSolicitudes();
    } catch (error) {
      console.log("error actualizando solicitud", error);
      Alert.alert("Error", "No se pudo conectar al servidor");
    }
  };

  const assignedSolicitudes = solicitudes.filter(
    (item) => (item.estado || "").toLowerCase() !== "pendiente"
  );

  const liveBoard = mapSolicitudesToBoard(assignedSolicitudes);
  const board = liveBoard.length > 0 ? liveBoard : fallbackBoard;
  const pendingRequests = assignedSolicitudes.filter((item) =>
    ["diagnostico", "asignada"].includes((item.estado || "").toLowerCase())
  );

  const resumen = {
    vehiculosHoy: 12,
    diagnostico: board.filter((item) => item.estado === "diagnostico").length,
    reparacion: board.filter((item) => item.estado === "intervencion").length,
    repuestos: board.filter((item) => item.estado === "repuestos").length,
    listos: board.filter((item) => item.estado === "listos").length,
  };

  const indicadores = [
    { label: "Servicios hoy", value: "12", icon: "car-wrench", color: "#1e88e5" },
    { label: "Tiempo promedio", value: "6h", icon: "clock-outline", color: "#ff8a3d" },
    { label: "Entregados", value: "7", icon: "check-decagram-outline", color: "#23b26d" },
    { label: "Ingresos", value: "$4.500.000", icon: "cash-multiple", color: "#8e24aa" },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={[styles.layout, isMobile && styles.layoutMobile]}>
        <View style={[styles.sidebar, isMobile && styles.sidebarMobile]}>
          <View style={styles.sidebarHeader}>
            <View style={styles.logoBox}>
              <MaterialCommunityIcons name="car-cog" size={24} color="#fff" />
            </View>
            <View>
              <Text style={styles.sidebarEyebrow}>Taller</Text>
              <Text style={styles.sidebarTitle}>RenovAutos</Text>
            </View>
          </View>

          <Text style={styles.sidebarWelcome}>Bienvenido</Text>

          {menuItems.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.menuItem, item.active && styles.menuItemActive]}
            >
              <MaterialCommunityIcons
                name={item.icon as any}
                size={20}
                color={item.active ? "#08121f" : "#c2cbe0"}
              />
              <Text style={[styles.menuText, item.active && styles.menuTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.logoutButton} onPress={cerrarSesion}>
            <MaterialCommunityIcons name="logout" size={20} color="#ffb4a8" />
            <Text style={styles.logoutButtonText}>Cerrar sesion</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.main}>
          <View style={[styles.hero, isMobile && styles.heroMobile]}>
            <View>
              <Text style={styles.greeting}>Buenos dias</Text>
              <Text style={styles.tallerName}>{tallerName}</Text>
              <Text style={styles.heroSubtitle}>
                Controla la operacion del taller, los vehiculos activos y el avance del dia.
              </Text>
            </View>

            <View style={styles.heroBadge}>
              <MaterialCommunityIcons name="garage-open" size={20} color="#ff8a3d" />
              <Text style={styles.heroBadgeText}>Operacion en curso</Text>
            </View>
          </View>

          <View style={styles.quickStats}>
            <StatCard label="Vehiculos hoy" value={String(resumen.vehiculosHoy)} color="#1e88e5" isMobile={isMobile} />
            <StatCard label="En diagnostico" value={String(resumen.diagnostico)} color="#ff8a3d" isMobile={isMobile} />
            <StatCard label="En reparacion" value={String(resumen.reparacion)} color="#23b26d" isMobile={isMobile} />
            <StatCard label="Esperando repuestos" value={String(resumen.repuestos)} color="#f4b400" isMobile={isMobile} />
            <StatCard label="Listos para entrega" value={String(resumen.listos)} color="#7b61ff" isMobile={isMobile} />
          </View>

          <View style={styles.panel}>
            <View style={[styles.sectionHeader, isMobile && styles.sectionHeaderMobile]}>
              <Text style={styles.sectionTitle}>Nuevas solicitudes</Text>
              <Text style={styles.sectionCaption}>{pendingRequests.length} pendientes</Text>
            </View>

            {pendingRequests.length === 0 ? (
              <Text style={styles.emptyColumnText}>No hay solicitudes nuevas en este momento.</Text>
            ) : (
              pendingRequests.map((item, index) => (
                <View key={String(item.id ?? index)} style={styles.requestCard}>
                  <Text style={styles.requestOrder}>Orden #{item.id}</Text>
                  <Text style={styles.requestText}>Cliente: {item.cliente?.nombre || "Sin nombre"}</Text>
                  <Text style={styles.requestText}>
                    Vehiculo: {item.vehiculo?.marca} {item.vehiculo?.modelo}
                  </Text>
                  <Text style={styles.requestText}>Problema: {item.problema || "Sin descripcion"}</Text>

                  <View style={styles.requestActions}>
                    <TouchableOpacity style={styles.secondaryActionButton}>
                      <Text style={styles.secondaryActionText}>Ver detalle</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={() => actualizarEstadoSolicitud(String(item.id), "diagnostico")}
                    >
                      <Text style={styles.acceptButtonText}>Tomar orden</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.rejectButton}
                      onPress={() => actualizarEstadoSolicitud(String(item.id), "pendiente")}
                    >
                      <Text style={styles.rejectButtonText}>Devolver</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={[styles.sectionHeader, isMobile && styles.sectionHeaderMobile]}>
            <Text style={styles.sectionTitle}>Tablero Kanban</Text>
            <Text style={styles.sectionCaption}>Flujo de trabajo por estado</Text>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
            {columns.map((column) => {
              const items = board.filter((item) => item.estado === column.key);

              return (
                <View key={column.key} style={[styles.column, { width: boardColumnWidth }]}>
                  <View style={styles.columnHeader}>
                    <View style={[styles.columnDot, { backgroundColor: column.accent }]} />
                    <Text style={styles.columnTitle}>{column.title}</Text>
                    <Text style={styles.columnCount}>{items.length}</Text>
                  </View>

                  {items.length === 0 ? (
                    <View style={styles.emptyColumn}>
                      <Text style={styles.emptyColumnText}>Sin vehiculos</Text>
                    </View>
                  ) : (
                    items.map((item) => <KanbanVehicleCard key={item.id} item={item} accent={column.accent} />)
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.bottomGrid, isMobile && styles.bottomGridMobile]}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Mecanicos activos</Text>
              {mechanics.map((mechanic) => (
                <View key={mechanic.name} style={styles.mechanicRow}>
                  <View style={[styles.avatar, { backgroundColor: mechanic.color }]}>
                    <Text style={styles.avatarText}>{mechanic.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.mechanicInfo}>
                    <Text style={styles.mechanicName}>{mechanic.name}</Text>
                    <Text style={styles.mechanicVehicles}>{mechanic.vehicles} vehiculos</Text>
                  </View>
                  <MaterialCommunityIcons name="wrench" size={20} color={mechanic.color} />
                </View>
              ))}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Repuestos pendientes</Text>
              <Text style={styles.pendingCounter}>4 pendientes</Text>
              {spareParts.map((part) => (
                <View key={part} style={styles.partRow}>
                  <MaterialCommunityIcons name="package-variant" size={18} color="#f4b400" />
                  <Text style={styles.partText}>{part}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Indicadores del taller</Text>
            <View style={styles.indicatorGrid}>
              {indicadores.map((item) => (
                <View key={item.label} style={styles.indicatorCard}>
                  <View style={[styles.indicatorIcon, { backgroundColor: `${item.color}18` }]}>
                    <MaterialCommunityIcons name={item.icon as any} size={22} color={item.color} />
                  </View>
                  <Text style={styles.indicatorValue}>{item.value}</Text>
                  <Text style={styles.indicatorLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function StatCard({
  label,
  value,
  color,
  isMobile,
}: {
  label: string;
  value: string;
  color: string;
  isMobile: boolean;
}) {
  return (
    <View style={[styles.statCard, isMobile && styles.statCardMobile]}>
      <View style={[styles.statBar, { backgroundColor: color }]} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function KanbanVehicleCard({
  item,
  accent,
}: {
  item: KanbanCard;
  accent: string;
}) {
  return (
    <View style={styles.kanbanCard}>
      <View style={[styles.kanbanAccent, { backgroundColor: accent }]} />
      <Text style={styles.vehicleName}>{item.vehiculo}</Text>
      <Text style={styles.plate}>Placa: {item.placa}</Text>

      {item.cliente ? <Text style={styles.cardText}>Cliente: {item.cliente}</Text> : null}
      {item.problema ? <Text style={styles.cardText}>Problema: {item.problema}</Text> : null}
      {item.trabajo ? <Text style={styles.cardText}>Trabajo: {item.trabajo}</Text> : null}
      {item.mecanico ? <Text style={styles.cardText}>Mecanico: {item.mecanico}</Text> : null}

      {item.repuestos?.length ? (
        <View style={styles.chips}>
          {item.repuestos.map((part) => (
            <View key={part} style={styles.chip}>
              <Text style={styles.chipText}>{part}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {item.proveedor ? <Text style={styles.cardSubtle}>Proveedor: {item.proveedor}</Text> : null}
      {item.entrega ? <Text style={styles.cardSubtle}>Entrega: {item.entrega}</Text> : null}
      {item.costo ? <Text style={styles.cardSubtle}>Costo total: {item.costo}</Text> : null}

      <TouchableOpacity style={styles.actionButton}>
        <Text style={styles.actionText}>{item.accion}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#eef3f9",
  },
  screenContent: {
    padding: 20,
  },
  layout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 18,
  },
  layoutMobile: {
    flexDirection: "column",
  },
  sidebar: {
    width: 220,
    backgroundColor: "#08121f",
    borderRadius: 28,
    padding: 20,
  },
  sidebarMobile: {
    width: "100%",
  },
  sidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 22,
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
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  menuItemActive: {
    backgroundColor: "#dfe9f7",
  },
  menuText: {
    color: "#c2cbe0",
    fontSize: 15,
    fontWeight: "500",
  },
  menuTextActive: {
    color: "#08121f",
    fontWeight: "700",
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
  main: {
    flex: 1,
    gap: 18,
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
    flexDirection: "column",
    gap: 16,
  },
  greeting: {
    color: "#7a8699",
    fontSize: 16,
    marginBottom: 6,
  },
  tallerName: {
    color: "#08121f",
    fontSize: 32,
    fontWeight: "800",
  },
  heroSubtitle: {
    color: "#5f6b7c",
    maxWidth: 560,
    marginTop: 8,
    lineHeight: 22,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff2e8",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  heroBadgeText: {
    color: "#9b4b14",
    fontWeight: "700",
  },
  quickStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
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
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionHeaderMobile: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#08121f",
  },
  sectionCaption: {
    color: "#7a8699",
  },
  board: {
    gap: 14,
    paddingBottom: 4,
  },
  column: {
    width: 280,
    backgroundColor: "#f8fbff",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  columnDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 8,
  },
  columnTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#08121f",
  },
  columnCount: {
    color: "#7a8699",
    fontWeight: "700",
  },
  emptyColumn: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  emptyColumnText: {
    color: "#8a94a6",
  },
  kanbanCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  kanbanAccent: {
    width: 52,
    height: 6,
    borderRadius: 999,
    marginBottom: 14,
  },
  vehicleName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#08121f",
  },
  plate: {
    color: "#5f6b7c",
    marginTop: 4,
    marginBottom: 8,
  },
  cardText: {
    color: "#2f3a49",
    marginTop: 4,
  },
  cardSubtle: {
    color: "#6b778a",
    marginTop: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  chip: {
    backgroundColor: "#eef3f9",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    color: "#425066",
    fontSize: 12,
    fontWeight: "600",
  },
  actionButton: {
    marginTop: 14,
    backgroundColor: "#08121f",
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: 12,
  },
  actionText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  bottomGrid: {
    flexDirection: "row",
    gap: 18,
  },
  bottomGridMobile: {
    flexDirection: "column",
  },
  panel: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "#dbe4f0",
    flex: 1,
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#08121f",
    marginBottom: 14,
  },
  mechanicRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  mechanicInfo: {
    flex: 1,
    marginLeft: 12,
  },
  mechanicName: {
    color: "#08121f",
    fontWeight: "700",
  },
  mechanicVehicles: {
    color: "#6b778a",
    marginTop: 2,
  },
  pendingCounter: {
    color: "#f4b400",
    fontWeight: "800",
    marginBottom: 12,
  },
  partRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  partText: {
    color: "#2f3a49",
  },
  indicatorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  indicatorCard: {
    minWidth: 180,
    flexGrow: 1,
    backgroundColor: "#f8fbff",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  indicatorIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  indicatorValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#08121f",
  },
  indicatorLabel: {
    color: "#6b778a",
    marginTop: 6,
  },
  requestCard: {
    marginTop: 14,
    backgroundColor: "#f8fbff",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e6edf6",
  },
  requestOrder: {
    color: "#08121f",
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 8,
  },
  requestText: {
    color: "#425066",
    marginTop: 4,
  },
  requestActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    flexWrap: "wrap",
  },
  secondaryActionButton: {
    backgroundColor: "#eef3f9",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryActionText: {
    color: "#08121f",
    fontWeight: "700",
  },
  acceptButton: {
    backgroundColor: "#23b26d",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  acceptButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  rejectButton: {
    backgroundColor: "#fee2e2",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rejectButtonText: {
    color: "#b91c1c",
    fontWeight: "700",
  },
});
