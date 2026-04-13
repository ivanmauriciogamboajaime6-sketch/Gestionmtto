from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioCreate
from app.auth.security import hash_password
from app.services.notification_service import notification_service

router = APIRouter(prefix="/talleres", tags=["Talleres"])


@router.post("/register")
def register_taller(data: UsuarioCreate, db: Session = Depends(get_db)):
    usuario_existente = db.query(Usuario).filter(Usuario.email == data.email).first()

    if usuario_existente:
        raise HTTPException(status_code=400, detail="El email ya esta registrado")

    usuario = Usuario(
        nombre=data.nombre,
        email=data.email,
        telefono=data.telefono,
        password=hash_password(data.password),
        rol="taller",
        estado="activo"
    )

    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    correo_usuario_enviado = notification_service.notify_user_registered(usuario)
    correo_admin_enviado = notification_service.notify_admin_user_registered(usuario)

    return {
        "mensaje": "taller creado",
        "correo_usuario_enviado": correo_usuario_enviado,
        "correo_admin_enviado": correo_admin_enviado,
    }


@router.get("")
def obtener_talleres(db: Session = Depends(get_db)):
    talleres = db.query(Usuario).filter(Usuario.rol == "taller").all()

    return [
        {
            "id": taller.id,
            "nombre": taller.nombre,
            "email": taller.email,
            "telefono": taller.telefono,
            "estado": taller.estado or "activo",
        }
        for taller in talleres
    ]
