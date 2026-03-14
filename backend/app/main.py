from fastapi import FastAPI
from .database import engine, Base
from .routes import vehiculos
from .routes import auth


app = FastAPI()

# registrar rutas
app.include_router(vehiculos.router)
app.include_router(auth.router)
# crear tablas
Base.metadata.create_all(bind=engine)

@app.get("/")
def root():
    return {"mensaje": "API mantenimiento funcionando"}