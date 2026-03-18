from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.jwt_handler import get_current_user
from app.database import get_db
from app.models.solicitud import Solicitud
from app.models.usuario import Usuario
from app.models.vehiculo import Vehiculo
from app.schemas.solicitud import (
    SolicitudCotizacionUpdate,
    SolicitudCreate,
    SolicitudEstadoUpdate,
)

router = APIRouter()

ESTADOS_VALIDOS = {
    "pendiente",
    "cotizando",
    "asignada",
    "diagnostico",
    "esperando_repuestos",
    "en_reparacion",
    "pruebas",
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
    solicitud.estado = "cotizando"
    db.commit()
    db.refresh(solicitud)

    return {
        "mensaje": "solicitud enviada a proveedores",
        "id": solicitud.id,
        "estado": solicitud.estado,
        "proveedor_ids": [proveedor.id for proveedor in proveedores],
    }
