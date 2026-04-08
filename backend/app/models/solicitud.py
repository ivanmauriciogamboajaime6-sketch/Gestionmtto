from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from app.database import Base


class Solicitud(Base):
    __tablename__ = "solicitudes"

    id = Column(Integer, primary_key=True, index=True)
    solicitud_origen_id = Column(Integer, ForeignKey("solicitudes.id"), nullable=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"))
    vehiculo_id = Column(Integer, ForeignKey("vehiculos.id"))
    tipo = Column(Text)
    descripcion = Column(Text)
    estado = Column(String(50), default="pendiente")
    proveedores_ids = Column(Text, nullable=True)
    proveedores_estado = Column(Text, nullable=True)
    proveedor_cotizo_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    marca = Column(String(120), nullable=True)
    referencia = Column(String(120), nullable=True)
    garantia = Column(String(120), nullable=True)
    disponibilidad = Column(String(120), nullable=True)
    disponibilidad_cliente = Column(Text, nullable=True)
    precio = Column(String(120), nullable=True)
    observacion = Column(Text, nullable=True)
    comentario_taller = Column(Text, nullable=True)
    fecha_disponible_taller = Column(String(30), nullable=True)
    horario_disponible_taller = Column(String(60), nullable=True)
    diagnostico_taller = Column(Text, nullable=True)
    servicios_taller = Column(Text, nullable=True)
    horas_taller = Column(String(20), nullable=True)
    materiales_taller = Column(Text, nullable=True)
    fecha = Column(DateTime, server_default=func.now())
