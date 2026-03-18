from sqlalchemy import Column, Integer, String, ForeignKey
from app.database import Base

class Vehiculo(Base):
    __tablename__ = "vehiculos"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))

    marca = Column(String)
    modelo = Column(String)
    anio = Column(Integer)
    placa = Column(String)
    kilometraje = Column(Integer)
    combustible = Column(String)