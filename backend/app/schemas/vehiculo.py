from pydantic import BaseModel

class VehiculoCreate(BaseModel):
    marca: str
    modelo: str
    anio: int
    placa: str
    kilometraje: int
    combustible: str


class VehiculoKilometrajeUpdate(BaseModel):
    kilometraje: int
