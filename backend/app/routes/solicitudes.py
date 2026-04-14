import base64
import json
import re
import unicodedata
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from xml.etree import ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.jwt_handler import get_current_user
from app.database import get_db
from app.models.solicitud import Solicitud
from app.models.usuario import Usuario
from app.models.vehiculo import Vehiculo
from app.schemas.solicitud import (
    SolicitudAdministradorOmitirCotizacion,
    SolicitudClienteAprobacion,
    SolicitudAdministradorDevolucion,
    SolicitudCotizacionUpdate,
    SolicitudCreate,
    SolicitudDiagnosticoTallerUpdate,
    SolicitudRespuestaTallerUpdate,
    SolicitudTallerUpdate,
    SolicitudProveedorDevolucion,
    SolicitudEstadoUpdate,
    SolicitudRespuestaProveedorUpdate,
)
from app.services.notification_service import (
    NotificationRecipient,
    build_recipient,
    notification_service,
)

router = APIRouter()

ESTADOS_VALIDOS = {
    "creada",
    "en_revision",
    "en_diagnostico",
    "diagnosticada",
    "en_cotizacion",
    "cotizada",
    "propuesta_armada",
    "enviada_cliente",
    "aprobada",
    "rechazada_admin",
    "rechazada_taller",
    "rechazada_proveedor",
    "rechazada_cliente",
    "cancelada",
    "pendiente",
    "recibida",
    "en_diagnostico",
    "pendiente_aprobacion_admin",
    "aprobada",
    "en_proceso",
    "cotizando",
    "archivada",
    "devuelta",
    "enviado_cliente",
    "omitida_admin",
    "asignada",
    "diagnostico",
    "esperando_repuestos",
    "en_reparacion",
    "intervencion_iniciada",
    "repuestos_despachados",
    "repuestos_recibidos_taller",
    "pruebas",
    "cotizado",
    "devuelto_proveedor",
    "finalizado",
    "finalizada",
    "rechazada",
    "en_asignacion_taller",
    "pendiente_envio_cliente_taller",
    "espera_cliente",
}


ESTADOS_COTIZACION_PROVEEDOR = {"pendiente", "cotizado", "devuelto"}
EXCEL_NS = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
EXCEL_HEADER_ALIASES = {
    "marca": {"marca"},
    "referencia": {"referencia", "ref", "codigo", "codigo repuesto", "codigorepuesto"},
    "garantia": {"garantia", "garantía"},
    "disponibilidad": {"disponibilidad", "stock", "existencia", "inventario"},
    "precio": {"precio", "valor", "precio unitario", "valor unitario", "costo", "coste"},
    "observacion": {"observacion", "observación", "observaciones", "nota", "notas", "comentario"},
}


def normalizar_servicio(value: str | None) -> str:
    return (value or "").strip().lower()


def es_servicio_cotizable(tipo_servicio: str | None) -> bool:
    servicio = normalizar_servicio(tipo_servicio)
    return any(
        keyword in servicio
        for keyword in ["bateria", "aceite", "filtro", "freno", "llanta"]
    )


def es_solicitud_mantenimiento_taller(tipo_servicio: str | None) -> bool:
    servicio = normalizar_servicio(tipo_servicio)
    if not servicio:
        return False

    maintenance_keywords = [
        "mantenimiento",
        "diagnostico",
        "escaneo",
        "motor",
        "suspension",
        "direccion",
        "alineacion",
        "balanceo",
        "neumatic",
        "neumátic",
        "revision",
        "chequeo",
        "sistema de enfriamiento",
        "afinacion",
        "electrico",
        "eléctrico",
        "bujia",
        "bujía",
        "cadena",
        "arrastre",
        "frenos",
        "freno",
        "pastillas",
        "balatas",
        "transmision",
        "transmisión",
        "valvulas",
        "válvulas",
        "carburador",
        "inyectores",
        "barras",
        "retenes",
        "mecanica general",
        "mecánica general",
        "rodamientos",
        "rulemanes",
        "testigos tablero",
        "tablero",
        "niveles",
        "presion de neumaticos",
        "presión de neumáticos",
    ]

    return (
        ":" in servicio
        or "," in servicio
        or any(keyword in servicio for keyword in maintenance_keywords)
    )


def parse_proveedores_ids(raw_value: str | None) -> list[int]:
    if not raw_value:
        return []

    ids = []
    for value in raw_value.split(","):
        value = value.strip()
        if value.isdigit():
            ids.append(int(value))
    return ids


