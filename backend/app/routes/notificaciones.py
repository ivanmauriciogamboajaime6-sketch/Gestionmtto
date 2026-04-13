from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.jwt_handler import get_current_user
from app.database import get_db
from app.models.notificacion import Notificacion

router = APIRouter(prefix="/notificaciones", tags=["Notificaciones"])


@router.get("")
def obtener_notificaciones(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    items = (
        db.query(Notificacion)
        .filter(Notificacion.usuario_id == user["id"])
        .order_by(Notificacion.fecha.desc())
        .all()
    )

    return [
        {
            "id": item.id,
            "titulo": item.titulo,
            "mensaje": item.mensaje,
            "tipo": item.tipo,
            "leida": item.leida,
            "fecha": item.fecha.isoformat() if item.fecha else None,
        }
        for item in items
    ]


@router.patch("/{notificacion_id}/leer")
def marcar_notificacion_como_leida(
    notificacion_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    item = (
        db.query(Notificacion)
        .filter(
            Notificacion.id == notificacion_id,
            Notificacion.usuario_id == user["id"],
        )
        .first()
    )

    if not item:
        raise HTTPException(status_code=404, detail="Notificacion no encontrada")

    item.leida = True
    db.commit()

    return {"mensaje": "notificacion actualizada", "id": item.id, "leida": item.leida}
