from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.vehiculo import Vehiculo
from app.schemas.vehiculo import VehiculoCreate, VehiculoKilometrajeUpdate
from app.auth.jwt_handler import get_current_user

router = APIRouter()

@router.post("/vehiculos")
def crear_vehiculo(
    data: VehiculoCreate,
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):

    vehiculo = Vehiculo(
        usuario_id=user["id"],
        marca=data.marca,
        modelo=data.modelo,
        anio=data.anio,
        placa=data.placa,
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