def parse_multi_value(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []

    return [value.strip() for value in raw_value.split("|") if value.strip()]


def normalizar_encabezado_excel(value: str | None) -> str:
    if not value:
        return ""

    normalized = unicodedata.normalize("NFKD", str(value))
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def obtener_letras_columna_excel(cell_ref: str | None) -> str:
    if not cell_ref:
        return ""

    match = re.match(r"([A-Z]+)", str(cell_ref).upper())
    return match.group(1) if match else ""


def parse_shared_strings_excel(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []

    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    values: list[str] = []

    for item in root.findall("main:si", EXCEL_NS):
        text_parts = [node.text or "" for node in item.findall(".//main:t", EXCEL_NS)]
        values.append("".join(text_parts).strip())

    return values


def parse_rows_from_excel_sheet(sheet_bytes: bytes, shared_strings: list[str]) -> list[dict[str, str]]:
    root = ET.fromstring(sheet_bytes)
    rows: list[dict[str, str]] = []

    for row in root.findall(".//main:sheetData/main:row", EXCEL_NS):
        current_row: dict[str, str] = {}

        for cell in row.findall("main:c", EXCEL_NS):
            ref = cell.attrib.get("r")
            column = obtener_letras_columna_excel(ref)
            if not column:
                continue

            cell_type = cell.attrib.get("t")
            value_node = cell.find("main:v", EXCEL_NS)
            inline_text_nodes = cell.findall(".//main:is/main:t", EXCEL_NS)

            if cell_type == "inlineStr" and inline_text_nodes:
                value = "".join(node.text or "" for node in inline_text_nodes).strip()
            elif value_node is None or value_node.text is None:
                value = ""
            else:
                raw_value = value_node.text.strip()
                if cell_type == "s":
                    try:
                        value = shared_strings[int(raw_value)].strip()
                    except (ValueError, IndexError):
                        value = raw_value
                else:
                    value = raw_value

            current_row[column] = value

        if any(value.strip() for value in current_row.values()):
            rows.append(current_row)

    return rows


def detectar_columnas_excel(rows: list[dict[str, str]]) -> tuple[dict[str, str], int] | tuple[None, None]:
    best_mapping: dict[str, str] = {}
    best_index = -1

    for index, row in enumerate(rows[:10]):
        mapping: dict[str, str] = {}

        for column, value in row.items():
            normalized = normalizar_encabezado_excel(value)
            if not normalized:
                continue

            for target_field, aliases in EXCEL_HEADER_ALIASES.items():
                if normalized in aliases and target_field not in mapping:
                    mapping[target_field] = column
                    break

        if len(mapping) > len(best_mapping):
            best_mapping = mapping
            best_index = index

    if not best_mapping:
        return None, None

    return best_mapping, best_index


def extraer_cotizacion_desde_excel_base64(documento_excel_base64: str | None) -> dict[str, str] | None:
    if not documento_excel_base64:
        return None

    try:
        workbook_bytes = base64.b64decode(documento_excel_base64)
        workbook = zipfile.ZipFile(BytesIO(workbook_bytes))
    except (ValueError, zipfile.BadZipFile):
        return None

    shared_strings = parse_shared_strings_excel(workbook)
    sheet_names = sorted(
        name for name in workbook.namelist()
        if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
    )

    for sheet_name in sheet_names:
        try:
            rows = parse_rows_from_excel_sheet(workbook.read(sheet_name), shared_strings)
        except ET.ParseError:
            continue

        if not rows:
            continue

        column_mapping, header_index = detectar_columnas_excel(rows)
        if not column_mapping or header_index is None:
            continue

        extracted_rows: list[dict[str, str]] = []
        for row in rows[header_index + 1 :]:
            item = {
                field: str(row.get(column_mapping[field], "") or "").strip()
                for field in column_mapping
            }
            if any(value for value in item.values()):
                extracted_rows.append(item)

        if not extracted_rows:
            continue

        return {
            field: " | ".join(
                value
                for value in [item.get(field, "").strip() for item in extracted_rows]
                if value
            ) or ""
            for field in EXCEL_HEADER_ALIASES
        }

    return None


def crear_notificacion(
    db: Session,
    usuario_id: int,
    titulo: str,
    mensaje: str,
    tipo: str,
):
    notification_service.create_in_app_notification(db, usuario_id, titulo, mensaje, tipo)


def get_user_recipient(db: Session, user_id: int | None) -> NotificationRecipient | None:
    if not user_id:
        return None

    user = (
        db.query(Usuario)
        .filter(Usuario.id == user_id, Usuario.estado == "activo")
        .first()
    )
    if not user:
        return None

    return build_recipient(user)


def get_role_recipients(db: Session, role: str) -> list[NotificationRecipient]:
    return [
        build_recipient(user)
        for user in db.query(Usuario)
        .filter(Usuario.rol == role, Usuario.estado == "activo")
        .all()
    ]


def get_taller_recipients(db: Session, solicitud: Solicitud) -> list[NotificationRecipient]:
    return [
        recipient
        for recipient in (
            get_user_recipient(db, taller_id)
            for taller_id in get_taller_ids_for_solicitud(solicitud)
        )
        if recipient is not None
    ]


def get_selected_provider_recipient(db: Session, solicitud: Solicitud) -> NotificationRecipient | None:
    if not solicitud.proveedor_cotizo_id:
        return None
    return get_user_recipient(db, int(solicitud.proveedor_cotizo_id))


def build_flow_email_context(
    solicitud: Solicitud,
    numero_caso: int,
    etapa: str,
    mensaje: str,
    actor: str | None = None,
    accion_requerida: str | None = None,
    detalle_adicional: str | None = None,
) -> dict:
    extra_details = detalle_adicional.strip() if detalle_adicional else "Sin detalles adicionales."
    return {
        "solicitud_id": numero_caso,
        "etapa": etapa,
        "tipo_servicio": solicitud.tipo or "No especificado",
        "estado_actual": solicitud.estado or "Sin estado",
        "actor": actor or "Sistema MTTO Vehicular",
        "mensaje": mensaje,
        "accion_requerida": accion_requerida or "Sin accion requerida por ahora.",
        "detalle_adicional": extra_details,
        "referencia": f"Solicitud #{numero_caso}",
    }


def append_pipe_values(current: str | None, incoming: str) -> str:
    current_value = (current or "").strip()
    incoming_value = incoming.strip()

    if not current_value:
        return incoming_value
    if not incoming_value:
        return current_value

    return f"{current_value} | {incoming_value}"


def parse_proveedores_estado(raw_value: str | None) -> list[dict]:
    if not raw_value:
        return []

    try:
        data = json.loads(raw_value)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def dump_proveedores_estado(items: list[dict]) -> str:
    return json.dumps(items, ensure_ascii=False)


def normalizar_texto_guardado(value: str | None) -> str | None:
    clean_value = (value or "").strip()
    return clean_value or None


def parse_flujo_mantenimiento(raw_value: str | None) -> dict:
    if not raw_value:
        return {}

    try:
        data = json.loads(raw_value)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def dump_flujo_mantenimiento(data: dict) -> str | None:
    if not data:
        return None
    return json.dumps(data, ensure_ascii=False)


def ensure_flujo_mantenimiento(solicitud: Solicitud) -> dict:
    data = parse_flujo_mantenimiento(solicitud.flujo_mantenimiento)
    if "repuestos_solicitados" not in data or not isinstance(data.get("repuestos_solicitados"), list):
        data["repuestos_solicitados"] = []
    if "timeline" not in data or not isinstance(data.get("timeline"), dict):
        data["timeline"] = {}
    if "confirmaciones" not in data or not isinstance(data.get("confirmaciones"), dict):
        data["confirmaciones"] = {}
    return data


def guardar_flujo_mantenimiento(solicitud: Solicitud, data: dict) -> None:
    solicitud.flujo_mantenimiento = dump_flujo_mantenimiento(data)


def ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def serializar_repuestos_solicitados(repuestos: list[dict]) -> str | None:
    if not repuestos:
        return None

    return ", ".join(
        f"{item.get('nombre', '').strip()} x{int(item.get('cantidad') or 0)}"
        for item in repuestos
        if str(item.get("nombre") or "").strip() and int(item.get("cantidad") or 0) > 0
    ) or None


def get_taller_ids_for_solicitud(solicitud: Solicitud) -> list[int]:
    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    taller_ids = flujo_mantenimiento.get("taller_ids")
    if isinstance(taller_ids, list):
        ids = [int(item) for item in taller_ids if str(item).isdigit()]
        if ids:
            return ids
    return parse_proveedores_ids(solicitud.proveedores_ids)


def rebuild_cotizacion_desde_estados(solicitud: Solicitud, proveedores_estado: list[dict]):
    respuestas_cotizadas = [
        proveedor
        for proveedor in proveedores_estado
        if proveedor.get("estado") == "cotizado"
    ]

    def join_values(key: str) -> str | None:
        values = [str(item.get(key) or "").strip() for item in respuestas_cotizadas]
        clean_values = [value for value in values if value]
        return " | ".join(clean_values) if clean_values else None

    solicitud.marca = join_values("marca")
    solicitud.referencia = join_values("referencia")
    solicitud.garantia = join_values("garantia")
    solicitud.disponibilidad = join_values("disponibilidad")
    solicitud.precio = join_values("precio")
    solicitud.observacion = join_values("observacion")
    solicitud.proveedor_cotizo_id = (
        int(respuestas_cotizadas[-1]["id"]) if respuestas_cotizadas else None
    )


def resolve_estado_desde_proveedores(
    proveedores_estado: list[dict],
    tipo_servicio: str | None = None,
) -> str:
    if es_solicitud_mantenimiento_taller(tipo_servicio):
        if any(item.get("estado") == "pendiente" for item in proveedores_estado):
            return "en_cotizacion"
        if any(item.get("estado") == "cotizado" for item in proveedores_estado):
            return "cotizada"
        if any(item.get("estado") == "devuelto" for item in proveedores_estado):
            return "rechazada_proveedor"
        return "diagnosticada"

    if any(item.get("estado") == "pendiente" for item in proveedores_estado):
        return "en_cotizacion" if es_servicio_cotizable(tipo_servicio) else "cotizando"
    if any(item.get("estado") == "cotizado" for item in proveedores_estado):
        return "cotizada" if es_servicio_cotizable(tipo_servicio) else "cotizado"
    if any(item.get("estado") == "devuelto" for item in proveedores_estado):
        return (
            "rechazada_proveedor"
            if es_servicio_cotizable(tipo_servicio)
            else "devuelto_proveedor"
        )
    return "en_revision" if es_servicio_cotizable(tipo_servicio) else "pendiente"


def resolve_estado_admin_post_propuesta(
    proveedores_estado: list[dict],
    tipo_servicio: str | None = None,
) -> str:
    return (
        resolve_estado_desde_proveedores(proveedores_estado, tipo_servicio)
        if proveedores_estado
        else "propuesta_armada"
    )


def resolve_estado_post_confirmacion_proveedor(
    estado_actual: str | None,
    estado_solicitado: str,
) -> str:
    estado_normalizado = normalizar_servicio(estado_actual)

    if estado_solicitado != "repuestos_despachados":
        return estado_solicitado

    # Si el taller ya avanzo la intervencion, no retrocedemos el estado general.
    if estado_normalizado in {
        "intervencion_iniciada",
        "repuestos_recibidos_taller",
        "en_proceso",
        "en_reparacion",
        "finalizada",
        "finalizado",
    }:
        return estado_actual or estado_solicitado

    return estado_solicitado


def hydrate_respuestas_desde_campos(
    proveedores_estado: list[dict],
    marcas: list[str],
    referencias: list[str],
    garantias: list[str],
    disponibilidades: list[str],
    precios: list[str],
    observaciones: list[str],
) -> list[dict]:
    respuestas = []
    cotizados = [
        proveedor
        for proveedor in proveedores_estado
        if (proveedor.get("estado") or "").lower() == "cotizado"
    ]

    for index, proveedor in enumerate(cotizados):
        proveedor_marcas = parse_multi_value(proveedor.get("marca")) or [
            proveedor.get("marca") or (marcas[index] if index < len(marcas) else None)
        ]
        proveedor_referencias = parse_multi_value(proveedor.get("referencia")) or [
            proveedor.get("referencia") or (referencias[index] if index < len(referencias) else None)
        ]
        proveedor_garantias = parse_multi_value(proveedor.get("garantia")) or [
            proveedor.get("garantia") or (garantias[index] if index < len(garantias) else None)
        ]
        proveedor_disponibilidades = parse_multi_value(proveedor.get("disponibilidad")) or [
            proveedor.get("disponibilidad") or (
                disponibilidades[index] if index < len(disponibilidades) else None
            )
        ]
        proveedor_precios = parse_multi_value(proveedor.get("precio")) or [
            proveedor.get("precio") or (precios[index] if index < len(precios) else None)
        ]
        proveedor_observaciones = parse_multi_value(proveedor.get("observacion")) or [
            proveedor.get("observacion") or (observaciones[index] if index < len(observaciones) else None)
        ]

        total_formularios = max(
            len(proveedor_marcas),
            len(proveedor_referencias),
            len(proveedor_garantias),
            len(proveedor_disponibilidades),
            len(proveedor_precios),
            len(proveedor_observaciones),
        )

        for formulario_index in range(total_formularios):
            respuestas.append(
                {
                    "proveedor_id": proveedor.get("id"),
                    "proveedor_nombre": proveedor.get("nombre"),
                    "response_index": formulario_index,
                    "marca": proveedor_marcas[formulario_index] if formulario_index < len(proveedor_marcas) else None,
                    "referencia": proveedor_referencias[formulario_index] if formulario_index < len(proveedor_referencias) else None,
                    "garantia": proveedor_garantias[formulario_index] if formulario_index < len(proveedor_garantias) else None,
                    "disponibilidad": proveedor_disponibilidades[formulario_index] if formulario_index < len(proveedor_disponibilidades) else None,
                    "precio": proveedor_precios[formulario_index] if formulario_index < len(proveedor_precios) else None,
                    "observacion": proveedor_observaciones[formulario_index] if formulario_index < len(proveedor_observaciones) else None,
                    "documento_excel_nombre": proveedor.get("documento_excel_nombre"),
                    "documento_excel_mime": proveedor.get("documento_excel_mime"),
                    "documento_excel_base64": proveedor.get("documento_excel_base64"),
                }
            )

    return respuestas


def extraer_formularios_proveedor(proveedor: dict) -> list[dict]:
    marcas = parse_multi_value(proveedor.get("marca")) or [proveedor.get("marca")]
    referencias = parse_multi_value(proveedor.get("referencia")) or [proveedor.get("referencia")]
    garantias = parse_multi_value(proveedor.get("garantia")) or [proveedor.get("garantia")]
    disponibilidades = parse_multi_value(proveedor.get("disponibilidad")) or [proveedor.get("disponibilidad")]
    precios = parse_multi_value(proveedor.get("precio")) or [proveedor.get("precio")]
    observaciones = parse_multi_value(proveedor.get("observacion")) or [proveedor.get("observacion")]

    total = max(
        len(marcas),
        len(referencias),
        len(garantias),
        len(disponibilidades),
        len(precios),
        len(observaciones),
    )

    return [
        {
            "marca": marcas[index] if index < len(marcas) else None,
            "referencia": referencias[index] if index < len(referencias) else None,
            "garantia": garantias[index] if index < len(garantias) else None,
            "disponibilidad": disponibilidades[index] if index < len(disponibilidades) else None,
            "precio": precios[index] if index < len(precios) else None,
            "observacion": observaciones[index] if index < len(observaciones) else None,
        }
        for index in range(total)
    ]


def actualizar_proveedor_desde_formularios(proveedor: dict, formularios: list[dict]) -> dict:
    proveedor["marca"] = " | ".join(
        [str(item.get("marca") or "").strip() for item in formularios if str(item.get("marca") or "").strip()]
    ) or None
    proveedor["referencia"] = " | ".join(
        [str(item.get("referencia") or "").strip() for item in formularios if str(item.get("referencia") or "").strip()]
    ) or None
    proveedor["garantia"] = " | ".join(
        [str(item.get("garantia") or "").strip() for item in formularios if str(item.get("garantia") or "").strip()]
    ) or None
    proveedor["disponibilidad"] = " | ".join(
        [str(item.get("disponibilidad") or "").strip() for item in formularios if str(item.get("disponibilidad") or "").strip()]
    ) or None
    proveedor["precio"] = " | ".join(
        [str(item.get("precio") or "").strip() for item in formularios if str(item.get("precio") or "").strip()]
    ) or None
    proveedor["observacion"] = " | ".join(
        [str(item.get("observacion") or "").strip() for item in formularios if str(item.get("observacion") or "").strip()]
    ) or None
    return proveedor


def construir_proveedor_desde_formulario(proveedor: dict, formulario: dict) -> dict:
    proveedor_resultado = dict(proveedor)
    proveedor_resultado["marca"] = normalizar_texto_guardado(formulario.get("marca"))
    proveedor_resultado["referencia"] = normalizar_texto_guardado(formulario.get("referencia"))
    proveedor_resultado["garantia"] = normalizar_texto_guardado(formulario.get("garantia"))
    proveedor_resultado["disponibilidad"] = normalizar_texto_guardado(formulario.get("disponibilidad"))
    proveedor_resultado["precio"] = normalizar_texto_guardado(formulario.get("precio"))
    proveedor_resultado["observacion"] = normalizar_texto_guardado(formulario.get("observacion"))
    proveedor_resultado["documento_excel_nombre"] = normalizar_texto_guardado(proveedor.get("documento_excel_nombre"))
    proveedor_resultado["documento_excel_mime"] = normalizar_texto_guardado(proveedor.get("documento_excel_mime"))
    proveedor_resultado["documento_excel_base64"] = normalizar_texto_guardado(proveedor.get("documento_excel_base64"))
    return proveedor_resultado


def construir_proveedor_desde_formularios(proveedor: dict, formularios: list[dict]) -> dict:
    proveedor_resultado = dict(proveedor)
    proveedor_resultado = actualizar_proveedor_desde_formularios(
        proveedor_resultado,
        formularios,
    )
    proveedor_resultado["documento_excel_nombre"] = normalizar_texto_guardado(proveedor.get("documento_excel_nombre"))
    proveedor_resultado["documento_excel_mime"] = normalizar_texto_guardado(proveedor.get("documento_excel_mime"))
    proveedor_resultado["documento_excel_base64"] = normalizar_texto_guardado(proveedor.get("documento_excel_base64"))
    return proveedor_resultado


def obtener_solicitud_raiz_id(solicitud: Solicitud) -> int:
    return int(solicitud.solicitud_origen_id or solicitud.id)


def obtener_numero_caso(solicitud: Solicitud) -> int:
    return obtener_solicitud_raiz_id(solicitud)


def obtener_solicitud_raiz(db: Session, solicitud: Solicitud) -> Solicitud:
    root_id = obtener_solicitud_raiz_id(solicitud)
    if solicitud.id == root_id:
        return solicitud

    solicitud_raiz = db.query(Solicitud).filter(Solicitud.id == root_id).first()
    return solicitud_raiz or solicitud


def sincronizar_solicitud_raiz_con_hija(db: Session, solicitud: Solicitud) -> None:
    if not solicitud.solicitud_origen_id:
        return

    solicitud_raiz = db.query(Solicitud).filter(Solicitud.id == solicitud.solicitud_origen_id).first()
    if not solicitud_raiz:
        return

    solicitud_raiz.estado = solicitud.estado
    solicitud_raiz.proveedor_cotizo_id = solicitud.proveedor_cotizo_id
    solicitud_raiz.proveedores_ids = solicitud.proveedores_ids
    solicitud_raiz.proveedores_estado = solicitud.proveedores_estado
    solicitud_raiz.marca = solicitud.marca
    solicitud_raiz.referencia = solicitud.referencia
    solicitud_raiz.garantia = solicitud.garantia
    solicitud_raiz.disponibilidad = solicitud.disponibilidad
    solicitud_raiz.precio = solicitud.precio
    solicitud_raiz.observacion = solicitud.observacion
    solicitud_raiz.comentario_proveedor = solicitud.comentario_proveedor
    solicitud_raiz.flujo_mantenimiento = solicitud.flujo_mantenimiento


def obtener_etiqueta_caso(solicitud: Solicitud) -> str:
    return f"Solicitud #{obtener_numero_caso(solicitud)}"


def obtener_asunto_correo_solicitud(solicitud: Solicitud) -> str:
    return obtener_etiqueta_caso(solicitud)


def combinar_destinatarios(*groups: NotificationRecipient | list[NotificationRecipient] | None) -> list[NotificationRecipient]:
    recipients: list[NotificationRecipient] = []
    for group in groups:
        if group is None:
            continue
        if isinstance(group, list):
            recipients.extend([item for item in group if item is not None])
        else:
            recipients.append(group)
    return recipients


def finalizar_solicitudes_hijas(
    db: Session,
    root_id: int,
    exclude_id: int | None = None,
    exclude_ids: set[int] | None = None,
    estado: str = "finalizada",
) -> None:
    query = db.query(Solicitud).filter(Solicitud.solicitud_origen_id == root_id)
    ids_excluidos = set(exclude_ids or set())
    if exclude_id is not None:
        ids_excluidos.add(exclude_id)
    if ids_excluidos:
        query = query.filter(~Solicitud.id.in_(ids_excluidos))

    for item in query.all():
        item.estado = estado


@router.post("/solicitudes")
def crear_solicitud(
    data: SolicitudCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == data.vehiculo_id,
        Vehiculo.usuario_id == user["id"],
    ).first()

    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehiculo no encontrado")

    solicitud = Solicitud(
        usuario_id=user["id"],
        vehiculo_id=data.vehiculo_id,
        tipo=data.tipo,
        descripcion=data.descripcion,
        disponibilidad_cliente=data.disponibilidad_cliente.strip(),
        estado="creada" if es_servicio_cotizable(data.tipo) else "pendiente",
    )

    db.add(solicitud)
    db.commit()
    db.refresh(solicitud)
    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)
    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)

    notification_service.notify_users(
        db,
        combinar_destinatarios(
            get_role_recipients(db, "administrador"),
            cliente_recipient,
        ),
        f"Solicitud #{numero_caso} nueva",
        f"El cliente {user['nombre']} creo la solicitud #{numero_caso}.",
        "solicitud_cliente",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Solicitud creada por cliente",
            mensaje=f"El cliente {user['nombre']} creo la solicitud #{numero_caso}.",
            actor=user["nombre"],
            accion_requerida="El administrador debe revisar la solicitud y continuar el flujo.",
            detalle_adicional=(
                f"Disponibilidad del cliente: {solicitud.disponibilidad_cliente or 'No registrada'}\n"
                f"Estado inicial: {solicitud.estado}"
            ),
        ),
    )
    db.commit()

    return {"mensaje": "solicitud creada", "id": solicitud.id, "estado": solicitud.estado}


