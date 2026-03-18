from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioEstadoUpdate

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])


@router.get("")
def obtener_usuarios(db: Session = Depends(get_db)):
    usuarios = db.query(Usuario).all()

    return [
        {
            "id": usuario.id,
            "nombre": usuario.nombre,
            "email": usuario.email,
            "telefono": usuario.telefono,
            "rol": usuario.rol,
            "estado": usuario.estado or "activo",
        }
        for usuario in usuarios
    ]


@router.patch("/{usuario_id}/estado")
def actualizar_estado_usuario(
    usuario_id: int,
    data: UsuarioEstadoUpdate,
    db: Session = Depends(get_db),
):
    if data.estado not in {"activo", "bloqueado"}:
        raise HTTPException(status_code=400, detail="estado no valido")

    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()

    if not usuario:
        raise HTTPException(status_code=404, detail="usuario no encontrado")

    usuario.estado = data.estado
    db.commit()
    db.refresh(usuario)

    return {
        "id": usuario.id,
        "nombre": usuario.nombre,
        "estado": usuario.estado,
    }
