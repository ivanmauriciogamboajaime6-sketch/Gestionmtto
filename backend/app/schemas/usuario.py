from pydantic import BaseModel

class UsuarioCreate(BaseModel):
    nombre: str
    email: str
    password: str
    telefono: str
    rol: str


class UsuarioLogin(BaseModel):
    email: str
    password: str