@router.get("/solicitudes")
def obtener_solicitudes(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    # Optimización: Pre-cargar todos los vehículos y usuarios para evitar N+1 queries
    solicitudes = db.query(Solicitud).all()
    
    # Recopilar IDs necesarios
    vehiculo_ids = [s.vehiculo_id for s in solicitudes if s.vehiculo_id]
    usuario_ids = {
        s.usuario_id for s in solicitudes if s.usuario_id
    }
    for solicitud in solicitudes:
        usuario_ids.update(parse_proveedores_ids(solicitud.proveedores_ids))
    
    # Cargar en batch para evitar N+1
    vehiculos_map = {v.id: v for v in db.query(Vehiculo).filter(Vehiculo.id.in_(vehiculo_ids)).all()} if vehiculo_ids else {}
    usuarios_map = (
        {u.id: u for u in db.query(Usuario).filter(Usuario.id.in_(usuario_ids)).all()}
        if usuario_ids
        else {}
    )
    
    resultado = []

    for solicitud in solicitudes:
      vehiculo = vehiculos_map.get(solicitud.vehiculo_id)
      cliente = usuarios_map.get(solicitud.usuario_id)
      # Reutilizar usuarios_map para proveedores (evitar query adicional)
      proveedores_ids = parse_proveedores_ids(solicitud.proveedores_ids)
      taller_ids = get_taller_ids_for_solicitud(solicitud)
      proveedores = [usuarios_map.get(pid) for pid in proveedores_ids if pid in usuarios_map]
      proveedores = [p for p in proveedores if p is not None]
      talleres = [usuarios_map.get(tid) for tid in taller_ids if tid in usuarios_map]
      talleres = [t for t in talleres if t is not None]
      marcas = parse_multi_value(solicitud.marca)
      referencias = parse_multi_value(solicitud.referencia)
      garantias = parse_multi_value(solicitud.garantia)
      disponibilidades = parse_multi_value(solicitud.disponibilidad)
      precios = parse_multi_value(solicitud.precio)
      observaciones = parse_multi_value(solicitud.observacion)
      proveedores_estado = parse_proveedores_estado(solicitud.proveedores_estado)
      fecha_recepcion = None
      if user["rol"] == "proveedor":
          proveedor_actual = next(
              (
                  proveedor
                  for proveedor in proveedores_estado
                  if str(proveedor.get("id")) == str(user["id"])
              ),
              None,
          )
          fecha_recepcion = proveedor_actual.get("fecha_recepcion") if proveedor_actual else None
      respuestas_por_proveedor = hydrate_respuestas_desde_campos(
          proveedores_estado,
          marcas,
          referencias,
          garantias,
          disponibilidades,
          precios,
          observaciones,
      )

      if solicitud.estado == "omitida_admin" and user["rol"] != "administrador":
          continue

      if user["rol"] == "cliente" and solicitud.usuario_id != user["id"]:
          continue
      if user["rol"] == "proveedor":
          proveedor_visible = (
              user["id"] in proveedores_ids
              or str(user["id"]) == str(solicitud.proveedor_cotizo_id)
              or any(str(proveedor.get("id")) == str(user["id"]) for proveedor in proveedores_estado)
          )
          if not proveedor_visible:
              continue
      if user["rol"] == "taller" and user["id"] not in taller_ids:
          continue

      resultado.append(
          {
              "id": solicitud.id,
              "numero_caso": obtener_numero_caso(solicitud),
              "solicitud_origen_id": solicitud.solicitud_origen_id,
              "tipo_servicio": solicitud.tipo,
              "problema": solicitud.descripcion,
              "estado": solicitud.estado,
              "observacion": solicitud.observacion,
              "disponibilidad_cliente": solicitud.disponibilidad_cliente,
              "fecha": solicitud.fecha.isoformat() if solicitud.fecha else None,
              "fecha_recepcion": fecha_recepcion,
              "vehiculo": {
                  "id": vehiculo.id if vehiculo else None,
                  "marca": vehiculo.marca if vehiculo else None,
                  "modelo": vehiculo.modelo if vehiculo else None,
                  "placa": vehiculo.placa if vehiculo else None,
              },
              "cliente": {
                  "id": cliente.id if cliente else None,
                  "nombre": cliente.nombre if cliente else None,
              },
              "proveedores": [
                  {
                      "id": proveedor.id,
                      "nombre": proveedor.nombre,
                      "email": proveedor.email,
                  }
                  for proveedor in proveedores
              ],
              "talleres": [
                  {
                      "id": taller.id,
                      "nombre": taller.nombre,
                      "email": taller.email,
                  }
                  for taller in talleres
              ],
              "proveedores_estado": proveedores_estado,
              "cotizacion": {
                  "proveedor_id": solicitud.proveedor_cotizo_id,
                  "marca": solicitud.marca,
                  "referencia": solicitud.referencia,
                  "garantia": solicitud.garantia,
                  "disponibilidad": solicitud.disponibilidad,
                  "precio": solicitud.precio,
                  "observacion": solicitud.observacion,
                  "documento_excel_nombre": (
                      proveedores_estado[0].get("documento_excel_nombre")
                      if len(proveedores_estado) == 1
                      else None
                  ),
                  "respuestas": respuestas_por_proveedor
                  if respuestas_por_proveedor
                  else [
                      {
                          "proveedor_id": None,
                          "proveedor_nombre": None,
                          "response_index": index,
                          "marca": marcas[index] if index < len(marcas) else None,
                          "referencia": referencias[index] if index < len(referencias) else None,
                          "garantia": garantias[index] if index < len(garantias) else None,
                          "disponibilidad": disponibilidades[index] if index < len(disponibilidades) else None,
                          "precio": precios[index] if index < len(precios) else None,
                          "observacion": observaciones[index] if index < len(observaciones) else None,
                      }
                      for index in range(
                          max(
                              len(marcas),
                              len(referencias),
                              len(garantias),
                              len(disponibilidades),
                              len(precios),
                              len(observaciones),
                          )
                      )
                  ],
              },
              "taller_diagnostico": {
                  "diagnostico": solicitud.diagnostico_taller,
                  "servicios": solicitud.servicios_taller,
                  "horas": solicitud.horas_taller,
                  "materiales": solicitud.materiales_taller,
              },
              "flujo_mantenimiento": ensure_flujo_mantenimiento(solicitud),
              "respuesta_taller": {
                  "comentario": solicitud.comentario_taller,
                  "fecha_disponible": solicitud.fecha_disponible_taller,
                  "horario_disponible": solicitud.horario_disponible_taller,
              },
              "respuesta_proveedor": {
                  "comentario": solicitud.comentario_proveedor,
              },
          }
      )

    return resultado


@router.patch("/solicitudes/{solicitud_id}/estado")
def actualizar_estado_solicitud(
    solicitud_id: int,
    data: SolicitudEstadoUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] not in {"taller", "proveedor"}:
        raise HTTPException(
            status_code=403,
            detail="Solo el taller o el proveedor pueden actualizar solicitudes",
        )

    if data.estado not in ESTADOS_VALIDOS:
        raise HTTPException(status_code=400, detail="Estado no valido")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    confirmaciones = flujo_mantenimiento.setdefault("confirmaciones", {})
    timeline = flujo_mantenimiento.setdefault("timeline", {})

    if user["rol"] == "proveedor":
        es_mantenimiento_taller = es_solicitud_mantenimiento_taller(solicitud.tipo)
        if not es_servicio_cotizable(solicitud.tipo) and not (
            es_mantenimiento_taller and data.estado == "repuestos_despachados"
        ):
            raise HTTPException(
                status_code=403,
                detail="El proveedor solo puede actualizar servicios cotizables",
            )

        proveedores_ids = parse_proveedores_ids(solicitud.proveedores_ids)
        proveedor_asignado = (
            user["id"] in proveedores_ids
            or str(user["id"]) == str(solicitud.proveedor_cotizo_id)
        )

        if not proveedor_asignado:
            raise HTTPException(
                status_code=403,
                detail="Esta solicitud no fue aprobada para este proveedor",
            )

        estados_validos_proveedor = {"espera_cliente", "en_reparacion", "finalizada", "repuestos_despachados"}
        if data.estado not in estados_validos_proveedor:
            raise HTTPException(
                status_code=403,
                detail="El proveedor no puede mover la solicitud a ese estado",
            )

    if user["rol"] == "taller":
        if user["id"] not in get_taller_ids_for_solicitud(solicitud):
            raise HTTPException(
                status_code=403,
                detail="Esta solicitud no fue asignada a este taller",
            )

        estados_validos_taller = {
            "en_diagnostico",
            "diagnosticada",
            "en_proceso",
            "finalizada",
            "rechazada_taller",
            "en_asignacion_taller",
            "pendiente_envio_cliente_taller",
            "intervencion_iniciada",
            "repuestos_recibidos_taller",
        }
        if data.estado not in estados_validos_taller:
            raise HTTPException(
                status_code=403,
                detail="El taller solo puede mover solicitudes del flujo de taller",
            )
        if data.estado == "rechazada_taller":
            comentario = (data.comentario or "").strip()
            if not comentario:
                raise HTTPException(
                    status_code=400,
                    detail="Debes escribir un comentario para devolver la solicitud",
                )
            solicitud.observacion = comentario

    previous_status = solicitud.estado
    solicitud.estado = (
        resolve_estado_post_confirmacion_proveedor(solicitud.estado, data.estado)
        if user["rol"] == "proveedor"
        else data.estado
    )
    numero_caso = obtener_numero_caso(solicitud)

    if user["rol"] == "proveedor":
        comentario = (data.comentario or "").strip()
        if comentario:
            solicitud.comentario_proveedor = comentario
        if data.estado == "repuestos_despachados":
            confirmaciones["proveedor_despacho_confirmado"] = True
            confirmaciones["proveedor_despacho_comentario"] = comentario or None
            timeline["proveedor_despacho_confirmado_en"] = ahora_iso()
        sincronizar_solicitud_raiz_con_hija(db, solicitud)
        guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)

    if user["rol"] == "taller":
        if data.estado == "intervencion_iniciada":
            confirmaciones["taller_inicio_intervencion_confirmado"] = True
            timeline["taller_inicio_intervencion_en"] = ahora_iso()
        if data.estado == "repuestos_recibidos_taller":
            if not confirmaciones.get("proveedor_despacho_confirmado"):
                raise HTTPException(
                    status_code=400,
                    detail="Primero el proveedor debe confirmar el despacho de repuestos",
                )
            confirmaciones["taller_inicio_intervencion_confirmado"] = True
            timeline.setdefault("taller_inicio_intervencion_en", ahora_iso())
            confirmaciones["taller_recibe_repuestos_confirmado"] = True
            timeline["taller_recibe_repuestos_en"] = ahora_iso()
        if data.estado == "finalizada":
            confirmaciones["proveedor_despacho_confirmado"] = True
            timeline.setdefault("proveedor_despacho_confirmado_en", ahora_iso())
            confirmaciones["taller_inicio_intervencion_confirmado"] = True
            timeline.setdefault("taller_inicio_intervencion_en", ahora_iso())
            confirmaciones["taller_recibe_repuestos_confirmado"] = True
            timeline.setdefault("taller_recibe_repuestos_en", ahora_iso())
            confirmaciones["taller_reparacion_finalizada"] = True
            timeline["taller_reparacion_finalizada_en"] = ahora_iso()
        guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
        sincronizar_solicitud_raiz_con_hija(db, solicitud)

    administradores = get_role_recipients(db, "administrador")
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)
    if user["rol"] == "taller" and data.estado == "diagnosticada":
        notification_service.notify_users(
            db,
            administradores,
            f"Solicitud #{numero_caso} diagnosticada",
            f"El taller {user['nombre']} envio el diagnostico de la solicitud #{numero_caso}.",
            "diagnostico_taller",
            email_subject=asunto_correo,
            email_template="generic_notification",
            email_context={
                "mensaje": f"El taller {user['nombre']} envio el diagnostico de la solicitud #{numero_caso}.",
                "referencia": f"Solicitud #{numero_caso}",
            },
        )
    if user["rol"] == "taller" and data.estado == "rechazada_taller":
        notification_service.notify_users(
            db,
            administradores,
            f"Solicitud #{numero_caso} rechazada por taller",
            f"El taller {user['nombre']} devolvio la solicitud #{numero_caso}.",
            "rechazo_taller",
            email_subject=asunto_correo,
            email_template="generic_notification",
            email_context={
                "mensaje": f"El taller {user['nombre']} devolvio la solicitud #{numero_caso}.",
                "referencia": f"Solicitud #{numero_caso}",
            },
        )

    if user["rol"] == "proveedor" and data.estado in {"espera_cliente", "en_reparacion", "finalizada", "repuestos_despachados"}:
        notification_service.notify_users(
            db,
            combinar_destinatarios(
                administradores,
                get_user_recipient(db, solicitud.usuario_id),
                get_taller_recipients(db, solicitud),
                get_selected_provider_recipient(db, solicitud) if data.estado == "repuestos_despachados" else None,
            ),
            f"Solicitud #{numero_caso} actualizada",
            (
                f"El proveedor {user['nombre']} confirmo el despacho de repuestos para la solicitud #{numero_caso}."
                if data.estado == "repuestos_despachados"
                else f"El proveedor {user['nombre']} cambio la solicitud #{numero_caso} a {data.estado}."
            ),
            "estado_solicitud",
            email_subject=asunto_correo,
            email_template="maintenance_flow_notification",
            email_context=build_flow_email_context(
                solicitud,
                numero_caso,
                etapa="Confirmacion de proveedor",
                mensaje=(
                    f"El proveedor {user['nombre']} confirmo el despacho de repuestos para la solicitud #{numero_caso}."
                    if data.estado == "repuestos_despachados"
                    else f"El proveedor {user['nombre']} actualizo la solicitud #{numero_caso} a {data.estado}."
                ),
                actor=user["nombre"],
                accion_requerida=(
                    "El taller debe preparar la recepcion de repuestos."
                    if data.estado == "repuestos_despachados"
                    else "Revisar el avance actualizado en la plataforma."
                ),
                detalle_adicional=f"Comentario del proveedor: {solicitud.comentario_proveedor or 'Sin comentario'}",
            ),
        )

    if user["rol"] == "taller" and data.estado in {"intervencion_iniciada", "repuestos_recibidos_taller", "finalizada"}:
        notification_service.notify_users(
            db,
            combinar_destinatarios(
                administradores,
                get_user_recipient(db, solicitud.usuario_id),
                get_taller_recipients(db, solicitud),
                get_selected_provider_recipient(db, solicitud) if data.estado == "repuestos_recibidos_taller" else None,
            ),
            f"Solicitud #{numero_caso} actualizada por taller",
            (
                f"El taller {user['nombre']} confirmo el inicio de intervencion de la solicitud #{numero_caso}."
                if data.estado == "intervencion_iniciada"
                else f"El taller {user['nombre']} confirmo la recepcion de repuestos de la solicitud #{numero_caso}."
                if data.estado == "repuestos_recibidos_taller"
                else f"El taller {user['nombre']} confirmo la reparacion final de la solicitud #{numero_caso}."
            ),
            "estado_solicitud_taller",
            email_subject=asunto_correo,
            email_template="maintenance_flow_notification",
            email_context=build_flow_email_context(
                solicitud,
                numero_caso,
                etapa=(
                    "Inicio de intervencion"
                    if data.estado == "intervencion_iniciada"
                    else "Repuestos recibidos en taller"
                    if data.estado == "repuestos_recibidos_taller"
                    else "Reparacion finalizada"
                ),
                mensaje=(
                    f"El taller {user['nombre']} confirmo el inicio de intervencion de la solicitud #{numero_caso}."
                    if data.estado == "intervencion_iniciada"
                    else f"El taller {user['nombre']} confirmo la recepcion de repuestos de la solicitud #{numero_caso}."
                    if data.estado == "repuestos_recibidos_taller"
                    else f"El taller {user['nombre']} confirmo la reparacion final de la solicitud #{numero_caso}."
                ),
                actor=user["nombre"],
                accion_requerida=(
                    "El cliente y el administrador pueden seguir el avance desde la plataforma."
                    if data.estado == "intervencion_iniciada"
                    else "El proveedor, el cliente y el administrador ya fueron informados de la recepcion."
                    if data.estado == "repuestos_recibidos_taller"
                    else "El cliente puede revisar la finalizacion del servicio."
                ),
            ),
        )

    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_solicitud_status_changed(
            db,
            solicitud,
            cliente_recipient,
            previous_status,
            actor_name=user["nombre"],
        )

    db.commit()
    db.refresh(solicitud)

    return {"mensaje": "estado actualizado", "id": solicitud.id, "estado": solicitud.estado}


