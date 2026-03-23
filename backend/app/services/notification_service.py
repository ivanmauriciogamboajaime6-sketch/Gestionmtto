from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from app.models.notificacion import Notificacion
from app.models.solicitud import Solicitud
from app.models.usuario import Usuario
from app.services.email_service import email_service


@dataclass
class NotificationRecipient:
    user_id: int
    email: str | None
    nombre: str | None


class NotificationService:
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
        for recipient in recipients:
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

    def notify_user_registered(self, user: Usuario) -> None:
        self._dispatch_email(
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
        actor_text = f" por {actor_name}" if actor_name else ""
        previous_text = previous_status or "sin estado"
        titulo = f"Solicitud #{solicitud.id} actualizada"
        mensaje = (
            f"La solicitud #{solicitud.id} cambio de {previous_text} a {solicitud.estado}{actor_text}."
        )
        self.notify_user(
            db,
            recipient,
            titulo,
            mensaje,
            "estado_solicitud",
            email_subject=titulo,
            email_template="solicitud_status_changed",
            email_context={
                "nombre": recipient.nombre or "usuario",
                "solicitud_id": solicitud.id,
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
    ) -> None:
        if not recipient.email:
            return

        if template_name:
            safe_context = {
                "nombre": recipient.nombre or "usuario",
                "mensaje": body,
                "referencia": subject,
            }
            if context:
                safe_context.update(context)
            email_service.send_templated_email(
                recipient.email,
                subject,
                template_name,
                safe_context,
            )
            return

        final_body = body
        if recipient.nombre and not body.startswith("Hola"):
            final_body = f"Hola {recipient.nombre},\n\n{body}"

        email_service.send_email(recipient.email, subject, final_body)


def build_recipient(user: Usuario) -> NotificationRecipient:
    return NotificationRecipient(
        user_id=user.id,
        email=user.email,
        nombre=user.nombre,
    )


notification_service = NotificationService()
