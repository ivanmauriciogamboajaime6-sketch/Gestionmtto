import React, { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE_URL } from "../../constants/api";
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
};

const providerSections = [
  "Vista general",
  "Cotizaciones",
  "Pedidos",
  "Historial",
  "Configuracion",
];

export default function ProviderDashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 900;
  const [providerName, setProviderName] = useState("Proveedor");
  const [selectedSection, setSelectedSection] = useState("Vista general");
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);

  useEffect(() => {
    const loadUser = async () => {
      const name = await storage.getItem("user_name");
      if (name) setProviderName(name);
    };

    loadUser();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
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

      cargarSolicitudes();
    }, [])
  );

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

  const cotizaciones = useMemo(
    () => solicitudes.filter((item) => (item.estado || "").toLowerCase() === "cotizando"),
    [solicitudes]
  );

  const pedidos = cotizaciones;

  const renderPlaceholder = (title: string, text: string) => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.panelText}>{text}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.sidebar, isMobile && styles.sidebarMobile]}>
        <View style={styles.brand}>
          <View style={styles.logoBox}>
            <MaterialCommunityIcons name="truck-delivery-outline" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.eyebrow}>PROVEEDOR</Text>
            <Text style={styles.brandTitle}>{providerName}</Text>
          </View>
        </View>

        <Text style={styles.sideWelcome}>Bienvenido</Text>

        {providerSections.map((item, index) => {
          const active = selectedSection === item;
          return (
            <TouchableOpacity
              key={item}
              style={[styles.sideItem, active && styles.sideItemActive]}
              onPress={() => setSelectedSection(item)}
            >
              <MaterialCommunityIcons
                name={(index === 0 ? "view-dashboard-outline" : "clipboard-list-outline") as any}
                size={20}
                color={active ? "#08121f" : "#c2cbe0"}
              />
              <Text style={[styles.sideText, active && styles.sideTextActive]}>{item}</Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity style={styles.logoutButton} onPress={cerrarSesion}>
          <MaterialCommunityIcons name="logout" size={20} color="#ffb4a8" />
          <Text style={styles.logoutButtonText}>Cerrar sesion</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.main}>
        <View style={[styles.hero, isMobile && styles.heroMobile]}>
          <Text style={styles.greeting}>Buenos dias</Text>
          <Text style={styles.title}>{providerName}</Text>
          <Text style={styles.subtitle}>
            Gestiona cotizaciones, pedidos y seguimiento de repuestos desde tu panel de proveedor.
          </Text>
        </View>

        <View style={styles.cardGrid}>
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            <Text style={styles.cardValue}>{cotizaciones.length}</Text>
            <Text style={styles.cardLabel}>Cotizaciones nuevas</Text>
          </View>
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            <Text style={styles.cardValue}>{pedidos.length}</Text>
            <Text style={styles.cardLabel}>Pedidos en proceso</Text>
          </View>
          <View style={[styles.card, isMobile && styles.cardMobile]}>
            <Text style={styles.cardValue}>
              {solicitudes.filter((item) => (item.estado || "").toLowerCase() === "finalizado").length}
            </Text>
            <Text style={styles.cardLabel}>Entregas completadas</Text>
          </View>
        </View>

        {selectedSection === "Vista general" ? (
          renderPlaceholder(
            "Vista general de proveedor",
            "Aqui veras el resumen de solicitudes enviadas por el administrador y su estado actual."
          )
        ) : null}

        {selectedSection === "Cotizaciones" || selectedSection === "Pedidos" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{selectedSection}</Text>
            {pedidos.length > 0 ? (
              pedidos.map((item) => (
                <View key={String(item.id)} style={styles.orderCard}>
                  <View style={styles.orderHeader}>
                    <Text style={styles.orderTitle}>Orden #{item.id}</Text>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusText}>Cotizando</Text>
                    </View>
                  </View>
                  <Text style={styles.orderText}>Cliente: {item.cliente?.nombre || "Cliente"}</Text>
                  <Text style={styles.orderText}>
                    Vehiculo: {item.vehiculo?.marca || ""} {item.vehiculo?.modelo || ""}
                  </Text>
                  <Text style={styles.orderText}>Placa: {item.vehiculo?.placa || "N/A"}</Text>
                  <Text style={styles.orderText}>Servicio: {item.tipo_servicio || "Sin servicio"}</Text>
                  <Text style={styles.orderText}>
                    Problema: {item.problema || "Sin descripcion"}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.panelText}>No hay solicitudes enviadas por el administrador.</Text>
            )}
          </View>
        ) : null}

        {selectedSection === "Historial"
          ? renderPlaceholder("Historial", "Aqui podras consultar el historial de pedidos y cotizaciones.")
          : null}
        {selectedSection === "Configuracion"
          ? renderPlaceholder("Configuracion", "Aqui podras ajustar preferencias del proveedor.")
          : null}
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
    flexDirection: "row",
    gap: 18,
    flexWrap: "wrap",
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
  brand: {
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
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  heroMobile: {
    padding: 20,
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
  },
  orderTitle: {
    color: "#08121f",
    fontWeight: "800",
    fontSize: 16,
  },
  statusPill: {
    backgroundColor: "#fff2e8",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: {
    color: "#ff8a3d",
    fontWeight: "800",
    fontSize: 12,
  },
  orderText: {
    color: "#425066",
    marginTop: 4,
    fontWeight: "600",
  },
});
