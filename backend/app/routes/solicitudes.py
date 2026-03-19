import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.jwt_handler import get_current_user
from app.database import get_db
from app.models.notificacion import Notificacion
from app.models.solicitud import Solicitud
from app.models.usuario import Usuario
from app.models.vehiculo import Vehiculo
from app.schemas.solicitud import (
    SolicitudAdministradorOmitirCotizacion,
    SolicitudAdministradorDevolucion,
    SolicitudCotizacionUpdate,
    SolicitudCreate,
    SolicitudProveedorDevolucion,
    SolicitudEstadoUpdate,
    SolicitudRespuestaProveedorUpdate,
)

router = APIRouter()

ESTADOS_VALIDOS = {
    "pendiente",
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
    "rechazada",
}


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
    db.add(
        Notificacion(
            usuario_id=usuario_id,
            titulo=titulo,
            mensaje=mensaje,
            tipo=tipo,
            leida=False,
        )
    )


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


def resolve_estado_desde_proveedores(proveedores_estado: list[dict]) -> str:
    if any(item.get("estado") == "pendiente" for item in proveedores_estado):
        return "cotizando"
    if any(item.get("estado") == "cotizado" for item in proveedores_estado):
        return "cotizado"
    if any(item.get("estado") == "devuelto" for item in proveedores_estado):
        return "devuelto_proveedor"
    return "pendiente"


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
        respuestas.append(
            {
                "proveedor_id": proveedor.get("id"),
                "proveedor_nombre": proveedor.get("nombre"),
                "marca": proveedor.get("marca") or (marcas[index] if index < len(marcas) else None),
                "referencia": proveedor.get("referencia") or (referencias[index] if index < len(referencias) else None),
                "garantia": proveedor.get("garantia") or (garantias[index] if index < len(garantias) else None),
                "disponibilidad": proveedor.get("disponibilidad") or (
                    disponibilidades[index] if index < len(disponibilidades) else None
                ),
                "precio": proveedor.get("precio") or (precios[index] if index < len(precios) else None),
                "observacion": proveedor.get("observacion") or (
                    observaciones[index] if index < len(observaciones) else None
                ),
            }
        )

    return respuestas


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
        estado="pendiente",
    )

    db.add(solicitud)
    db.commit()
    db.refresh(solicitud)

    administradores = db.query(Usuario).filter(Usuario.rol == "administrador").all()
    for administrador in administradores:
        crear_notificacion(
            db,
            administrador.id,
            "Nueva solicitud",
            f"El cliente {user['nombre']} creo la solicitud #{solicitud.id}.",
            "solicitud_cliente",
        )
    db.commit()

    return {"mensaje": "solicitud creada", "id": solicitud.id, "estado": solicitud.estado}


