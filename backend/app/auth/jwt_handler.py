from jose import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from os import getenv

SECRET_KEY = getenv("JWT_SECRET_KEY", "change_me_in_production")
ALGORITHM = "HS256"

security = HTTPBearer()

def create_token(data: dict):

    token = jwt.encode(
        data,
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return token


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):

    token = credentials.credentials

    try:

        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token expirado"
        )
    except jwt.JWTError:
        raise HTTPException(
            status_code=401,
            detail="Token inválido"
        )