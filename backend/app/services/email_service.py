import logging
import smtplib
from email.message import EmailMessage
from os import getenv
from pathlib import Path
from ssl import create_default_context
from string import Template


logger = logging.getLogger(__name__)


class EmailService:
    def __init__(self) -> None:
        self.templates_dir = Path(__file__).resolve().parent.parent / "templates" / "email"
        self._load_settings()

    def _load_settings(self) -> None:
        self.enabled = getenv("EMAIL_ENABLED", "false").lower() == "true"
        self.host = getenv("SMTP_HOST", "")
        self.port = int(getenv("SMTP_PORT", "587"))
        self.username = getenv("SMTP_USERNAME", "")
        self.password = getenv("SMTP_PASSWORD", "")
        self.sender = getenv("EMAIL_FROM", self.username or "no-reply@example.com")
        self.sender_name = getenv("EMAIL_FROM_NAME", "MTTO Vehicular")
        self.use_tls = getenv("SMTP_USE_TLS", "true").lower() == "true"
        self.use_ssl = getenv("SMTP_USE_SSL", "false").lower() == "true"

    def is_configured(self) -> bool:
        return self.enabled and bool(self.host) and bool(self.sender)

    def render_template(self, template_name: str, context: dict | None = None) -> tuple[str | None, str | None]:
        safe_context = context or {}
        text_body = self._render_template_file(f"{template_name}.txt", safe_context)
        html_body = self._render_template_file(f"{template_name}.html", safe_context)
        return text_body, html_body

    def send_templated_email(
        self,
        to_email: str,
        subject: str,
        template_name: str,
        context: dict | None = None,
    ) -> bool:
        text_body, html_body = self.render_template(template_name, context)
        return self.send_email(
            to_email=to_email,
            subject=subject,
            body=text_body or "",
            html_body=html_body,
        )

    def send_email(
        self,
        to_email: str,
        subject: str,
        body: str,
        html_body: str | None = None,
    ) -> bool:
        self._load_settings()

        if not to_email:
            return False

        if not self.is_configured():
            logger.info("Email deshabilitado o sin configurar. Destinatario: %s", to_email)
            return False

        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = f"{self.sender_name} <{self.sender}>"
        message["To"] = to_email
        message.set_content(body)
        if html_body:
            message.add_alternative(html_body, subtype="html")

        try:
            if self.use_ssl:
                with smtplib.SMTP_SSL(
                    self.host,
                    self.port,
                    context=create_default_context(),
                ) as server:
                    if self.username and self.password:
                        server.login(self.username, self.password)
                    server.send_message(message)
            else:
                with smtplib.SMTP(self.host, self.port) as server:
                    if self.use_tls:
                        server.starttls(context=create_default_context())
                    if self.username and self.password:
                        server.login(self.username, self.password)
                    server.send_message(message)
            return True
        except Exception:
            logger.exception("No se pudo enviar el correo a %s", to_email)
            return False

    def _render_template_file(self, filename: str, context: dict) -> str | None:
        path = self.templates_dir / filename
        if not path.exists():
            return None

        content = path.read_text(encoding="utf-8")
        return Template(content).safe_substitute(context)


email_service = EmailService()
