import re

from pydantic import BaseModel, validator


EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PROVIDER_SPECIALTIES = {"llantas", "bateria", "cambio de aceite", "general"}


def validate_email_format(value: str) -> str:
    clean_value = (value or "").strip().lower()
    if not clean_value:
        raise ValueError("el email es obligatorio")
    if not EMAIL_REGEX.match(clean_value):
        raise ValueError("el email no tiene un formato valido")
    return clean_value


def validate_phone_number(value: str) -> str:
    clean_value = (value or "").strip()
    if not clean_value:
        raise ValueError("el celular es obligatorio")
    if not clean_value.isdigit():
        raise ValueError("el celular debe contener solo numeros")
    return clean_value


def validate_provider_specialty(value: str | list[str] | None) -> str | None:
    if value is None:
        return None

    raw_items = value if isinstance(value, list) else str(value).split(",")
    clean_items: list[str] = []

    for item in raw_items:
        clean_value = str(item or "").strip().lower()
        if not clean_value:
            continue
        if clean_value == "aceite":
            clean_value = "cambio de aceite"
        if clean_value not in PROVIDER_SPECIALTIES:
            raise ValueError("la especialidad del proveedor no es valida")
        if clean_value not in clean_items:
            clean_items.append(clean_value)

    return ", ".join(clean_items) if clean_items else None

class UsuarioCreate(BaseModel):
    nombre: str
    email: str
    telefono: str
    password: str
    especialidad: str | list[str] | None = None

    @validator("email")
    def validate_email(cls, value: str) -> str:
        return validate_email_format(value)

    @validator("telefono")
    def validate_telefono(cls, value: str) -> str:
        return validate_phone_number(value)

    @validator("especialidad", pre=True)
    def validate_especialidad(cls, value: str | list[str] | None) -> str | None:
        return validate_provider_specialty(value)


class UsuarioLogin(BaseModel):
    email: str
    password: str

    @validator("email")
    def validate_email(cls, value: str) -> str:
        return validate_email_format(value)


class UsuarioEstadoUpdate(BaseModel):
    estado: str