@router.patch("/solicitudes/{solicitud_id}/diagnostico-taller")
def enviar_diagnostico_taller(
    solicitud_id: int,
    data: SolicitudDiagnosticoTallerUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "taller":
        raise HTTPException(status_code=403, detail="Solo el taller puede enviar diagnosticos")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    if user["id"] not in get_taller_ids_for_solicitud(solicitud):
        raise HTTPException(status_code=403, detail="Esta solicitud no fue asignada a este taller")

    horas = data.horas.strip()
    if not horas:
        raise HTTPException(status_code=400, detail="Debes indicar las horas estimadas")

    if len(horas) > 20:
        raise HTTPException(status_code=400, detail="El formato de horas no es valido")

    previous_status = solicitud.estado
    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    repuestos_solicitados = [
        {
            "nombre": item.nombre.strip(),
            "cantidad": int(item.cantidad),
        }
        for item in data.repuestos
        if item.nombre.strip()
    ]
    solicitud.diagnostico_taller = data.diagnostico.strip()
    solicitud.servicios_taller = data.servicios.strip()
    solicitud.horas_taller = horas
    solicitud.materiales_taller = serializar_repuestos_solicitados(repuestos_solicitados) or data.materiales.strip()
    flujo_mantenimiento["repuestos_solicitados"] = repuestos_solicitados
    flujo_mantenimiento.setdefault("timeline", {})["diagnostico_enviado_en"] = ahora_iso()
    guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
    solicitud.estado = "diagnosticada"
    sincronizar_solicitud_raiz_con_hija(db, solicitud)
    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)

    notification_service.notify_users(
        db,
        combinar_destinatarios(
            get_role_recipients(db, "administrador"),
            get_taller_recipients(db, solicitud),
        ),
        f"Solicitud #{numero_caso} diagnosticada",
        f"El taller {user['nombre']} envio cotizacion y diagnostico para la solicitud #{numero_caso}.",
        "diagnostico_taller",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Diagnostico enviado al administrador",
            mensaje=f"El taller {user['nombre']} envio diagnostico y cotizacion para la solicitud #{numero_caso}.",
            actor=user["nombre"],
            accion_requerida="El administrador debe revisar el diagnostico y decidir el siguiente paso.",
            detalle_adicional=(
                f"Diagnostico: {solicitud.diagnostico_taller or 'Sin diagnostico'}\n"
                f"Servicios: {solicitud.servicios_taller or 'Sin servicios'}\n"
                f"Horas estimadas: {solicitud.horas_taller or 'Sin horas'}"
            ),
        ),
    )
    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_solicitud_status_changed(
            db,
            solicitud,
            cliente_recipient,
            previous_status,
            actor_name=user["nombre"],
        )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "diagnostico enviado al administrador",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/respuesta-taller")
