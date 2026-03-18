from pydantic import BaseModel


class SolicitudCreate(BaseModel):
    vehiculo_id: int
    tipo: str
    descripcion: str


class SolicitudEstadoUpdate(BaseModel):
    estado: str


class SolicitudCotizacionUpdate(BaseModel):
    proveedor_ids: list[int]
