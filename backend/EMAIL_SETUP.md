# Configuracion de correos

## 1. Crear el archivo `.env`

En `C:\Users\keily\APP_MTTO_VEH\backend` copia `.env.example` a `.env`.

Debes completar estas variables:

```env
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=tu_correo@gmail.com
SMTP_PASSWORD=tu_password_o_app_password
EMAIL_FROM=tu_correo@gmail.com
EMAIL_FROM_NAME=MTTO Vehicular
SMTP_USE_TLS=true
SMTP_USE_SSL=false
```

## 2. Configuracion recomendada con Gmail

No uses tu contrasena normal.

Debes:

1. Activar verificacion en dos pasos en tu cuenta de Google.
2. Ir a Google Account > Security > App passwords.
3. Crear una app password para correo.
4. Pegar esa clave en `SMTP_PASSWORD`.

Con Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USE_SSL=false
```

## 3. Si usas Outlook

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USE_TLS=true
SMTP_USE_SSL=false
```

## 4. Si usas SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=apikey
SMTP_PASSWORD=tu_api_key
EMAIL_FROM=tu_correo_verificado@tudominio.com
SMTP_USE_TLS=true
SMTP_USE_SSL=false
```

## 5. Donde estan las plantillas

Las plantillas quedaron en:

- `backend/app/templates/email/welcome_user.txt`
- `backend/app/templates/email/welcome_user.html`
- `backend/app/templates/email/solicitud_status_changed.txt`
- `backend/app/templates/email/solicitud_status_changed.html`
- `backend/app/templates/email/generic_notification.txt`
- `backend/app/templates/email/generic_notification.html`

Puedes editar esos archivos sin tocar la logica del backend.
