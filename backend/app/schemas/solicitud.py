from pydantic import BaseModel, Field


class SolicitudCreate(BaseModel):
    vehiculo_id: int
    tipo: str
    descripcion: str = Field(..., max_length=200)


class SolicitudEstadoUpdate(BaseModel):
    estado: str


class SolicitudCotizacionUpdate(BaseModel):
    proveedor_ids: list[int]


class SolicitudRespuestaProveedorUpdate(BaseModel):
    marca: str
    referencia: str
    garantia: str
    disponibilidad: str
    precio: str
    observacion: str


class SolicitudProveedorDevolucion(BaseModel):
    comentario: str = Field(..., max_length=100)


class SolicitudAdministradorDevolucion(BaseModel):
    comentario: str = Field(..., max_length=100)


class SolicitudAdministradorOmitirCotizacion(BaseModel):
    proveedor_id: int | None = None
