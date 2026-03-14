from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.vehiculo import Vehiculo
from ..schemas.vehiculo import VehiculoCreate

router = APIRouter()

@router.post("/vehiculos")
def crear_vehiculo(vehiculo: VehiculoCreate, db: Session = Depends(get_db)):

    nuevo = Vehiculo(
        marca=vehiculo.marca,
        modelo=vehiculo.modelo,
        anio=vehiculo.anio,
        kilometraje=vehiculo.kilometraje,
        placa=vehiculo.placa
    )

    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)

    return nuevo