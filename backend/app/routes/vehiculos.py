from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.solicitud import Solicitud
from app.models.vehiculo import Vehiculo
from app.schemas.vehiculo import VehiculoCreate, VehiculoKilometrajeUpdate
from app.auth.jwt_handler import get_current_user

router = APIRouter()

ESTADOS_SOLICITUD_CERRADOS = {
    "archivada",
    "cancelada",
    "devuelta",
    "rechazada",
    "rechazada_admin",
    "rechazada_proveedor",
    "rechazada_cliente",
    "devuelto_proveedor",
    "finalizado",
    "finalizada",
    "omitida_admin",
}

@router.post("/vehiculos")
def crear_vehiculo(
    data: VehiculoCreate,
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    tipo_vehiculo = data.tipo_vehiculo.strip().lower()
    placa_normalizada = data.placa.strip().upper()

    if tipo_vehiculo not in {"carro", "moto"}:
        raise HTTPException(status_code=400, detail="El tipo de vehiculo no es valido")

    if data.kilometraje > 2147483647:
        raise HTTPException(status_code=400, detail="El kilometraje supera el limite permitido")

    placa_existente = db.query(Vehiculo).filter(
        func.upper(Vehiculo.placa) == placa_normalizada
    ).first()

    if placa_existente:
        raise HTTPException(status_code=400, detail="La placa ya esta registrada")

    vehiculo = Vehiculo(
        usuario_id=user["id"],
        tipo_vehiculo=tipo_vehiculo,
        marca=data.marca,
        modelo=data.modelo,
        anio=data.anio,
        placa=placa_normalizada,
        kilometraje=data.kilometraje,
        combustible=data.combustible
    )

    db.add(vehiculo)
    db.commit()

    return {"mensaje": "vehiculo creado"}


@router.get("/vehiculos")
def obtener_vehiculos(
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):

    vehiculos = db.query(Vehiculo).filter(
        Vehiculo.usuario_id == user["id"]
    ).all()

    return vehiculos


@router.delete("/vehiculos/{vehiculo_id}")
def eliminar_vehiculo(
    vehiculo_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.usuario_id == user["id"]
    ).first()

    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehiculo no encontrado")

    solicitud_activa = (
        db.query(Solicitud)
        .filter(
            Solicitud.vehiculo_id == vehiculo_id,
            Solicitud.usuario_id == user["id"],
            ~Solicitud.estado.in_(ESTADOS_SOLICITUD_CERRADOS),
        )
        .first()
    )

    if solicitud_activa:
        raise HTTPException(
            status_code=400,
            detail="No puedes eliminar el vehiculo porque tiene una solicitud activa",
        )

    db.delete(vehiculo)
    db.commit()

    return {"mensaje": "vehiculo eliminado"}


@router.patch("/vehiculos/{vehiculo_id}/kilometraje")
def actualizar_kilometraje(
    vehiculo_id: int,
    data: VehiculoKilometrajeUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    if data.kilometraje > 2147483647:
        raise HTTPException(status_code=400, detail="El kilometraje supera el limite permitido")

    vehiculo = db.query(Vehiculo).filter(
        Vehiculo.id == vehiculo_id,
        Vehiculo.usuario_id == user["id"]
    ).first()

    if not vehiculo:
        raise HTTPException(status_code=404, detail="Vehiculo no encontrado")

    vehiculo.kilometraje = data.kilometraje
    db.commit()
    db.refresh(vehiculo)

    return {"mensaje": "kilometraje actualizado", "kilometraje": vehiculo.kilometraje}
