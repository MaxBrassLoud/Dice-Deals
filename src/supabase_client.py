"""Supabase Auth Wrapper für Dice Deals.

Nutzt das Service-Role-Key-Auth-Admin-API. E-Mail/Passwort-Konten werden
ausschließlich von Supabase Auth verwaltet; Discord-Konten bleiben
App-seitig (siehe app.py) und bekommen keinen Supabase-Login.
"""

import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

_client = None


class AuthError(Exception):
    """Fehler bei der Kommunikation mit Supabase Auth."""


def is_configured():
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def get_client():
    global _client
    if _client is None:
        from supabase import create_client
        if not is_configured():
            raise AuthError("SUPABASE_URL / SUPABASE_SERVICE_KEY nicht konfiguriert")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def create_auth_user(email, password, username):
    """Erstellt einen Supabase-Auth-User und gibt dessen UID zurück."""
    try:
        resp = get_client().auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"username": username},
        })
        if resp.user is None:
            raise AuthError("Supabase hat keinen User angelegt")
        return resp.user.id
    except Exception as e:
        raise AuthError(str(e)) from e


def verify_password(email, password):
    """Prüft E-Mail/Passwort gegen Supabase Auth. True bei Erfolg."""
    try:
        resp = get_client().auth.sign_in_with_password({"email": email, "password": password})
        return resp.user is not None and bool(resp.session)
    except Exception:
        return False


def update_password(auth_uid, new_password):
    try:
        get_client().auth.admin.update_user_by_id(auth_uid, {"password": new_password})
        return True
    except Exception as e:
        raise AuthError(str(e)) from e


def update_email(auth_uid, new_email):
    try:
        get_client().auth.admin.update_user_by_id(auth_uid, {"email": new_email})
        return True
    except Exception as e:
        raise AuthError(str(e)) from e


def delete_auth_user(auth_uid):
    try:
        get_client().auth.admin.delete_user(auth_uid)
        return True
    except Exception:
        return False
