from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from os import getenv
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = getenv(
    "DATABASE_URL",
    "postgresql://postgres:1234@localhost:5432/mtto_vehicular"
)

engine = create_engine(
    DATABASE_URL,
    echo=getenv("DATABASE_ECHO", "false").lower() == "true"
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()