def responder_solicitud_taller(
    solicitud_id: int,
    data: SolicitudRespuestaTallerUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "taller":
        raise HTTPException(status_code=403, detail="Solo el taller puede responder solicitudes")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    if user["id"] not in get_taller_ids_for_solicitud(solicitud):
        raise HTTPException(status_code=403, detail="Esta solicitud no fue asignada a este taller")

    comentario = data.comentario.strip()
    fecha_disponible = data.fecha_disponible.strip()
    horario_disponible = data.horario_disponible.strip()

    if not comentario or not fecha_disponible or not horario_disponible:
        raise HTTPException(status_code=400, detail="Debes completar comentario, fecha y horario")

    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    solicitud.comentario_taller = comentario
    solicitud.fecha_disponible_taller = fecha_disponible
    solicitud.horario_disponible_taller = horario_disponible
    timeline = flujo_mantenimiento.setdefault("timeline", {})
    timestamp = ahora_iso()
    timeline["confirmacion_taller_enviada_en"] = timestamp
    timeline["confirmacion_taller_enviada_cliente_en"] = timestamp
    guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
    solicitud.estado = "espera_cliente"
    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)
    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)

    notification_service.notify_users(
        db,
        combinar_destinatarios(
            get_role_recipients(db, "administrador"),
            cliente_recipient,
            get_taller_recipients(db, solicitud),
        ),
        f"Solicitud #{numero_caso} con disponibilidad de taller",
        (
            f"El taller {user['nombre']} confirmo disponibilidad para la solicitud #{numero_caso}. "
            f"El cliente ya puede confirmar su llegada al taller desde la aplicacion."
        ),
        "respuesta_taller",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Confirmacion del taller al cliente",
            mensaje=f"El taller {user['nombre']} confirmo disponibilidad para la solicitud #{numero_caso}.",
            actor=user["nombre"],
            accion_requerida="El cliente ya puede confirmar su llegada al taller desde la aplicacion.",
            detalle_adicional=(
                f"Fecha disponible: {fecha_disponible}\n"
                f"Horario disponible: {horario_disponible}\n"
                f"Comentario: {comentario}"
            ),
        ),
    )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "disponibilidad del taller enviada al cliente y notificada al administrador",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/cotizar")
def enviar_a_proveedores(
    solicitud_id: int,
    data: SolicitudCotizacionUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede enviar a cotizar")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    proveedores = (
        db.query(Usuario)
        .filter(
            Usuario.id.in_(data.proveedor_ids),
            Usuario.rol == "proveedor",
            Usuario.estado == "activo",
        )
        .all()
    )

    if not proveedores:
        raise HTTPException(status_code=400, detail="Debes seleccionar al menos un proveedor valido")

    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)
    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    repuestos_solicitados = flujo_mantenimiento.get("repuestos_solicitados") or []
    solicitud.proveedores_ids = ",".join(str(proveedor.id) for proveedor in proveedores)
    fecha_recepcion = datetime.now(timezone.utc).isoformat()
    solicitud.proveedores_estado = dump_proveedores_estado(
        [
            {
                "id": proveedor.id,
                "nombre": proveedor.nombre,
                "email": proveedor.email,
                "estado": "pendiente",
                "fecha_recepcion": fecha_recepcion,
                "repuestos_solicitados": repuestos_solicitados,
            }
            for proveedor in proveedores
        ]
    )
    flujo_mantenimiento.setdefault("timeline", {})["repuestos_enviados_a_proveedores_en"] = fecha_recepcion
    guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
    solicitud.estado = "en_cotizacion" if es_servicio_cotizable(solicitud.tipo) else "cotizando"
    notification_service.notify_users(
        db,
        [build_recipient(proveedor) for proveedor in proveedores],
        f"Solicitud #{numero_caso} enviada a cotizacion",
        f"El administrador te envio la solicitud #{numero_caso} para cotizar.",
        "solicitud_proveedor",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Solicitud enviada a proveedores",
            mensaje=f"El administrador envio la solicitud #{numero_caso} a proveedores para cotizar.",
            actor=user["nombre"],
            accion_requerida="El proveedor debe cotizar y responder al administrador.",
            detalle_adicional=(
                f"Repuestos solicitados: {serializar_repuestos_solicitados(repuestos_solicitados) or 'Sin detalle'}"
                if es_solicitud_mantenimiento_taller(solicitud.tipo)
                else "La solicitud quedo disponible para cotizacion."
            ),
        ),
    )
    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} enviada a cotizacion",
        f"Enviaste la solicitud #{numero_caso} para cotizar.",
        "solicitud_proveedor",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Solicitud enviada a proveedores",
            mensaje=f"Enviaste la solicitud #{numero_caso} para cotizar.",
            actor=user["nombre"],
            accion_requerida="Esperar las respuestas de los proveedores.",
        ),
    )
    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_user(
            db,
            cliente_recipient,
            f"Solicitud #{numero_caso} enviada a cotizacion",
            f"El administrador envio tu solicitud #{numero_caso} a proveedores para cotizar.",
            "solicitud_enviada_proveedores",
            email_subject=asunto_correo,
            email_template="maintenance_flow_notification",
            email_context=build_flow_email_context(
                solicitud,
                numero_caso,
                etapa="Solicitud enviada a proveedores",
                mensaje=f"El administrador envio tu solicitud #{numero_caso} a proveedores para cotizar.",
                actor=user["nombre"],
                accion_requerida="Espera la propuesta final del administrador.",
            ),
        )
    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud enviada a proveedores",
        "id": solicitud.id,
        "estado": solicitud.estado,
        "proveedor_ids": [proveedor.id for proveedor in proveedores],
    }


@router.patch("/solicitudes/{solicitud_id}/enviar-taller")
def enviar_a_talleres(
    solicitud_id: int,
    data: SolicitudTallerUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede enviar al taller")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    talleres = (
        db.query(Usuario)
        .filter(
            Usuario.id.in_(data.taller_ids),
            Usuario.rol == "taller",
            Usuario.estado == "activo",
        )
        .all()
    )

    if not talleres:
        raise HTTPException(status_code=400, detail="Debes seleccionar al menos un taller valido")

    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)
    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    flujo_mantenimiento["taller_ids"] = [taller.id for taller in talleres]
    guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
    solicitud.proveedores_ids = ",".join(str(taller.id) for taller in talleres)
    solicitud.proveedores_estado = None
    solicitud.estado = "en_asignacion_taller"

    notification_service.notify_users(
        db,
        combinar_destinatarios(
            [build_recipient(taller) for taller in talleres],
            get_role_recipients(db, "administrador"),
        ),
        f"Solicitud #{numero_caso} nueva",
        f"El administrador te envio la solicitud #{numero_caso} para revision en taller.",
        "solicitud_taller",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Solicitud enviada a taller",
            mensaje=f"El administrador envio la solicitud #{numero_caso} a taller para revision.",
            actor=user["nombre"],
            accion_requerida="El taller debe revisar la solicitud y responder con disponibilidad o diagnostico.",
            detalle_adicional=f"Disponibilidad del cliente: {solicitud.disponibilidad_cliente or 'No registrada'}",
        ),
    )

    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_user(
            db,
            cliente_recipient,
            f"Solicitud #{numero_caso} en asignacion de taller",
            f"Tu solicitud #{numero_caso} fue enviada a taller.",
            "solicitud_taller_asignada",
            email_subject=asunto_correo,
            email_template="maintenance_flow_notification",
            email_context=build_flow_email_context(
                solicitud,
                numero_caso,
                etapa="Solicitud enviada a taller",
                mensaje=f"Tu solicitud #{numero_caso} fue enviada a taller.",
                actor=user["nombre"],
                accion_requerida="Espera la confirmacion del taller desde la aplicacion.",
                detalle_adicional=f"Disponibilidad registrada: {solicitud.disponibilidad_cliente or 'No registrada'}",
            ),
        )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud enviada a talleres",
        "id": solicitud.id,
        "estado": solicitud.estado,
        "taller_ids": [taller.id for taller in talleres],
    }


@router.patch("/solicitudes/{solicitud_id}/archivar")
def archivar_solicitud(
    solicitud_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede archivar solicitudes")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    solicitud.estado = "cancelada" if es_servicio_cotizable(solicitud.tipo) else "archivada"
    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)
    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_user(
            db,
            cliente_recipient,
            f"Solicitud #{numero_caso} descartada",
            "Tu solicitud fue descartada. Si quieres, puedes volver a solicitar.",
            "solicitud_descartada",
            email_subject=asunto_correo,
            email_template="generic_notification",
            email_context={
                "mensaje": "Tu solicitud fue descartada. Si quieres, puedes volver a solicitar.",
                "referencia": f"Solicitud #{numero_caso}",
            },
        )
    db.commit()
    db.refresh(solicitud)

    return {"mensaje": "solicitud archivada", "id": solicitud.id, "estado": solicitud.estado}


