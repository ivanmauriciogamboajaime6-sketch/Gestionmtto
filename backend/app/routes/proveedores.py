from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioCreate
from app.services.notification_service import notification_service

router = APIRouter(prefix="/proveedores")


@router.post("/register")
def register_proveedor(data: UsuarioCreate, db: Session = Depends(get_db)):
    usuario_existente = db.query(Usuario).filter(Usuario.email == data.email).first()

    if usuario_existente:
        raise HTTPException(status_code=400, detail="el email ya esta registrado")
    if not data.especialidad:
        raise HTTPException(status_code=400, detail="debes seleccionar al menos una especialidad")

    usuario = Usuario(
        nombre=data.nombre,
        email=data.email,
        telefono=data.telefono,
        password=hash_password(data.password),
        rol="proveedor",
        estado="activo",
        especialidad=data.especialidad,
    )

    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    notification_service.notify_user_registered(usuario)

    return {"mensaje": "proveedor creado"}


@router.get("")
def obtener_proveedores(db: Session = Depends(get_db)):
    proveedores = db.query(Usuario).filter(Usuario.rol == "proveedor").all()

    return [
        {
            "id": proveedor.id,
            "nombre": proveedor.nombre,
            "email": proveedor.email,
            "telefono": proveedor.telefono,
            "estado": proveedor.estado or "activo",
            "especialidad": proveedor.especialidad,
        }
        for proveedor in proveedores
    ]