@router.get("/solicitudes")
def obtener_solicitudes(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    solicitudes = db.query(Solicitud).all()
    resultado = []

    for solicitud in solicitudes:
      vehiculo = db.query(Vehiculo).filter(Vehiculo.id == solicitud.vehiculo_id).first()
      cliente = db.query(Usuario).filter(Usuario.id == solicitud.usuario_id).first()
      proveedores_ids = parse_proveedores_ids(solicitud.proveedores_ids)
      proveedores = (
          db.query(Usuario).filter(Usuario.id.in_(proveedores_ids)).all()
          if proveedores_ids
          else []
      )
      marcas = parse_multi_value(solicitud.marca)
      referencias = parse_multi_value(solicitud.referencia)
      garantias = parse_multi_value(solicitud.garantia)
      disponibilidades = parse_multi_value(solicitud.disponibilidad)
      precios = parse_multi_value(solicitud.precio)
      observaciones = parse_multi_value(solicitud.observacion)
      proveedores_estado = parse_proveedores_estado(solicitud.proveedores_estado)
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
      if user["rol"] == "proveedor" and user["id"] not in proveedores_ids:
          continue

      resultado.append(
          {
              "id": solicitud.id,
              "tipo_servicio": solicitud.tipo,
              "problema": solicitud.descripcion,
              "estado": solicitud.estado,
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
    if user["rol"] != "taller":
        raise HTTPException(status_code=403, detail="Solo el taller puede actualizar solicitudes")

    if data.estado not in ESTADOS_VALIDOS:
        raise HTTPException(status_code=400, detail="Estado no valido")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    solicitud.estado = data.estado
    db.commit()
    db.refresh(solicitud)

    return {"mensaje": "estado actualizado", "id": solicitud.id, "estado": solicitud.estado}


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
        .filter(Usuario.id.in_(data.proveedor_ids), Usuario.rol == "proveedor")
        .all()
    )

    if not proveedores:
        raise HTTPException(status_code=400, detail="Debes seleccionar al menos un proveedor valido")

    solicitud.proveedores_ids = ",".join(str(proveedor.id) for proveedor in proveedores)
    solicitud.proveedores_estado = dump_proveedores_estado(
        [
            {
                "id": proveedor.id,
                "nombre": proveedor.nombre,
                "email": proveedor.email,
                "estado": "pendiente",
            }
            for proveedor in proveedores
        ]
    )
    solicitud.estado = "cotizando"
    for proveedor in proveedores:
        crear_notificacion(
            db,
            proveedor.id,
            "Nueva cotizacion",
            f"El administrador te envio la solicitud #{solicitud.id} para cotizar.",
            "solicitud_proveedor",
        )
    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud enviada a proveedores",
        "id": solicitud.id,
        "estado": solicitud.estado,
        "proveedor_ids": [proveedor.id for proveedor in proveedores],
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

    solicitud.estado = "archivada"
    crear_notificacion(
        db,
        solicitud.usuario_id,
        "Solicitud descartada",
        "Tu solicitud fue descartada. Si quieres, puedes volver a solicitar.",
        "solicitud_descartada",
    )
    db.commit()
    db.refresh(solicitud)

    return {"mensaje": "solicitud archivada", "id": solicitud.id, "estado": solicitud.estado}


@router.patch("/solicitudes/{solicitud_id}/enviar-cliente")
def enviar_solicitud_cliente(
    solicitud_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] != "administrador":
        raise HTTPException(status_code=403, detail="Solo el administrador puede enviar solicitudes al cliente")

    solicitud = db.query(Solicitud).filter(Solicitud.id == solicitud_id).first()

    if not solicitud:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")

    solicitud.estado = "enviado_cliente"
    crear_notificacion(
        db,
        solicitud.usuario_id,
        "Cotizacion disponible",
        f"Tu solicitud #{solicitud.id} ya tiene cotizacion disponible para revisar.",
        "cotizacion_cliente",
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

        historial_admin = Solicitud(
            usuario_id=solicitud.usuario_id,
            vehiculo_id=solicitud.vehiculo_id,
            tipo=solicitud.tipo,
            descripcion=solicitud.descripcion,
            estado="omitida_admin",
            proveedores_estado=dump_proveedores_estado([proveedor_omitido]),
            proveedor_cotizo_id=proveedor_omitido.get("id"),
            marca=normalizar_texto_guardado(proveedor_omitido.get("marca")),
            referencia=normalizar_texto_guardado(proveedor_omitido.get("referencia")),
            garantia=normalizar_texto_guardado(proveedor_omitido.get("garantia")),
            disponibilidad=normalizar_texto_guardado(proveedor_omitido.get("disponibilidad")),
            precio=normalizar_texto_guardado(proveedor_omitido.get("precio")),
            observacion=normalizar_texto_guardado(proveedor_omitido.get("observacion")),
        )
        db.add(historial_admin)

        proveedores_estado = [
            proveedor
            for proveedor in proveedores_estado
            if str(proveedor.get("id")) != str(data.proveedor_id)
        ]
        solicitud.proveedores_estado = (
            dump_proveedores_estado(proveedores_estado) if proveedores_estado else None
        )
        rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)
        solicitud.estado = resolve_estado_desde_proveedores(proveedores_estado)
    else:
        historial_admin = Solicitud(
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
            precio=solicitud.precio,
            observacion=solicitud.observacion,
        )
        db.add(historial_admin)

        solicitud.estado = "pendiente"
        solicitud.proveedores_ids = None
        solicitud.proveedores_estado = None
        solicitud.proveedor_cotizo_id = None
        solicitud.marca = None
        solicitud.referencia = None
        solicitud.garantia = None
        solicitud.disponibilidad = None
        solicitud.precio = None
        solicitud.observacion = None

    administradores = db.query(Usuario).filter(Usuario.rol == "administrador").all()
    for administrador in administradores:
        crear_notificacion(
            db,
            administrador.id,
            "Solicitud omitida",
            f"La solicitud #{solicitud.id} guardo una cotizacion en historial administrativo.",
            "solicitud_omitida_admin",
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
    solicitud.proveedores_estado = dump_proveedores_estado(proveedores_estado)
    rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)
    solicitud.estado = "cotizando" if proveedores_restantes else resolve_estado_desde_proveedores(proveedores_estado)
    administradores = db.query(Usuario).filter(Usuario.rol == "administrador").all()
    for administrador in administradores:
        crear_notificacion(
            db,
            administrador.id,
            "Cotizacion recibida",
            f"El proveedor {user['nombre']} respondio la solicitud #{solicitud.id}.",
            "respuesta_proveedor",
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

    proveedores_restantes = [proveedor_id for proveedor_id in proveedores_ids if proveedor_id != user["id"]]
    solicitud.proveedores_ids = ",".join(str(proveedor_id) for proveedor_id in proveedores_restantes) or None
    for proveedor in proveedores_estado:
        if str(proveedor.get("id")) == str(user["id"]):
            proveedor["estado"] = "devuelto"
            proveedor["comentario"] = data.comentario.strip()
    solicitud.proveedores_estado = dump_proveedores_estado(proveedores_estado)
    rebuild_cotizacion_desde_estados(solicitud, proveedores_estado)

    if proveedores_restantes:
        solicitud.estado = "cotizando"
    else:
        solicitud.estado = resolve_estado_desde_proveedores(proveedores_estado)
        if solicitud.estado == "devuelto_proveedor":
            solicitud.observacion = data.comentario.strip()

    administradores = db.query(Usuario).filter(Usuario.rol == "administrador").all()
    for administrador in administradores:
        crear_notificacion(
            db,
            administrador.id,
            "Solicitud devuelta por proveedor",
            f"Se ha devuelto tu solicitud #{solicitud.id} con el comentario: {data.comentario.strip()}",
            "devolucion_proveedor",
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

    solicitud.estado = "devuelta"
    solicitud.observacion = data.comentario.strip()

    crear_notificacion(
        db,
        solicitud.usuario_id,
        "Solicitud devuelta al cliente",
        f"Tu solicitud #{solicitud.id} fue devuelta con el comentario: {data.comentario.strip()}",
        "devolucion_cliente",
    )

    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud devuelta al cliente",
        "id": solicitud.id,
        "estado": solicitud.estado,
    }