@router.patch("/solicitudes/{solicitud_id}/enviar-cliente")
def enviar_solicitud_cliente(
    solicitud_id: int,
    data: SolicitudAdministradorOmitirCotizacion | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede enviar solicitudes al cliente")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    proveedores_estado = parse_proveedores_estado(solicitud.proveedores_estado)
    solicitud_raiz = obtener_solicitud_raiz(db, solicitud)
    numero_caso = obtener_numero_caso(solicitud_raiz)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud_raiz)

    if data and data.proveedor_id is not None:
        proveedor_enviado = next(
            (
                proveedor
                for proveedor in proveedores_estado
                if str(proveedor.get("id")) == str(data.proveedor_id)
                and proveedor.get("estado") == "cotizado"
            ),
            None,
        )

        if not proveedor_enviado:
            raise HTTPException(status_code=404, detail="Cotizacion del proveedor no encontrada")

        formularios = extraer_formularios_proveedor(proveedor_enviado)
        enviar_proveedor_completo = data.response_index is None

        if enviar_proveedor_completo:
            proveedor_formulario_enviado = construir_proveedor_desde_formularios(
                proveedor_enviado,
                formularios,
            )
            formularios_restantes: list[dict] = []
        else:
            response_index = data.response_index or 0

            if response_index < 0 or response_index >= len(formularios):
                raise HTTPException(status_code=404, detail="Formulario de cotizacion no encontrado")

            formulario_enviado = formularios[response_index]
            proveedor_formulario_enviado = construir_proveedor_desde_formulario(
                proveedor_enviado,
                formulario_enviado,
            )
            formularios_restantes = [
                formulario
                for index, formulario in enumerate(formularios)
                if index != response_index
            ]

        solicitud_cliente = Solicitud(
            solicitud_origen_id=solicitud.id,
            usuario_id=solicitud.usuario_id,
            vehiculo_id=solicitud.vehiculo_id,
            tipo=solicitud.tipo,
            descripcion=solicitud.descripcion,
            estado="enviada_cliente" if es_servicio_cotizable(solicitud.tipo) else "enviado_cliente",
            proveedores_ids=str(proveedor_enviado.get("id")) if proveedor_enviado.get("id") else None,
            proveedores_estado=dump_proveedores_estado([proveedor_formulario_enviado]),
            proveedor_cotizo_id=proveedor_enviado.get("id"),
            marca=normalizar_texto_guardado(proveedor_formulario_enviado.get("marca")),
            referencia=normalizar_texto_guardado(proveedor_formulario_enviado.get("referencia")),
            garantia=normalizar_texto_guardado(proveedor_formulario_enviado.get("garantia")),
            disponibilidad=normalizar_texto_guardado(proveedor_formulario_enviado.get("disponibilidad")),
            disponibilidad_cliente=solicitud.disponibilidad_cliente,
            precio=normalizar_texto_guardado(proveedor_formulario_enviado.get("precio")),
            observacion=normalizar_texto_guardado(proveedor_formulario_enviado.get("observacion")),
            comentario_taller=solicitud.comentario_taller,
            fecha_disponible_taller=solicitud.fecha_disponible_taller,
            horario_disponible_taller=solicitud.horario_disponible_taller,
            diagnostico_taller=solicitud.diagnostico_taller,
            servicios_taller=solicitud.servicios_taller,
            horas_taller=solicitud.horas_taller,
            materiales_taller=solicitud.materiales_taller,
            flujo_mantenimiento=solicitud.flujo_mantenimiento,
        )
        db.add(solicitud_cliente)
        db.flush()

        if formularios_restantes:
            for index, proveedor in enumerate(proveedores_estado):
                if str(proveedor.get("id")) == str(data.proveedor_id):
                    proveedores_estado[index] = actualizar_proveedor_desde_formularios(
                        proveedor,
                        formularios_restantes,
                    )
                    break
        else:
            proveedores_estado = [
                proveedor
                for proveedor in proveedores_estado
                if str(proveedor.get("id")) != str(data.proveedor_id)
            ]
        solicitud.proveedores_estado = (
            dump_proveedores_estado(proveedores_estado) if proveedores_estado else None
        )
        rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)
        solicitud.estado = resolve_estado_admin_post_propuesta(
            proveedores_estado,
            solicitud.tipo,
        )
    else:
        if es_solicitud_mantenimiento_taller(solicitud.tipo):
            if solicitud.estado == "pendiente_envio_cliente_taller":
                flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
                flujo_mantenimiento.setdefault("timeline", {})["confirmacion_taller_enviada_cliente_en"] = ahora_iso()
                guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
                solicitud.estado = "espera_cliente"
            else:
                solicitud_cliente = Solicitud(
                    solicitud_origen_id=solicitud.id,
                    usuario_id=solicitud.usuario_id,
                    vehiculo_id=solicitud.vehiculo_id,
                    tipo=solicitud.tipo,
                    descripcion=solicitud.descripcion,
                    estado="enviada_cliente",
                    proveedores_ids=solicitud.proveedores_ids,
                    proveedores_estado=solicitud.proveedores_estado,
                    proveedor_cotizo_id=solicitud.proveedor_cotizo_id,
                    marca=solicitud.marca,
                    referencia=solicitud.referencia,
                    garantia=solicitud.garantia,
                    disponibilidad=solicitud.disponibilidad,
                    disponibilidad_cliente=solicitud.disponibilidad_cliente,
                    precio=solicitud.precio,
                    observacion=solicitud.observacion,
                    comentario_taller=solicitud.comentario_taller,
                    fecha_disponible_taller=solicitud.fecha_disponible_taller,
                    horario_disponible_taller=solicitud.horario_disponible_taller,
                    diagnostico_taller=solicitud.diagnostico_taller,
                    servicios_taller=solicitud.servicios_taller,
                    horas_taller=solicitud.horas_taller,
                    materiales_taller=solicitud.materiales_taller,
                    flujo_mantenimiento=solicitud.flujo_mantenimiento,
                )
                db.add(solicitud_cliente)
                db.flush()
                solicitud.estado = "propuesta_armada"
        else:
            solicitud.estado = (
                "enviada_cliente"
                if es_servicio_cotizable(solicitud.tipo)
                else "enviado_cliente"
            )

    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    is_workshop_schedule = (
        es_solicitud_mantenimiento_taller(solicitud.tipo)
        and solicitud.estado == "espera_cliente"
    )
    notification_service.notify_users(
        db,
        combinar_destinatarios(
            cliente_recipient,
            get_role_recipients(db, "administrador"),
        ),
        f"Solicitud #{numero_caso} actualizada",
        (
            f"Tu solicitud #{numero_caso} ya tiene la informacion del taller para acercarte."
            if is_workshop_schedule
            else f"Tu solicitud #{numero_caso} ya tiene cotizacion disponible para revisar."
        ),
        "informacion_taller_cliente" if is_workshop_schedule else "cotizacion_cliente",
        email_subject=asunto_correo,
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud_raiz,
            numero_caso,
            etapa="Propuesta enviada al cliente" if not is_workshop_schedule else "Informacion de taller enviada al cliente",
            mensaje=(
                f"Tu solicitud #{numero_caso} ya tiene cotizacion disponible para revisar."
                if not is_workshop_schedule
                else f"Tu solicitud #{numero_caso} ya tiene la informacion del taller para acercarte."
            ),
            actor=user["nombre"],
            accion_requerida=(
                "El cliente debe revisar la propuesta y aprobarla o rechazarla."
                if not is_workshop_schedule
                else "El cliente debe confirmar su llegada al taller."
            ),
            detalle_adicional=(
                f"Fecha disponible: {solicitud.fecha_disponible_taller or 'Sin fecha'}\n"
                f"Horario disponible: {solicitud.horario_disponible_taller or 'Sin horario'}\n"
                f"Comentario del taller: {solicitud.comentario_taller or 'Sin comentario'}"
                if is_workshop_schedule
                else (
                    f"Diagnostico: {solicitud_raiz.diagnostico_taller or 'Sin diagnostico'}\n"
                    f"Servicios: {solicitud_raiz.servicios_taller or 'Sin servicios'}\n"
                    f"Repuestos: {solicitud_raiz.materiales_taller or 'Sin repuestos'}"
                )
            ),
        ),
    )
    db.commit()
    db.refresh(solicitud)

    return {"mensaje": "solicitud enviada al cliente", "id": solicitud.id, "estado": solicitud.estado}


@router.patch("/solicitudes/{solicitud_id}/omitir-cliente")
def omitir_solicitud_cliente(
    solicitud_id: int,
    data: SolicitudAdministradorOmitirCotizacion,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede omitir solicitudes del cliente")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    proveedores_estado = parse_proveedores_estado(solicitud.proveedores_estado)

    if data.proveedor_id is not None:
        proveedor_omitido = next(
            (
                proveedor
                for proveedor in proveedores_estado
                if str(proveedor.get("id")) == str(data.proveedor_id)
                and proveedor.get("estado") == "cotizado"
            ),
            None,
        )

        if not proveedor_omitido:
            raise HTTPException(status_code=404, detail="Cotizacion del proveedor no encontrada")

        formularios = extraer_formularios_proveedor(proveedor_omitido)
        omitir_proveedor_completo = data.response_index is None

        if omitir_proveedor_completo:
            proveedor_formulario_omitido = construir_proveedor_desde_formularios(
                proveedor_omitido,
                formularios,
            )
            formularios_restantes: list[dict] = []
        else:
            response_index = data.response_index or 0

            if response_index < 0 or response_index >= len(formularios):
                raise HTTPException(status_code=404, detail="Formulario de cotizacion no encontrado")

            formulario_omitido = formularios[response_index]
            proveedor_formulario_omitido = construir_proveedor_desde_formulario(
                proveedor_omitido,
                formulario_omitido,
            )
            formularios_restantes = [
                formulario
                for index, formulario in enumerate(formularios)
                if index != response_index
            ]

        historial_admin = Solicitud(
            solicitud_origen_id=solicitud.id,
            usuario_id=solicitud.usuario_id,
            vehiculo_id=solicitud.vehiculo_id,
            tipo=solicitud.tipo,
            descripcion=solicitud.descripcion,
            estado="omitida_admin",
            proveedores_estado=dump_proveedores_estado([proveedor_formulario_omitido]),
            proveedor_cotizo_id=proveedor_omitido.get("id"),
            marca=normalizar_texto_guardado(proveedor_formulario_omitido.get("marca")),
            referencia=normalizar_texto_guardado(proveedor_formulario_omitido.get("referencia")),
            garantia=normalizar_texto_guardado(proveedor_formulario_omitido.get("garantia")),
            disponibilidad=normalizar_texto_guardado(proveedor_formulario_omitido.get("disponibilidad")),
            disponibilidad_cliente=solicitud.disponibilidad_cliente,
            precio=normalizar_texto_guardado(proveedor_formulario_omitido.get("precio")),
            observacion=normalizar_texto_guardado(proveedor_formulario_omitido.get("observacion")),
            comentario_taller=solicitud.comentario_taller,
            fecha_disponible_taller=solicitud.fecha_disponible_taller,
            horario_disponible_taller=solicitud.horario_disponible_taller,
            diagnostico_taller=solicitud.diagnostico_taller,
            servicios_taller=solicitud.servicios_taller,
            horas_taller=solicitud.horas_taller,
            materiales_taller=solicitud.materiales_taller,
            flujo_mantenimiento=solicitud.flujo_mantenimiento,
        )
        db.add(historial_admin)

        if formularios_restantes:
            for index, proveedor in enumerate(proveedores_estado):
                if str(proveedor.get("id")) == str(data.proveedor_id):
                    proveedores_estado[index] = actualizar_proveedor_desde_formularios(
                        proveedor,
                        formularios_restantes,
                    )
                    break
        else:
            proveedores_estado = [
                proveedor
                for proveedor in proveedores_estado
                if str(proveedor.get("id")) != str(data.proveedor_id)
            ]
        solicitud.proveedores_estado = (
            dump_proveedores_estado(proveedores_estado) if proveedores_estado else None
        )
        rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)
        solicitud.estado = resolve_estado_desde_proveedores(proveedores_estado, solicitud.tipo)
    else:
        historial_admin = Solicitud(
            solicitud_origen_id=solicitud.id,
            usuario_id=solicitud.usuario_id,
            vehiculo_id=solicitud.vehiculo_id,
            tipo=solicitud.tipo,
            descripcion=solicitud.descripcion,
            estado="omitida_admin",
            proveedores_ids=solicitud.proveedores_ids,
            proveedores_estado=solicitud.proveedores_estado,
            proveedor_cotizo_id=solicitud.proveedor_cotizo_id,
            marca=solicitud.marca,
            referencia=solicitud.referencia,
            garantia=solicitud.garantia,
            disponibilidad=solicitud.disponibilidad,
            disponibilidad_cliente=solicitud.disponibilidad_cliente,
            precio=solicitud.precio,
            observacion=solicitud.observacion,
            comentario_taller=solicitud.comentario_taller,
            fecha_disponible_taller=solicitud.fecha_disponible_taller,
            horario_disponible_taller=solicitud.horario_disponible_taller,
            diagnostico_taller=solicitud.diagnostico_taller,
            servicios_taller=solicitud.servicios_taller,
            horas_taller=solicitud.horas_taller,
            materiales_taller=solicitud.materiales_taller,
            flujo_mantenimiento=solicitud.flujo_mantenimiento,
        )
        db.add(historial_admin)

        solicitud.estado = (
            "diagnosticada"
            if es_solicitud_mantenimiento_taller(solicitud.tipo)
            else "en_revision"
            if es_servicio_cotizable(solicitud.tipo)
            else "pendiente"
        )
        solicitud.proveedores_ids = None
        solicitud.proveedores_estado = None
        solicitud.proveedor_cotizo_id = None
        solicitud.marca = None
        solicitud.referencia = None
        solicitud.garantia = None
        solicitud.disponibilidad = None
        solicitud.precio = None
        solicitud.observacion = None

    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} omitida",
        f"La solicitud #{numero_caso} guardo una cotizacion en historial administrativo.",
        "solicitud_omitida_admin",
        email_subject=obtener_asunto_correo_solicitud(solicitud_raiz),
        email_template="generic_notification",
        email_context={
            "mensaje": f"La solicitud #{numero_caso} guardo una cotizacion en historial administrativo.",
            "referencia": f"Solicitud #{numero_caso}",
        },
    )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "cotizacion omitida y enviada al historial administrativo",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/respuesta-proveedor")
