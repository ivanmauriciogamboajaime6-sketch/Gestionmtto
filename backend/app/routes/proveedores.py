from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.usuario import UsuarioCreate
from app.auth.security import hash_password

router = APIRouter(prefix="/proveedores")

@router.post("/register")
def register_proveedor(data: UsuarioCreate, db: Session = Depends(get_db)):

    # verificar si ya existe
    usuario_existente = db.query(Usuario).filter(
        Usuario.email == data.email
    ).first()

    if usuario_existente:
        return {"error": "el email ya está registrado"}

    usuario = Usuario(
        nombre=data.nombre,
        email=data.email,
        telefono=data.telefono,
        password=hash_password(data.password),
        rol="proveedor",
        estado="activo",
        especialidad=(data.especialidad or "").strip().lower() or None,
    )

    db.add(usuario)
    db.commit()

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
