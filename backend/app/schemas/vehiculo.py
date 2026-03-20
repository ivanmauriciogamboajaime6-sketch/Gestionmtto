from pydantic import BaseModel, Field

class VehiculoCreate(BaseModel):
    tipo_vehiculo: str
    marca: str
    modelo: str
    anio: int
    placa: str = Field(..., min_length=1, max_length=10)
    kilometraje: int = Field(..., ge=0, le=2147483647)
    combustible: str


class VehiculoKilometrajeUpdate(BaseModel):
    kilometraje: int = Field(..., ge=0, le=2147483647)