def responder_cotizacion_proveedor(
    solicitud_id: int,
    data: SolicitudRespuestaProveedorUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "proveedor":
        raise HTTPException(status_code=403, detail="Solo el proveedor puede cotizar")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    proveedores_ids = parse_proveedores_ids(solicitud.proveedores_ids)
    proveedores_estado = parse_proveedores_estado(solicitud.proveedores_estado)
    if user["id"] not in proveedores_ids:
        raise HTTPException(status_code=403, detail="Esta solicitud no fue asignada a este proveedor")

    numero_caso = obtener_numero_caso(solicitud)
    es_mantenimiento_taller = es_solicitud_mantenimiento_taller(solicitud.tipo)
    documento_excel_nombre = normalizar_texto_guardado(data.documento_excel_nombre)
    documento_excel_mime = normalizar_texto_guardado(data.documento_excel_mime)
    documento_excel_base64 = normalizar_texto_guardado(data.documento_excel_base64)
    cotizacion_excel = extraer_cotizacion_desde_excel_base64(documento_excel_base64)

    marca = data.marca.strip()
    referencia = data.referencia.strip()
    garantia = data.garantia.strip()
    disponibilidad = data.disponibilidad.strip()
    precio = data.precio.strip()
    observacion = data.observacion.strip()

    if es_mantenimiento_taller:
        if not documento_excel_nombre or not documento_excel_base64:
            raise HTTPException(
                status_code=400,
                detail="Debes cargar el documento Excel de la cotizacion para solicitudes de mantenimiento",
            )
        if cotizacion_excel:
            marca = cotizacion_excel.get("marca", "").strip()
            referencia = cotizacion_excel.get("referencia", "").strip()
            garantia = cotizacion_excel.get("garantia", "").strip()
            disponibilidad = cotizacion_excel.get("disponibilidad", "").strip()
            precio = cotizacion_excel.get("precio", "").strip()
            observacion = cotizacion_excel.get("observacion", "").strip()
    else:
        required_fields = [
            marca,
            referencia,
            garantia,
            disponibilidad,
            precio,
            observacion,
        ]
        if any(not field for field in required_fields):
            raise HTTPException(
                status_code=400,
                detail="Debes completar todos los campos de la cotizacion",
            )

    proveedores_restantes = [proveedor_id for proveedor_id in proveedores_ids if proveedor_id != user["id"]]
    solicitud.proveedores_ids = ",".join(str(proveedor_id) for proveedor_id in proveedores_restantes) or None
    for proveedor in proveedores_estado:
        if str(proveedor.get("id")) == str(user["id"]):
            proveedor["estado"] = "cotizado"
            proveedor["marca"] = marca
            proveedor["referencia"] = referencia
            proveedor["garantia"] = garantia
            proveedor["disponibilidad"] = disponibilidad
            proveedor["precio"] = precio
            proveedor["observacion"] = observacion
            proveedor["documento_excel_nombre"] = documento_excel_nombre
            proveedor["documento_excel_mime"] = documento_excel_mime
            proveedor["documento_excel_base64"] = documento_excel_base64
            proveedor["fecha_recepcion"] = proveedor.get("fecha_recepcion") or (
                datetime.now(timezone.utc).isoformat()
            )
    solicitud.proveedores_estado = dump_proveedores_estado(proveedores_estado)
    rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)
    solicitud.estado = (
        "en_cotizacion" if proveedores_restantes and es_servicio_cotizable(solicitud.tipo)
        else "cotizando" if proveedores_restantes
        else resolve_estado_desde_proveedores(proveedores_estado, solicitud.tipo)
    )
    notification_service.notify_users(
        db,
        combinar_destinatarios(
            get_role_recipients(db, "administrador"),
            get_user_recipient(db, user["id"]),
        ),
        f"Solicitud #{numero_caso} cotizacion recibida",
        f"El proveedor {user['nombre']} respondio la solicitud #{numero_caso}.",
        "respuesta_proveedor",
        email_subject=obtener_asunto_correo_solicitud(solicitud),
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Cotizacion recibida de proveedor",
            mensaje=f"El proveedor {user['nombre']} respondio la solicitud #{numero_caso}.",
            actor=user["nombre"],
            accion_requerida="El administrador debe revisar la cotizacion y preparar la propuesta para el cliente.",
        ),
    )
    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "cotizacion enviada al administrador",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/devolver-proveedor")
def devolver_solicitud_proveedor(
    solicitud_id: int,
    data: SolicitudProveedorDevolucion,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "proveedor":
        raise HTTPException(status_code=403, detail="Solo el proveedor puede devolver solicitudes")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    proveedores_ids = parse_proveedores_ids(solicitud.proveedores_ids)
    proveedores_estado = parse_proveedores_estado(solicitud.proveedores_estado)
    if user["id"] not in proveedores_ids:
        raise HTTPException(status_code=403, detail="Esta solicitud no fue asignada a este proveedor")

    numero_caso = obtener_numero_caso(solicitud)
    proveedores_restantes = [proveedor_id for proveedor_id in proveedores_ids if proveedor_id != user["id"]]
    solicitud.proveedores_ids = ",".join(str(proveedor_id) for proveedor_id in proveedores_restantes) or None
    for proveedor in proveedores_estado:
        if str(proveedor.get("id")) == str(user["id"]):
            proveedor["estado"] = "devuelto"
            proveedor["comentario"] = data.comentario.strip()
    solicitud.proveedores_estado = dump_proveedores_estado(proveedores_estado)
    rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)

    if proveedores_restantes:
        solicitud.estado = "en_cotizacion" if es_servicio_cotizable(solicitud.tipo) else "cotizando"
    else:
        solicitud.estado = resolve_estado_desde_proveedores(proveedores_estado, solicitud.tipo)
        if solicitud.estado in {"devuelto_proveedor", "rechazada_proveedor"}:
            solicitud.observacion = data.comentario.strip()

    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} devuelta por proveedor",
        f"Se ha devuelto tu solicitud #{numero_caso} con el comentario: {data.comentario.strip()}",
        "devolucion_proveedor",
        email_subject=obtener_asunto_correo_solicitud(solicitud),
        email_template="generic_notification",
        email_context={
            "mensaje": f"Se ha devuelto tu solicitud #{numero_caso} con el comentario: {data.comentario.strip()}",
            "referencia": f"Solicitud #{numero_caso}",
        },
    )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud devuelta al administrador",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/devolver-cliente")
def devolver_solicitud_cliente(
    solicitud_id: int,
    data: SolicitudAdministradorDevolucion,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede devolver solicitudes al cliente")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    solicitud.estado = (
        "rechazada_admin"
        if es_solicitud_mantenimiento_taller(solicitud.tipo)
        else "rechazada_cliente"
        if es_servicio_cotizable(solicitud.tipo)
        else "devuelta"
    )
    solicitud.observacion = data.comentario.strip()
    numero_caso = obtener_numero_caso(solicitud)

    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_user(
            db,
            cliente_recipient,
            f"Solicitud #{numero_caso} devuelta al cliente",
            f"Tu solicitud #{numero_caso} fue devuelta con el comentario: {data.comentario.strip()}",
            "devolucion_cliente",
            email_subject=obtener_asunto_correo_solicitud(solicitud),
            email_template="generic_notification",
            email_context={
                "mensaje": f"Tu solicitud #{numero_caso} fue devuelta con el comentario: {data.comentario.strip()}",
                "referencia": f"Solicitud #{numero_caso}",
            },
        )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud devuelta al cliente",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/aprobar-cliente")
