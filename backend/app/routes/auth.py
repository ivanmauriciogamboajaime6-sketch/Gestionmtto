from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.jwt_handler import create_token
from app.auth.security import hash_password, verify_password
from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioCreate, UsuarioLogin

router = APIRouter()


@router.post("/register/cliente")
def register_cliente(data: UsuarioCreate, db: Session = Depends(get_db)):
    usuario_existente = db.query(Usuario).filter(Usuario.email == data.email).first()

    if usuario_existente:
        return {"error": "el usuario ya existe"}

    nuevo_usuario = Usuario(
        nombre=data.nombre,
        email=data.email,
        telefono=data.telefono,
        password=hash_password(data.password),
        rol="cliente",
        estado="activo",
    )

    db.add(nuevo_usuario)
    db.commit()

    return {"mensaje": "cliente creado correctamente"}


@router.post("/login")
def login(data: UsuarioLogin, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.email == data.email).first()

    if not usuario:
        return {"error": "usuario no encontrado"}

    if not verify_password(data.password, usuario.password):
        return {"error": "contrasena incorrecta"}

    if (usuario.estado or "activo") != "activo":
        return {"error": "usuario bloqueado"}

    token = create_token(
        {
            "id": usuario.id,
            "rol": usuario.rol,
            "nombre": usuario.nombre,
            "estado": usuario.estado or "activo",
        }
    )

    return {
        "token": token,
        "rol": usuario.rol,
        "nombre": usuario.nombre,
        "estado": usuario.estado or "activo",
    }
