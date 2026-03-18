from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from app.database import Base


class Solicitud(Base):
    __tablename__ = "solicitudes"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    vehiculo_id = Column(Integer, ForeignKey("vehiculos.id"))
    tipo = Column(String(50))
    descripcion = Column(Text)
    estado = Column(String(50), default="pendiente")
    proveedores_ids = Column(Text, nullable=True)
    fecha = Column(DateTime, server_default=func.now())