def aprobar_solicitud_cliente(
    solicitud_id: int,
    data: SolicitudClienteAprobacion | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "cliente":
        raise HTTPException(status_code=403, detail="Solo el cliente puede aprobar solicitudes")

    solicitud = (
        db.query(Solicitud)
        .filter(Solicitud.id == solicitud_id, Solicitud.usuario_id == user["id"])
        .first()
    )

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    estados_validos_cliente = {"enviada_cliente", "enviado_cliente"}
    if solicitud.estado not in estados_validos_cliente:
        raise HTTPException(status_code=400, detail="La solicitud no esta disponible para aprobacion")

    root_id = obtener_solicitud_raiz_id(solicitud)
    numero_caso = obtener_numero_caso(solicitud)
    solicitud_aprobada_id = solicitud.id
    proveedor_aprobado_id = solicitud.proveedor_cotizo_id
    estado_post_aprobacion = "aprobada"
    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    flujo_mantenimiento.setdefault("timeline", {})["cliente_aprueba_propuesta_en"] = ahora_iso()
    guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
    solicitud.estado = estado_post_aprobacion
    comentario_aprobacion = (data.comentario or "").strip() if data else ""
    if comentario_aprobacion:
        solicitud.comentario_proveedor = comentario_aprobacion

    solicitud_origen = (
        db.query(Solicitud)
        .filter(Solicitud.id == root_id, Solicitud.usuario_id == user["id"])
        .first()
    )
    if solicitud_origen:
        solicitud_origen.estado = estado_post_aprobacion
        solicitud_origen.proveedor_cotizo_id = solicitud.proveedor_cotizo_id
        solicitud_origen.proveedores_ids = solicitud.proveedores_ids
        solicitud_origen.proveedores_estado = solicitud.proveedores_estado
        solicitud_origen.marca = solicitud.marca
        solicitud_origen.referencia = solicitud.referencia
        solicitud_origen.garantia = solicitud.garantia
        solicitud_origen.disponibilidad = solicitud.disponibilidad
        solicitud_origen.precio = solicitud.precio
        solicitud_origen.observacion = solicitud.observacion
        solicitud_origen.comentario_proveedor = solicitud.comentario_proveedor
        solicitud_origen.comentario_taller = solicitud.comentario_taller
        solicitud_origen.fecha_disponible_taller = solicitud.fecha_disponible_taller
        solicitud_origen.horario_disponible_taller = solicitud.horario_disponible_taller
        solicitud_origen.diagnostico_taller = solicitud.diagnostico_taller
        solicitud_origen.servicios_taller = solicitud.servicios_taller
        solicitud_origen.horas_taller = solicitud.horas_taller
        solicitud_origen.materiales_taller = solicitud.materiales_taller
        solicitud_origen.flujo_mantenimiento = solicitud.flujo_mantenimiento
    finalizar_solicitudes_hijas(
        db,
        root_id,
        exclude_ids={
            item_id
            for item_id in [
                solicitud_origen.id if solicitud_origen else None,
                solicitud_aprobada_id,
            ]
            if item_id is not None
        },
    )

    notification_service.notify_users(
        db,
        combinar_destinatarios(
            get_role_recipients(db, "administrador"),
            get_user_recipient(db, solicitud.usuario_id),
        ),
        f"Solicitud #{numero_caso} aprobada por cliente",
        f"El cliente {user['nombre']} aprobo la solicitud #{numero_caso}.",
        "aprobacion_cliente",
        email_subject=obtener_asunto_correo_solicitud(solicitud),
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Propuesta aprobada por cliente",
            mensaje=f"El cliente {user['nombre']} aprobo la solicitud #{numero_caso}.",
            actor=user["nombre"],
            accion_requerida="El administrador debe continuar el flujo y coordinar con taller y proveedor.",
            detalle_adicional=(
                f"Comentario del cliente: {comentario_aprobacion}"
                if comentario_aprobacion
                else "El cliente no agrego comentarios."
            ),
        ),
    )

    if proveedor_aprobado_id:
        proveedor_recipient = get_user_recipient(db, int(proveedor_aprobado_id))
        if proveedor_recipient:
            notification_service.notify_user(
                db,
                proveedor_recipient,
                f"Solicitud #{numero_caso} aprobada",
                (
                    f"El cliente aprobo la solicitud #{numero_caso}."
                    + (
                        " Debes confirmar el despacho de repuestos."
                        if es_solicitud_mantenimiento_taller(solicitud.tipo)
                        else " Ya puedes ejecutar el servicio."
                    )
                    + (f"\nComentario del cliente: {comentario_aprobacion}" if comentario_aprobacion else "")
                ),
                "aprobacion_proveedor",
                email_subject=obtener_asunto_correo_solicitud(solicitud),
                email_template="maintenance_flow_notification",
                email_context=build_flow_email_context(
                    solicitud,
                    numero_caso,
                    etapa="Solicitud aprobada para proveedor",
                    mensaje=(
                        f"El cliente aprobo la solicitud #{numero_caso}."
                        + (
                            " Debes confirmar el despacho de repuestos."
                            if es_solicitud_mantenimiento_taller(solicitud.tipo)
                            else " Ya puedes ejecutar el servicio."
                        )
                    ),
                    actor=user["nombre"],
                    accion_requerida=(
                        "Confirmar el despacho de repuestos."
                        if es_solicitud_mantenimiento_taller(solicitud.tipo)
                        else "Ejecutar el servicio aprobado."
                    ),
                    detalle_adicional=(
                        f"Comentario del cliente: {comentario_aprobacion}"
                        if comentario_aprobacion
                        else "El cliente no agrego comentarios."
                    ),
                ),
            )

    if es_solicitud_mantenimiento_taller(solicitud.tipo):
        notification_service.notify_users(
            db,
            [
                recipient
                for recipient in (
                    get_user_recipient(db, taller_id)
                    for taller_id in get_taller_ids_for_solicitud(solicitud)
                )
                if recipient is not None
            ],
            f"Solicitud #{numero_caso} aprobada",
            (
                f"El cliente aprobo la solicitud #{numero_caso}."
                + (
                    " El taller ya puede iniciar la intervencion."
                    if es_solicitud_mantenimiento_taller(solicitud.tipo)
                    else " El taller ya puede ejecutar el servicio."
                )
            ),
            "aprobacion_taller",
            email_subject=obtener_asunto_correo_solicitud(solicitud),
            email_template="maintenance_flow_notification",
            email_context=build_flow_email_context(
                solicitud,
                numero_caso,
                etapa="Solicitud aprobada para taller",
                mensaje=(
                    f"El cliente aprobo la solicitud #{numero_caso}."
                    + (
                        " El taller ya puede iniciar la intervencion."
                        if es_solicitud_mantenimiento_taller(solicitud.tipo)
                        else " El taller ya puede ejecutar el servicio."
                    )
                ),
                actor=user["nombre"],
                accion_requerida=(
                    "Iniciar la intervencion del vehiculo."
                    if es_solicitud_mantenimiento_taller(solicitud.tipo)
                    else "Ejecutar el servicio aprobado."
                ),
            ),
        )

    db.commit()
    db.refresh(solicitud_origen or solicitud)

    return {
        "mensaje": "solicitud aprobada por el cliente",
        "id": solicitud_origen.id if solicitud_origen else solicitud_aprobada_id,
        "estado": solicitud_origen.estado if solicitud_origen else solicitud.estado,
    }


@router.patch("/solicitudes/{solicitud_id}/rechazar-oferta-cliente")
def rechazar_oferta_cliente(
    solicitud_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "cliente":
        raise HTTPException(status_code=403, detail="Solo el cliente puede rechazar ofertas")

    solicitud = (
        db.query(Solicitud)
        .filter(Solicitud.id == solicitud_id, Solicitud.usuario_id == user["id"])
        .first()
    )
    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    if solicitud.estado not in {"enviada_cliente", "enviado_cliente"}:
        raise HTTPException(status_code=400, detail="La oferta ya no esta disponible")

    root_id = obtener_solicitud_raiz_id(solicitud)
    solicitud_origen = (
        db.query(Solicitud)
        .filter(Solicitud.id == root_id, Solicitud.usuario_id == user["id"])
        .first()
    )
    if solicitud_origen:
        solicitud_origen.estado = "finalizada"
    finalizar_solicitudes_hijas(db, root_id)

    db.commit()
    if solicitud_origen:
        db.refresh(solicitud_origen)

    return {
        "mensaje": "oferta rechazada por el cliente",
        "id": solicitud_origen.id if solicitud_origen else solicitud.id,
        "estado": solicitud_origen.estado if solicitud_origen else "finalizada",
    }


@router.patch("/solicitudes/{solicitud_id}/llegada-taller")
def confirmar_llegada_taller(
    solicitud_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "cliente":
        raise HTTPException(status_code=403, detail="Solo el cliente puede confirmar la llegada al taller")

    solicitud = (
        db.query(Solicitud)
        .filter(Solicitud.id == solicitud_id, Solicitud.usuario_id == user["id"])
        .first()
    )
    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    estados_validos_llegada = {"espera_cliente", "pendiente_envio_cliente_taller"}

    if solicitud.estado not in estados_validos_llegada:
        solicitud_en_espera = (
            db.query(Solicitud)
            .filter(
                Solicitud.usuario_id == user["id"],
                Solicitud.solicitud_origen_id == solicitud.id,
                Solicitud.estado.in_(estados_validos_llegada),
            )
            .order_by(Solicitud.id.desc())
            .first()
        )
        if solicitud_en_espera:
            solicitud = solicitud_en_espera
        else:
            raise HTTPException(status_code=400, detail="La solicitud no esta esperando la llegada del cliente")

    previous_status = solicitud.estado
    flujo_mantenimiento = ensure_flujo_mantenimiento(solicitud)
    flujo_mantenimiento.setdefault("timeline", {})["cliente_llego_taller_en"] = ahora_iso()
    guardar_flujo_mantenimiento(solicitud, flujo_mantenimiento)
    solicitud.estado = "en_diagnostico" if es_solicitud_mantenimiento_taller(solicitud.tipo) else "en_reparacion"
    numero_caso = obtener_numero_caso(solicitud)
    sincronizar_solicitud_raiz_con_hija(db, solicitud)

    mensaje_llegada = (
        f"El cliente confirmo la llegada al taller para la solicitud #{numero_caso}. El taller puede iniciar el diagnostico."
        if es_solicitud_mantenimiento_taller(solicitud.tipo)
        else f"El cliente confirmo la llegada al taller para la solicitud #{numero_caso}."
    )

    talleres_recipients = [
        get_user_recipient(db, taller_id)
        for taller_id in get_taller_ids_for_solicitud(solicitud)
    ]
    talleres_recipients = [recipient for recipient in talleres_recipients if recipient]

    if talleres_recipients:
        notification_service.notify_users(
            db,
            talleres_recipients,
            f"Solicitud #{numero_caso} actualizada",
            mensaje_llegada,
            "llegada_taller_cliente",
            email_subject=obtener_asunto_correo_solicitud(solicitud),
            email_template="maintenance_flow_notification",
            email_context=build_flow_email_context(
                solicitud,
                numero_caso,
                etapa="Llegada del cliente al taller",
                mensaje=mensaje_llegada,
                actor=user["nombre"],
                accion_requerida="El taller puede continuar con el diagnostico o la intervencion.",
            ),
        )
    elif solicitud.proveedor_cotizo_id:
        proveedor_recipient = get_user_recipient(db, int(solicitud.proveedor_cotizo_id))
        if proveedor_recipient:
            notification_service.notify_user(
                db,
                proveedor_recipient,
                f"Solicitud #{numero_caso} actualizada",
                mensaje_llegada,
                "llegada_taller_cliente",
                email_subject=obtener_asunto_correo_solicitud(solicitud),
                email_template="maintenance_flow_notification",
                email_context=build_flow_email_context(
                    solicitud,
                    numero_caso,
                    etapa="Llegada del cliente al taller",
                    mensaje=mensaje_llegada,
                    actor=user["nombre"],
                    accion_requerida="Continuar con el servicio programado.",
                ),
            )

    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} actualizada",
        mensaje_llegada,
        "llegada_taller_cliente",
        email_subject=obtener_asunto_correo_solicitud(solicitud),
        email_template="maintenance_flow_notification",
        email_context=build_flow_email_context(
            solicitud,
            numero_caso,
            etapa="Llegada del cliente al taller",
            mensaje=mensaje_llegada,
            actor=user["nombre"],
            accion_requerida="El administrador puede hacer seguimiento al avance del caso.",
        ),
    )

    cliente_recipient = get_user_recipient(db, solicitud.usuario_id)
    if cliente_recipient:
        notification_service.notify_solicitud_status_changed(
            db,
            solicitud,
            cliente_recipient,
            previous_status,
            actor_name=user["nombre"],
        )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "llegada al taller confirmada",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }
