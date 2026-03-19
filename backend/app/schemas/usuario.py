from pydantic import BaseModel

class UsuarioCreate(BaseModel):
    nombre: str
    email: str
    telefono: str
    password: str
    especialidad: str | None = None


class UsuarioLogin(BaseModel):
    email: str
    password: str


class UsuarioEstadoUpdate(BaseModel):
    estado: str
