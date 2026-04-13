from os import getenv

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

load_dotenv()

from app.database import engine, Base
from app.routes import auth
from app.routes import usuarios
from app.routes import vehiculos
from app.routes import talleres
from app.routes import proveedores
from app.routes import solicitudes
from app.routes import notificaciones

app = FastAPI()

# Configuración CORS - usar variables de entorno en producción
allowed_origins = [
    origin.strip()
    for origin in getenv(
        "CORS_ORIGINS",
        "http://localhost:8081,http://localhost:8080,http://127.0.0.1:8080,http://10.0.2.2:8080",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
# registrar rutas
app.include_router(auth.router)
app.include_router(usuarios.router)
app.include_router(vehiculos.router)
app.include_router(talleres.router)
app.include_router(proveedores.router)
app.include_router(solicitudes.router)
app.include_router(notificaciones.router)


# crear tablas
Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS solicitud_origen_id INTEGER"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS diagnostico_taller TEXT"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS servicios_taller TEXT"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS horas_taller VARCHAR(20)"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS materiales_taller TEXT"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS comentario_proveedor TEXT"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS disponibilidad_cliente TEXT"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS comentario_taller TEXT"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS fecha_disponible_taller VARCHAR(30)"))
    connection.execute(text("ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS horario_disponible_taller VARCHAR(60)"))


@app.get("/")
def root():
    return {"mensaje": "API mantenimiento funcionando"}
