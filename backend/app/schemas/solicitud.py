from pydantic import BaseModel, Field


class SolicitudCreate(BaseModel):
    vehiculo_id: int
    tipo: str
    descripcion: str = Field(..., max_length=200)
    disponibilidad_cliente: str = Field(..., max_length=200)


class SolicitudEstadoUpdate(BaseModel):
    estado: str
    comentario: str | None = Field(default=None, max_length=300)


class SolicitudCotizacionUpdate(BaseModel):
    proveedor_ids: list[int]


class SolicitudTallerUpdate(BaseModel):
    taller_ids: list[int]


class SolicitudDiagnosticoTallerUpdate(BaseModel):
    diagnostico: str = Field(..., max_length=800)
    servicios: str = Field(..., max_length=800)
    horas: str = Field(..., max_length=20)
    materiales: str = Field(..., max_length=800)


class SolicitudRespuestaTallerUpdate(BaseModel):
    comentario: str = Field(..., max_length=300)
    fecha_disponible: str = Field(..., max_length=30)
    horario_disponible: str = Field(..., max_length=60)


class SolicitudRespuestaProveedorUpdate(BaseModel):
    marca: str
    referencia: str
    garantia: str
    disponibilidad: str
    precio: str
    observacion: str


class SolicitudProveedorDevolucion(BaseModel):
    comentario: str = Field(..., max_length=200)


class SolicitudAdministradorDevolucion(BaseModel):
    comentario: str = Field(..., max_length=200)


class SolicitudAdministradorOmitirCotizacion(BaseModel):
    proveedor_id: int | None = None
    response_index: int | None = None


class SolicitudClienteAprobacion(BaseModel):
    comentario: str | None = Field(default=None, max_length=300)
