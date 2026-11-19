"""Supabase Auth Wrapper für Dice Deals.

Nutzt das Service-Role-Key-Auth-Admin-API. E-Mail/Passwort-Konten werden
ausschließlich von Supabase Auth verwaltet. Discord-Konten können nun
ebenfalls über Supabase Auth (OAuth) angemeldet werden; es bleibt aber
auch der direkte App-side Discord-Flow erhalten.
"""

import base64
import hashlib
import os
import re
import secrets
import urllib.parse
from typing import Optional, Tuple

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

_client = None
_signup_client = None


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


def register_auth_user(email, password, username):
    """Registriert einen Nutzer über den öffentlichen Sign-up-Flow.

    Bei aktivierter E-Mail-Bestätigung versendet Supabase dabei die
    Bestätigungs-E-Mail; die Admin-API würde das nicht tun.
    """
    try:
        response = get_signup_client().auth.sign_up({
            "email": email,
            "password": password,
            "options": {"data": {"username": username}},
        })
        if not response.user:
            raise AuthError("Supabase hat keinen User angelegt")
        return response.user.id
    except AuthError:
        raise
    except Exception as e:
        raise AuthError(str(e)) from e


def get_signup_client():
    global _signup_client
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise AuthError("SUPABASE_ANON_KEY ist für die E-Mail-Bestätigung nicht gesetzt")
    if _signup_client is None:
        from supabase import create_client
        _signup_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _signup_client


def verify_password(email, password):
    """Prüft E-Mail/Passwort gegen Supabase Auth. True bei Erfolg."""
    try:
        resp = get_client().auth.sign_in_with_password({"email": email, "password": password})
        return resp.user is not None and bool(resp.session)
    except Exception:
        return False


def is_email_confirmed(auth_uid):
    try:
        response = get_client().auth.admin.get_user_by_id(auth_uid)
        user = response.user
        return bool(user and getattr(user, "email_confirmed_at", None))
    except Exception as e:
        raise AuthError(str(e)) from e


def verify_email_code(email, code):
    try:
        response = get_signup_client().auth.verify_otp({"email": email, "token": code, "type": "email"})
        if not response.user:
            raise AuthError("Code konnte nicht bestätigt werden")
        return response.user
    except Exception as e:
        raise AuthError(str(e)) from e


def resend_email_confirmation(email):
    try:
        get_signup_client().auth.resend({"type": "signup", "email": email})
    except Exception as e:
        raise AuthError(str(e)) from e


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


OAUTH_PROVIDERS = ("discord",)


def _discord_public_name(value):
    """Entfernt nur den alten Discord-Discriminator (z. B. ``#0``)."""
    if not isinstance(value, str):
        return value
    return re.sub(r"#\d{1,4}$", "", value).strip()


def oauth_redirect(provider: str = "discord", redirect_uri: str = None) -> Tuple[str, str]:
    """Erzeugt die Supabase-OAuth-Authorize-URL mit PKCE (S256).

    Gibt (authorize_url, code_verifier) zurueck. Der Verifier muss bis zum
    Callback (z.B. in der Flask-Session) aufbewahrt und beim Code-Tausch
    wieder uebergeben werden.
    """
    if provider not in OAUTH_PROVIDERS:
        raise AuthError(f"Unbekannter OAuth-Provider: {provider}")
    rc = redirect_uri or os.getenv("SUPABASE_REDIRECT_URI", "")
    if not rc:
        raise AuthError("Redirect-URI nicht konfiguriert (redirect_uri/SUPABASE_REDIRECT_URI)")
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    qs = urllib.parse.urlencode({
        "provider": provider,
        "redirect_to": rc,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return f"{SUPABASE_URL.rstrip('/')}/auth/v1/authorize?{qs}", verifier


def _extract_identity(provider: str, meta: dict, email: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Liest (username, ext_id, avatar) aus den Provider-Metadaten."""
    username = ext_id = avatar = None
    if provider == "discord":
        username = (meta.get("username") or meta.get("preferred_username")
                    or meta.get("global_name") or meta.get("name"))
        username = _discord_public_name(username)
        ext_id = meta.get("id") or meta.get("sub")
        avatar = meta.get("avatar") or meta.get("avatar_url") or meta.get("picture")
        if avatar and not avatar.startswith("http") and ext_id:
            avatar = f"https://cdn.discordapp.com/avatars/{ext_id}/{avatar}.png"
    else:
        username = meta.get("preferred_username") or meta.get("name")
        ext_id = meta.get("sub") or meta.get("id")
        avatar = meta.get("avatar_url") or meta.get("picture") or meta.get("avatar")
    if not username and email:
        username = email.split("@", 1)[0]
    if ext_id is not None and not isinstance(ext_id, str):
        ext_id = str(ext_id)
    return username, ext_id, avatar


def oauth_callback(provider: str = "discord", code: str = None, redirect_uri: str = None,
                   code_verifier: str = None) -> Tuple[Optional[str], ...]:
    """Tauscht den OAuth-Code gegen eine Supabase-Session und gibt
    (auth_uid, email, username, ext_id, avatar) zurueck.
    avatar ist eine vollqualifizierte URL (CDN-Link bei Hash-only).
    None bei Fehler.
    """
    if provider not in OAUTH_PROVIDERS:
        raise AuthError(f"Unbekannter OAuth-Provider: {provider}")
    try:
        rc = redirect_uri or os.getenv("SUPABASE_REDIRECT_URI", "")
        params = {"auth_code": code, "redirect_to": rc}
        if code_verifier:
            params["code_verifier"] = code_verifier
        resp = get_client().auth.exchange_code_for_session(params)
        user = resp.user
        if not user:
            return None, None, None, None, None
        email = user.email
        username, ext_id, avatar = _extract_identity(provider, user.user_metadata or {}, email)
        return user.id, email, username, ext_id, avatar
    except Exception as e:
        raise AuthError(str(e)) from e


def discord_oauth_redirect(provider: str = "discord", redirect_uri: str = None) -> Tuple[str, str]:
    """Kompatibilitaets-Wrapper fuer den Discord-Flow."""
    return oauth_redirect("discord", redirect_uri)


def discord_oauth_callback(code: str, redirect_uri: str = None, code_verifier: str = None) -> Tuple[Optional[str], ...]:
    """Kompatibilitaets-Wrapper fuer den Discord-Flow."""
    return oauth_callback("discord", code, redirect_uri, code_verifier)
