import json
from datetime import datetime, timezone

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

    return (
        es_servicio_cotizable(servicio)
        and (
            ":" in servicio
            or "," in servicio
            or "mantenimiento" in servicio
            or "diagnostico" in servicio
            or "escaneo" in servicio
            or "motor" in servicio
            or "suspension" in servicio
            or "alineacion" in servicio
        )
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
        email_template="generic_notification",
        email_context={
            "mensaje": (
                f"El cliente {user['nombre']} creo la solicitud #{numero_caso}.\n"
                f"Tipo de servicio: {solicitud.tipo}\n"
                f"Disponibilidad del cliente: {solicitud.disponibilidad_cliente or 'No registrada'}\n"
                f"Estado inicial: {solicitud.estado}"
            ),
            "referencia": f"Solicitud #{numero_caso}",
        },
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
      proveedores = [usuarios_map.get(pid) for pid in proveedores_ids if pid in usuarios_map]
      proveedores = [p for p in proveedores if p is not None]
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
      if user["rol"] == "taller" and user["id"] not in proveedores_ids:
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
              "proveedores_estado": proveedores_estado,
              "cotizacion": {
                  "proveedor_id": solicitud.proveedor_cotizo_id,
                  "marca": solicitud.marca,
                  "referencia": solicitud.referencia,
                  "garantia": solicitud.garantia,
                  "disponibilidad": solicitud.disponibilidad,
                  "precio": solicitud.precio,
                  "observacion": solicitud.observacion,
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

    if user["rol"] == "proveedor":
        if not es_servicio_cotizable(solicitud.tipo):
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

        if data.estado not in {"espera_cliente", "en_reparacion", "finalizada"}:
            raise HTTPException(
                status_code=403,
                detail="El proveedor solo puede mover a espera_cliente, en_reparacion o finalizada",
            )

    if user["rol"] == "taller":
        if user["id"] not in parse_proveedores_ids(solicitud.proveedores_ids):
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
    solicitud.estado = data.estado
    numero_caso = obtener_numero_caso(solicitud)

    if user["rol"] == "proveedor":
        comentario = (data.comentario or "").strip()
        if comentario:
            solicitud.comentario_proveedor = comentario
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

    if user["rol"] == "proveedor" and data.estado in {"espera_cliente", "en_reparacion", "finalizada"}:
        notification_service.notify_users(
            db,
            combinar_destinatarios(
                administradores,
                get_user_recipient(db, user["id"]),
            ),
            f"Solicitud #{numero_caso} actualizada",
            f"El proveedor {user['nombre']} cambio la solicitud #{numero_caso} a {data.estado}.",
            "estado_solicitud",
            email_subject=asunto_correo,
            email_template="generic_notification",
            email_context={
                "mensaje": f"El proveedor {user['nombre']} cambio la solicitud #{numero_caso} a {data.estado}.",
                "referencia": f"Solicitud #{numero_caso}",
            },
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

    if user["id"] not in parse_proveedores_ids(solicitud.proveedores_ids):
        raise HTTPException(status_code=403, detail="Esta solicitud no fue asignada a este taller")

    horas = data.horas.strip()
    if not horas:
        raise HTTPException(status_code=400, detail="Debes indicar las horas estimadas")

    if len(horas) > 20:
        raise HTTPException(status_code=400, detail="El formato de horas no es valido")

    previous_status = solicitud.estado
    solicitud.diagnostico_taller = data.diagnostico.strip()
    solicitud.servicios_taller = data.servicios.strip()
    solicitud.horas_taller = horas
    solicitud.materiales_taller = data.materiales.strip()
    solicitud.estado = "diagnosticada"
    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)

    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} diagnosticada",
        f"El taller {user['nombre']} envio cotizacion y diagnostico para la solicitud #{numero_caso}.",
        "diagnostico_taller",
        email_subject=asunto_correo,
        email_template="generic_notification",
        email_context={
            "mensaje": f"El taller {user['nombre']} envio cotizacion y diagnostico para la solicitud #{numero_caso}.",
            "referencia": f"Solicitud #{numero_caso}",
        },
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

    if user["id"] not in parse_proveedores_ids(solicitud.proveedores_ids):
        raise HTTPException(status_code=403, detail="Esta solicitud no fue asignada a este taller")

    comentario = data.comentario.strip()
    fecha_disponible = data.fecha_disponible.strip()
    horario_disponible = data.horario_disponible.strip()

    if not comentario or not fecha_disponible or not horario_disponible:
        raise HTTPException(status_code=400, detail="Debes completar comentario, fecha y horario")

    previous_status = solicitud.estado
    solicitud.comentario_taller = comentario
    solicitud.fecha_disponible_taller = fecha_disponible
    solicitud.horario_disponible_taller = horario_disponible
    solicitud.estado = "pendiente_envio_cliente_taller"
    numero_caso = obtener_numero_caso(solicitud)
    asunto_correo = obtener_asunto_correo_solicitud(solicitud)

    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} aprobada por taller",
        (
            f"El taller {user['nombre']} aprobo la solicitud #{numero_caso} y propuso "
            f"fecha {fecha_disponible} en horario {horario_disponible}."
        ),
        "respuesta_taller",
        email_subject=asunto_correo,
        email_template="generic_notification",
        email_context={
            "mensaje": (
                f"El taller {user['nombre']} aprobo la solicitud #{numero_caso}.\n"
                f"Fecha disponible: {fecha_disponible}\n"
                f"Horario disponible: {horario_disponible}\n"
                f"Comentario: {comentario}"
            ),
            "referencia": f"Solicitud #{numero_caso}",
        },
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
        "mensaje": "respuesta del taller enviada al administrador",
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
            }
            for proveedor in proveedores
        ]
    )
    solicitud.estado = "en_cotizacion" if es_servicio_cotizable(solicitud.tipo) else "cotizando"
    notification_service.notify_users(
        db,
        [build_recipient(proveedor) for proveedor in proveedores],
        f"Solicitud #{numero_caso} enviada a cotizacion",
        f"El administrador te envio la solicitud #{numero_caso} para cotizar.",
        "solicitud_proveedor",
        email_subject=asunto_correo,
        email_template="generic_notification",
        email_context={
            "mensaje": f"El administrador te envio la solicitud #{numero_caso} para cotizar.",
            "referencia": f"Solicitud #{numero_caso}",
        },
    )
    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} enviada a cotizacion",
        f"Enviaste la solicitud #{numero_caso} para cotizar.",
        "solicitud_proveedor",
        email_subject=asunto_correo,
        email_template="generic_notification",
        email_context={
            "mensaje": f"Enviaste la solicitud #{numero_caso} para cotizar.",
            "referencia": f"Solicitud #{numero_caso}",
        },
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
            email_template="generic_notification",
            email_context={
                "mensaje": (
                    f"El administrador envio tu solicitud #{numero_caso} a proveedores para cotizar.\n"
                    f"Tipo de servicio: {solicitud.tipo or 'No especificado'}"
                ),
                "referencia": f"Solicitud #{numero_caso}",
            },
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
    solicitud.proveedores_ids = ",".join(str(taller.id) for taller in talleres)
    solicitud.proveedores_estado = None
    solicitud.estado = "en_asignacion_taller"

    notification_service.notify_users(
        db,
        [build_recipient(taller) for taller in talleres],
        f"Solicitud #{numero_caso} nueva",
        f"El administrador te envio la solicitud #{numero_caso} para revision en taller.",
        "solicitud_taller",
        email_subject=asunto_correo,
        email_template="generic_notification",
        email_context={
            "mensaje": (
                f"El administrador te envio la solicitud #{numero_caso} para revision en taller.\n"
                f"Disponibilidad del cliente: {solicitud.disponibilidad_cliente or 'No registrada'}"
            ),
            "referencia": f"Solicitud #{numero_caso}",
        },
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
            email_template="generic_notification",
            email_context={
                "mensaje": (
                    f"Tu solicitud #{numero_caso} fue enviada a taller.\n"
                    f"Disponibilidad registrada: {solicitud.disponibilidad_cliente or 'No registrada'}"
                ),
                "referencia": f"Solicitud #{numero_caso}",
            },
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
        response_index = data.response_index or 0

        if response_index < 0 or response_index >= len(formularios):
            raise HTTPException(status_code=404, detail="Formulario de cotizacion no encontrado")

        formulario_enviado = formularios[response_index]
        proveedor_formulario_enviado = construir_proveedor_desde_formulario(
            proveedor_enviado,
            formulario_enviado,
        )

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
            marca=normalizar_texto_guardado(formulario_enviado.get("marca")),
            referencia=normalizar_texto_guardado(formulario_enviado.get("referencia")),
            garantia=normalizar_texto_guardado(formulario_enviado.get("garantia")),
            disponibilidad=normalizar_texto_guardado(formulario_enviado.get("disponibilidad")),
            disponibilidad_cliente=solicitud.disponibilidad_cliente,
            precio=normalizar_texto_guardado(formulario_enviado.get("precio")),
            observacion=normalizar_texto_guardado(formulario_enviado.get("observacion")),
            comentario_taller=solicitud.comentario_taller,
            fecha_disponible_taller=solicitud.fecha_disponible_taller,
            horario_disponible_taller=solicitud.horario_disponible_taller,
            diagnostico_taller=solicitud.diagnostico_taller,
            servicios_taller=solicitud.servicios_taller,
            horas_taller=solicitud.horas_taller,
            materiales_taller=solicitud.materiales_taller,
        )
        db.add(solicitud_cliente)
        db.flush()

        formularios_restantes = [
            formulario
            for index, formulario in enumerate(formularios)
            if index != response_index
        ]
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
        solicitud.estado = (
            "propuesta_armada"
            if es_solicitud_mantenimiento_taller(solicitud.tipo)
            else resolve_estado_desde_proveedores(proveedores_estado, solicitud.tipo)
        )
    else:
        if es_solicitud_mantenimiento_taller(solicitud.tipo):
            if solicitud.estado == "pendiente_envio_cliente_taller":
                solicitud.estado = "aprobada"
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
        and solicitud.estado == "aprobada"
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
        email_template="generic_notification",
        email_context={
            "mensaje": (
                f"Tu solicitud #{numero_caso} ya tiene la informacion del taller.\n"
                f"Fecha disponible: {solicitud.fecha_disponible_taller or 'Sin fecha'}\n"
                f"Horario disponible: {solicitud.horario_disponible_taller or 'Sin horario'}\n"
                f"Comentario del taller: {solicitud.comentario_taller or 'Sin comentario'}"
                if is_workshop_schedule
                else f"Tu solicitud #{numero_caso} ya tiene cotizacion disponible para revisar."
            ),
            "referencia": f"Solicitud #{numero_caso}",
        },
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
        response_index = data.response_index or 0

        if response_index < 0 or response_index >= len(formularios):
            raise HTTPException(status_code=404, detail="Formulario de cotizacion no encontrado")

        formulario_omitido = formularios[response_index]

        historial_admin = Solicitud(
            solicitud_origen_id=solicitud.id,
            usuario_id=solicitud.usuario_id,
            vehiculo_id=solicitud.vehiculo_id,
            tipo=solicitud.tipo,
            descripcion=solicitud.descripcion,
            estado="omitida_admin",
            proveedores_estado=dump_proveedores_estado([proveedor_omitido]),
            proveedor_cotizo_id=proveedor_omitido.get("id"),
            marca=normalizar_texto_guardado(formulario_omitido.get("marca")),
            referencia=normalizar_texto_guardado(formulario_omitido.get("referencia")),
            garantia=normalizar_texto_guardado(formulario_omitido.get("garantia")),
            disponibilidad=normalizar_texto_guardado(formulario_omitido.get("disponibilidad")),
            disponibilidad_cliente=solicitud.disponibilidad_cliente,
            precio=normalizar_texto_guardado(formulario_omitido.get("precio")),
            observacion=normalizar_texto_guardado(formulario_omitido.get("observacion")),
            comentario_taller=solicitud.comentario_taller,
            fecha_disponible_taller=solicitud.fecha_disponible_taller,
            horario_disponible_taller=solicitud.horario_disponible_taller,
            diagnostico_taller=solicitud.diagnostico_taller,
            servicios_taller=solicitud.servicios_taller,
            horas_taller=solicitud.horas_taller,
            materiales_taller=solicitud.materiales_taller,
        )
        db.add(historial_admin)

        formularios_restantes = [
            formulario
            for index, formulario in enumerate(formularios)
            if index != response_index
        ]
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
    proveedores_restantes = [proveedor_id for proveedor_id in proveedores_ids if proveedor_id != user["id"]]
    solicitud.proveedores_ids = ",".join(str(proveedor_id) for proveedor_id in proveedores_restantes) or None
    for proveedor in proveedores_estado:
        if str(proveedor.get("id")) == str(user["id"]):
            proveedor["estado"] = "cotizado"
            proveedor["marca"] = data.marca.strip()
            proveedor["referencia"] = data.referencia.strip()
            proveedor["garantia"] = data.garantia.strip()
            proveedor["disponibilidad"] = data.disponibilidad.strip()
            proveedor["precio"] = data.precio.strip()
            proveedor["observacion"] = data.observacion.strip()
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
        email_template="generic_notification",
        email_context={
            "mensaje": f"El proveedor {user['nombre']} respondio la solicitud #{numero_caso}.",
            "referencia": f"Solicitud #{numero_caso}",
        },
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
        email_template="generic_notification",
        email_context={
            "mensaje": (
                f"El cliente {user['nombre']} aprobo la solicitud #{numero_caso}."
            ),
            "referencia": f"Solicitud #{numero_caso}",
        },
    )

    if proveedor_aprobado_id:
        proveedor_recipient = get_user_recipient(db, int(proveedor_aprobado_id))
        if proveedor_recipient:
            notification_service.notify_user(
                db,
                proveedor_recipient,
                f"Solicitud #{numero_caso} aprobada",
                (
                    f"El cliente aprobo la solicitud #{numero_caso} y ya puedes ejecutar el servicio."
                    + (f"\nComentario del cliente: {comentario_aprobacion}" if comentario_aprobacion else "")
                ),
                "aprobacion_proveedor",
                email_subject=obtener_asunto_correo_solicitud(solicitud),
                email_template="generic_notification",
                email_context={
                    "mensaje": (
                        f"El cliente aprobo la solicitud #{numero_caso} y ya puedes ejecutar el servicio."
                        + (f"\nComentario del cliente: {comentario_aprobacion}" if comentario_aprobacion else "")
                    ),
                    "referencia": f"Solicitud #{numero_caso}",
                },
            )
    elif es_solicitud_mantenimiento_taller(solicitud.tipo):
        notification_service.notify_users(
            db,
            [
                recipient
                for recipient in (
                    get_user_recipient(db, taller_id)
                    for taller_id in parse_proveedores_ids(solicitud.proveedores_ids)
                )
                if recipient is not None
            ],
            f"Solicitud #{numero_caso} aprobada",
            f"El cliente aprobo la solicitud #{numero_caso} y el taller ya puede ejecutar el servicio.",
            "aprobacion_taller",
            email_subject=obtener_asunto_correo_solicitud(solicitud),
            email_template="generic_notification",
            email_context={
                "mensaje": f"El cliente aprobo la solicitud #{numero_caso} y el taller ya puede ejecutar el servicio.",
                "referencia": f"Solicitud #{numero_caso}",
            },
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

    if solicitud.estado != "espera_cliente":
        solicitud_en_espera = (
            db.query(Solicitud)
            .filter(
                Solicitud.usuario_id == user["id"],
                Solicitud.solicitud_origen_id == solicitud.id,
                Solicitud.estado == "espera_cliente",
            )
            .order_by(Solicitud.id.desc())
            .first()
        )
        if solicitud_en_espera:
            solicitud = solicitud_en_espera
        else:
            raise HTTPException(status_code=400, detail="La solicitud no esta esperando la llegada del cliente")

    previous_status = solicitud.estado
    solicitud.estado = "en_reparacion"
    numero_caso = obtener_numero_caso(solicitud)
    sincronizar_solicitud_raiz_con_hija(db, solicitud)

    if solicitud.proveedor_cotizo_id:
        proveedor_recipient = get_user_recipient(db, int(solicitud.proveedor_cotizo_id))
        if proveedor_recipient:
            notification_service.notify_user(
                db,
                proveedor_recipient,
                f"Solicitud #{numero_caso} en reparacion",
                f"El cliente confirmo la llegada al taller para la solicitud #{numero_caso}.",
                "llegada_taller_cliente",
                email_subject=obtener_asunto_correo_solicitud(solicitud),
                email_template="generic_notification",
                email_context={
                    "mensaje": f"El cliente confirmo la llegada al taller para la solicitud #{numero_caso}.",
                    "referencia": f"Solicitud #{numero_caso}",
                },
            )

    notification_service.notify_users(
        db,
        get_role_recipients(db, "administrador"),
        f"Solicitud #{numero_caso} en reparacion",
        f"El cliente confirmo la llegada al taller para la solicitud #{numero_caso}.",
        "llegada_taller_cliente",
        email_subject=obtener_asunto_correo_solicitud(solicitud),
        email_template="generic_notification",
        email_context={
            "mensaje": f"El cliente confirmo la llegada al taller para la solicitud #{numero_caso}.",
            "referencia": f"Solicitud #{numero_caso}",
        },
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
