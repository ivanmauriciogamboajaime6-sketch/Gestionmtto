from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from app.database import engine, Base

from app.routes import auth
from app.routes import usuarios
from app.routes import vehiculos
from app.routes import talleres
from app.routes import proveedores
from app.routes import solicitudes
from app.routes import notificaciones

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # en producción se cambia
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.get("/")
def root():
    return {"mensaje": "API mantenimiento funcionando"}
