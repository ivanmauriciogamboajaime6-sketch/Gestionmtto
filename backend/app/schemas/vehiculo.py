from pydantic import BaseModel

class VehiculoCreate(BaseModel):
    marca: str
    modelo: str
    anio: int
    kilometraje: int
    placa: str