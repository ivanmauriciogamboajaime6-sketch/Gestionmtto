from sqlalchemy import Column, Integer, String
from ..database import Base

class Vehiculo(Base):
    __tablename__ = "vehiculos"

    id = Column(Integer, primary_key=True, index=True)
    marca = Column(String(50))
    modelo = Column(String(50))
    anio = Column(Integer)
    kilometraje = Column(Integer)
    placa = Column(String(20), unique=True, index=True)