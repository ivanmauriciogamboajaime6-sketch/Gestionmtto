from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.usuario import Usuario
from ..schemas.usuario import UsuarioCreate, UsuarioLogin

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
def register(user: UsuarioCreate, db: Session = Depends(get_db)):

    usuario = Usuario(
        nombre=user.nombre,
        email=user.email,
        password=user.password,
        telefono=user.telefono,
        rol=user.rol
    )

    db.add(usuario)
    db.commit()
    db.refresh(usuario)

    return usuario


@router.post("/login")
def login(user: UsuarioLogin, db: Session = Depends(get_db)):

    usuario = db.query(Usuario).filter(
        Usuario.email == user.email
    ).first()

    if not usuario or usuario.password != user.password:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")

    return usuario