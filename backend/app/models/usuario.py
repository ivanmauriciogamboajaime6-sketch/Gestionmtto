from sqlalchemy import Column, Integer, String
from app.database import Base

class Usuario(Base):

    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)
    email = Column(String, unique=True)
    telefono = Column(String)
    password = Column(String)
    rol = Column(String)
    estado = Column(String, default="activo")
    especialidad = Column(String, nullable=True)
