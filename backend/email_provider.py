"""Small pluggable email sender for account verification and password reset."""

import json
import os
import smtplib
import urllib.request
from email.message import EmailMessage
from typing import Protocol


class EmailProvider(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class ConsoleEmailProvider:
    def send(self, to: str, subject: str, body: str) -> None:
        print(f"[email:console] to={to} subject={subject}\n{body}")


class SMTPEmailProvider:
    def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = os.environ["EMAIL_FROM"]
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        host = os.environ["SMTP_HOST"]
        port = int(os.getenv("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=20) as server:
            if os.getenv("SMTP_TLS", "true").lower() == "true":
                server.starttls()
            username = os.getenv("SMTP_USERNAME")
            if username:
                server.login(username, os.environ["SMTP_PASSWORD"])
            server.send_message(message)


class ResendEmailProvider:
    def send(self, to: str, subject: str, body: str) -> None:
        payload = json.dumps({"from": os.environ["EMAIL_FROM"], "to": [to], "subject": subject, "text": body}).encode()
        request = urllib.request.Request(
            "https://api.resend.com/emails", data=payload, method="POST",
            headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()


def create_email_provider() -> EmailProvider:
    provider = os.getenv("EMAIL_PROVIDER", "console").lower()
    if provider == "console":
        if os.getenv("ENVIRONMENT") == "production":
            raise RuntimeError("Set EMAIL_PROVIDER to smtp or resend in production")
        return ConsoleEmailProvider()
    if provider == "smtp":
        return SMTPEmailProvider()
    if provider == "resend":
        return ResendEmailProvider()
    raise RuntimeError("EMAIL_PROVIDER must be console, smtp, or resend")
