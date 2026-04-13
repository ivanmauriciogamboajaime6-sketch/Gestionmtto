import logging
from dataclasses import dataclass
from os import getenv
from typing import Iterable

from sqlalchemy.orm import Session

from app.models.notificacion import Notificacion
from app.models.solicitud import Solicitud
from app.models.usuario import Usuario
from app.services.email_service import email_service


logger = logging.getLogger(__name__)


@dataclass
class NotificationRecipient:
    user_id: int
    email: str | None
    nombre: str | None


class NotificationService:
    def _get_case_number(self, solicitud: Solicitud) -> int:
        return int(solicitud.solicitud_origen_id or solicitud.id)

    def notify_admin_user_registered(self, user: Usuario) -> bool:
        admin_email = getenv("ADMIN_NOTIFICATION_EMAIL", "").strip()
        admin_name = getenv("ADMIN_NOTIFICATION_NAME", "").strip() or "Administrador"
        if not admin_email:
            logger.warning("ADMIN_NOTIFICATION_EMAIL no esta configurado; no se enviara correo al administrador")
            return False

        return self._dispatch_email(
            recipient=NotificationRecipient(
                user_id=0,
                email=admin_email,
                nombre=admin_name,
            ),
            subject=f"Nuevo usuario registrado: {user.nombre or user.email or 'sin nombre'}",
            body=(
                f"Se registro un nuevo usuario en MTTO Vehicular.\n"
                f"Nombre: {user.nombre or 'Sin nombre'}\n"
                f"Correo: {user.email or 'Sin correo'}\n"
                f"Rol: {user.rol or 'sin rol'}"
            ),
            template_name="generic_notification",
            context={
                "nombre": admin_name,
                "mensaje": (
                    f"Se registro un nuevo usuario en MTTO Vehicular.\n"
                    f"Nombre: {user.nombre or 'Sin nombre'}\n"
                    f"Correo: {user.email or 'Sin correo'}\n"
                    f"Rol: {user.rol or 'sin rol'}"
                ),
                "referencia": f"Registro usuario #{user.id}",
            },
        )

    def create_in_app_notification(
        self,
        db: Session,
        usuario_id: int,
        titulo: str,
        mensaje: str,
        tipo: str,
    ) -> None:
        db.add(
            Notificacion(
                usuario_id=usuario_id,
                titulo=titulo,
                mensaje=mensaje,
                tipo=tipo,
                leida=False,
            )
        )

    def notify_user(
        self,
        db: Session,
        recipient: NotificationRecipient,
        titulo: str,
        mensaje: str,
        tipo: str,
        email_subject: str | None = None,
        email_body: str | None = None,
        email_template: str | None = None,
        email_context: dict | None = None,
    ) -> None:
        self.create_in_app_notification(db, recipient.user_id, titulo, mensaje, tipo)
        self._dispatch_email(
            recipient=recipient,
            subject=email_subject or titulo,
            body=email_body or mensaje,
            template_name=email_template,
            context=email_context,
        )

    def notify_users(
        self,
        db: Session,
        recipients: Iterable[NotificationRecipient],
        titulo: str,
        mensaje: str,
        tipo: str,
        email_subject: str | None = None,
        email_body: str | None = None,
        email_template: str | None = None,
        email_context: dict | None = None,
    ) -> None:
        seen_recipients: set[tuple[int, str]] = set()
        for recipient in recipients:
            dedupe_key = (
                int(recipient.user_id or 0),
                (recipient.email or "").strip().lower(),
            )
            if dedupe_key in seen_recipients:
                continue
            seen_recipients.add(dedupe_key)
            self.notify_user(
                db,
                recipient,
                titulo,
                mensaje,
                tipo,
                email_subject=email_subject,
                email_body=email_body,
                email_template=email_template,
                email_context=email_context,
            )

    def notify_user_registered(self, user: Usuario) -> bool:
        return self._dispatch_email(
            recipient=build_recipient(user),
            subject="Bienvenido a MTTO Vehicular",
            body="Tu cuenta fue creada correctamente en MTTO Vehicular.",
            template_name="welcome_user",
            context={
                "nombre": user.nombre or "usuario",
                "rol": user.rol or "sin rol",
                "email": user.email or "",
            },
        )

    def notify_solicitud_status_changed(
        self,
        db: Session,
        solicitud: Solicitud,
        recipient: NotificationRecipient,
        previous_status: str | None,
        actor_name: str | None = None,
    ) -> None:
        case_number = self._get_case_number(solicitud)
        actor_text = f" por {actor_name}" if actor_name else ""
        previous_text = previous_status or "sin estado"
        titulo = f"Solicitud #{case_number} actualizada"
        mensaje = (
            f"La solicitud #{case_number} cambio de {previous_text} a {solicitud.estado}{actor_text}."
        )
        self.notify_user(
            db,
            recipient,
            titulo,
            mensaje,
            "estado_solicitud",
            email_subject=f"Solicitud #{case_number}",
            email_template="solicitud_status_changed",
            email_context={
                "nombre": recipient.nombre or "usuario",
                "solicitud_id": case_number,
                "estado_anterior": previous_text,
                "estado_actual": solicitud.estado,
                "actor": actor_name or "sistema",
                "tipo_servicio": solicitud.tipo or "No especificado",
            },
        )

    def _dispatch_email(
        self,
        recipient: NotificationRecipient,
        subject: str,
        body: str,
        template_name: str | None = None,
        context: dict | None = None,
    ) -> bool:
        if not recipient.email:
            logger.warning("No se pudo enviar correo porque el destinatario no tiene email. Asunto: '%s'", subject)
            return False

        if template_name:
            safe_context = {
                "nombre": recipient.nombre or "usuario",
                "mensaje": body,
                "referencia": subject,
            }
            if context:
                safe_context.update(context)
            sent = email_service.send_templated_email(
                recipient.email,
                subject,
                template_name,
                safe_context,
            )
            if not sent:
                logger.warning(
                    "No se pudo enviar el correo de notificacion a %s con asunto '%s'",
                    recipient.email,
                    subject,
                )
            return sent

        final_body = body
        if recipient.nombre and not body.startswith("Hola"):
            final_body = f"Hola {recipient.nombre},\n\n{body}"

        sent = email_service.send_email(recipient.email, subject, final_body)
        if not sent:
            logger.warning(
                "No se pudo enviar el correo de notificacion a %s con asunto '%s'",
                recipient.email,
                subject,
            )
        return sent


def build_recipient(user: Usuario) -> NotificationRecipient:
    return NotificationRecipient(
        user_id=user.id,
        email=user.email,
        nombre=user.nombre,
    )


notification_service = NotificationService()
