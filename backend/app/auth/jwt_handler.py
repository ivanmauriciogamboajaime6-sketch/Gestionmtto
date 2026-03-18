from jose import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

SECRET_KEY = "secret123"
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

    except:

        raise HTTPException(
            status_code=401,
            detail="Token inválido"
        )