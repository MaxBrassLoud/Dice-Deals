"""Supabase Auth Wrapper für Dice Deals.

Nutzt das Service-Role-Key-Auth-Admin-API. E-Mail/Passwort-Konten werden
ausschließlich von Supabase Auth verwaltet. Discord-Konten können nun
ebenfalls über Supabase Auth (OAuth) angemeldet werden; es bleibt aber
auch der direkte App-side Discord-Flow erhalten.
"""

import base64
import hashlib
import os
import secrets
import urllib.parse
from typing import Optional, Tuple

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


def discord_oauth_redirect(provider: str = "discord", redirect_uri: str = None) -> Tuple[str, str]:
    """Erzeugt die Supabase-OAuth-Authorize-URL mit PKCE (S256).

    Gibt (authorize_url, code_verifier) zurueck. Der Verifier muss bis zum
    Callback (z.B. in der Flask-Session) aufbewahrt und beim Code-Tausch
    wieder uebergeben werden.
    """
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


def discord_oauth_callback(code: str, redirect_uri: str = None, code_verifier: str = None) -> Tuple[Optional[str], ...]:
    """Tauscht den OAuth-Code gegen eine Supabase-Session und gibt
    (auth_uid, email, username, discord_id, discord_avatar) zurueck.
    discord_avatar ist eine vollqualifizierte URL (CDN-Link bei Hash-only).
    None bei Fehler.
    """
    try:
        rc = redirect_uri or os.getenv("SUPABASE_REDIRECT_URI", "")
        params = {"auth_code": code, "redirect_to": rc}
        if code_verifier:
            params["code_verifier"] = code_verifier
        resp = get_client().auth.exchange_code_for_session(params)
        user = resp.user
        if not user:
            return None, None, None, None, None
        meta = user.user_metadata or {}
        email = user.email
        username = (meta.get("username") or meta.get("preferred_username")
                    or meta.get("global_name") or meta.get("name"))
        if not username and email:
            username = email.split("@", 1)[0]
        discord_id = meta.get("id") or meta.get("sub")
        avatar = meta.get("avatar") or meta.get("avatar_url") or meta.get("picture")
        if avatar and not avatar.startswith("http") and discord_id:
            avatar = f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar}.png"
        return user.id, email, username, discord_id, avatar
    except Exception as e:
        raise AuthError(str(e)) from e