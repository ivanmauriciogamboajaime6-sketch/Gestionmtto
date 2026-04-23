from passlib.context import CryptContext
from passlib.exc import PasswordValueError

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str):
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str):
    try:
        return pwd_context.verify(password, hashed)
    except PasswordValueError:
        return False
