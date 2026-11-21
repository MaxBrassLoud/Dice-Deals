import os
import logging
import re
import secrets
import time
from functools import wraps
from logging.handlers import RotatingFileHandler
from pathlib import Path
import psycopg

from flask import Flask, request, jsonify, render_template, redirect, session
from dotenv import load_dotenv

from database import (
    create_database, create_user, get_user_by_username, get_user_by_id,
    update_user_avatar, update_last_seen, search_users,
    send_friend_request, respond_friend_request, remove_friend, get_friends,
    create_friend_invite, get_friend_invites, dismiss_friend_invite,
    create_auth_token, get_user_by_token, delete_auth_token,
    update_user_bio_status, update_user_privacy,
    get_linked_accounts, remove_linked_account,
    get_sessions, delete_other_sessions, delete_user,
    AVATAR_STYLES, update_user_room, update_user_display_name,
    is_display_name_available, link_oauth_identity,
    get_connection,
)
import supabase_client
from game import (
    game_bp, maybe_load_game, bump_game_revision, persist_game,
    load_persisted_games, start_game_cleanup_thread,
    check_periodic_cleanup, handle_game_after_request,
)

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", os.urandom(32))
app.register_blueprint(game_bp)


def configure_logging():
    log_dir = Path(os.getenv("APP_LOG_DIR", Path(__file__).resolve().parent.parent / "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    if any(getattr(handler, "name", "") == "dice-deals-file" for handler in app.logger.handlers):
        return
    handler = RotatingFileHandler(log_dir / "dice-deals.log", maxBytes=2_000_000,
                                  backupCount=5, encoding="utf-8")
    handler.name = "dice-deals-file"
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler.setLevel(logging.INFO)
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)


configure_logging()

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID")
DISCORD_REDIRECT_URI = os.getenv("DISCORD_REDIRECT_URI")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET")

create_database()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _avatar_bg_style(color, style):
    c = color or "#3b82f6"
    if style == "horizontal":
        return f"linear-gradient(90deg, {c}, {c}dd)"
    if style == "vertical":
        return f"linear-gradient(180deg, {c}, {c}dd)"
    if style == "radial":
        return f"radial-gradient(circle at 30% 30%, {c}f2, {c})"
    if style == "solid":
        return c
    return f"linear-gradient(135deg, {c}, {c}dd)"

def _connect_auth_db():
    """Verbindung zur Supabase-DB (dort liegt auth.users)."""
    dsn = os.getenv("SUPABASE_DB_URL")
    if not dsn:
        raise RuntimeError("SUPABASE_DB_URL ist nicht gesetzt")
    return psycopg.connect(dsn, connect_timeout=10)


def get_user_email(user_id):
    """Holt die E-Mail aus Supabase auth.users für die angegebene User-ID."""
    if not user_id:
        return None
    try:
        with _connect_auth_db() as conn:
            with conn.cursor() as c:
                c.execute("SELECT email FROM auth.users WHERE id = %s", (user_id,))
                row = c.fetchone()
        return row[0] if row else None
    except Exception as e:
        app.logger.warning("E-Mail-Lookup fehlgeschlagen für User %s: %s", user_id, e)
        return None


def get_user_by_email(email):
    """Findet einen User über die Supabase auth.users E-Mail."""
    if not email:
        return None
    try:
        with _connect_auth_db() as conn:
            with conn.cursor() as c:
                c.execute("SELECT id FROM auth.users WHERE LOWER(email) = LOWER(%s)", (email,))
                row = c.fetchone()
    except Exception as e:
        app.logger.warning("User-Lookup per E-Mail fehlgeschlagen: %s", e)
        return None
    if not row:
        return None
    return get_user_by_id(row[0])


@app.context_processor
def _inject_avatar_bg_style():
    return dict(avatar_bg_style=_avatar_bg_style)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect("/login")
        return f(*args, **kwargs)
    return decorated


def auth_provider_of(user):
    """Liefert 'supabase' | 'discord' | 'legacy' aus der User-Zeile (Index 5)."""
    return user[5] if len(user) > 5 and user[5] else "legacy"


BANNED_NAME_FRAGMENTS = {
    "arschloch", "bastard", "fick", "fotze", "hurensohn", "hure", "idiot",
    "kanake", "missbrauch", "nazi", "neger", "penis", "porno", "schlampe",
    "scheisse", "scheiß", "sex", "terrorist", "vergewalt", "whore",
}


def validate_display_name(username, exclude_user_id=None):
    username = (username or "").strip()
    if not 3 <= len(username) <= 20:
        return None, "Benutzername muss 3-20 Zeichen lang sein"
    if not all(ch.isalnum() or ch in " _-." for ch in username):
        return None, "Benutzername enthaelt ungueltige Zeichen"
    normalized = "".join(ch for ch in username.casefold() if ch.isalnum())
    if any(fragment in normalized for fragment in BANNED_NAME_FRAGMENTS):
        return None, "Dieser Benutzername ist nicht erlaubt"
    if not is_display_name_available(username, exclude_user_id):
        return None, "Dieser Benutzername ist bereits vergeben"
    return username, None


def profile_display_name(user):
    """Bearbeitbarer Anzeigename (display_name wenn gesetzt, sonst username)."""
    display_name = user[4] if len(user) > 4 and user[4] else user[1]
    return re.sub(r"#\d{1,4}$", "", display_name or "").strip()


def public_linked_accounts(user_id):
    accounts = get_linked_accounts(user_id)
    result = []
    for account in accounts:
        entry = dict(account)
        if entry.get("provider") == "discord":
            entry["username"] = re.sub(r"#\d{1,4}$", "", entry.get("username") or "").strip()
        result.append(entry)
    return result


def set_session_user(user):
    previous_guest_id = session.get("user_id") if session.get("is_guest") else None
    previous_room = session.get("room_code") if previous_guest_id else None
    session["user_id"] = str(user[0])
    session["username"] = profile_display_name(user)
    session["avatar_emoji"] = user[8] if len(user) > 8 and user[8] else "🎲"
    session["avatar_color"] = user[9] if len(user) > 9 and user[9] else "#3b82f6"
    session["avatar_url"] = user[3] if len(user) > 3 and user[3] else None
    session["avatar_style"] = user[7] if len(user) > 7 and user[7] else "diagonal"
    session["status_text"] = user[12] if len(user) > 12 and user[12] else None
    session["is_guest"] = False
    for key in ("profile_customized", "guest_token", "guest_id"):
        session.pop(key, None)

    if previous_room and previous_guest_id:
        game = maybe_load_game(previous_room)
        if game:
            player = next((p for p in game.players if p.user_id == previous_guest_id), None)
            if player:
                player.user_id = str(user[0])   # ← UUID → str
                bump_game_revision(previous_room)
                persist_game(previous_room, game)
            session["room_code"] = previous_room
            update_user_room(user[0], previous_room)   # DB-Call bleibt UUID, ok
            return

    saved_room = user[2] if len(user) > 2 and user[2] else None
    if saved_room:
        session["room_code"] = saved_room
    else:
        session.pop("room_code", None)


def set_remember_cookie(response, token):
    response.set_cookie(
        "remember_token",
        token,
        max_age=60 * 60 * 24 * 365,
        httponly=True,
        samesite="Lax",
        secure=request.is_secure,
        path="/",
    )
    return response


def set_guest_session(guest_id=None, username=None, avatar_emoji="🎲",
                      avatar_color="#3b82f6", avatar_url=None, is_customized=False):
    guest_id = guest_id or session.get("guest_id") or secrets.token_urlsafe(24)
    session["guest_id"] = guest_id
    session["user_id"] = "guest:" + guest_id
    session["username"] = username or "Spieler" + guest_id[:4].upper()
    session["avatar_emoji"] = avatar_emoji or "🎲"
    session["avatar_color"] = avatar_color or "#3b82f6"
    session["avatar_url"] = avatar_url
    session["is_guest"] = True
    session["profile_customized"] = bool(is_customized)


def merge_guest_profile_into_user(user_id):
    if not session.get("is_guest") or not session.get("profile_customized"):
        return None
    update_user_avatar(user_id, session.get("avatar_emoji", "🎲"),
                       session.get("avatar_color", "#3b82f6"),
                       session.get("avatar_url"))
    update_user_display_name(user_id, session.get("username"))
    return get_user_by_id(user_id)


def ensure_guest_session():
    if "user_id" in session:
        return
    set_guest_session()


def _has_password(user):
    """Im neuen Schema haben nur Supabase-Provider-Passwörter."""
    return auth_provider_of(user) == "supabase"


def _verify_current_password(user, password):
    if not password:
        return False
    email = get_user_email(user[0])
    if not email:
        return False
    try:
        return supabase_client.verify_password(email, password)
    except supabase_client.AuthError:
        return False


# ---------------------------------------------------------------------------
# Request-Hooks
# ---------------------------------------------------------------------------

@app.before_request
def auto_login_and_cleanup():
    path = request.path or ""
    is_auth_path = (...)

    if "user_id" not in session:
        token = request.cookies.get("remember_token")
        if token:
            user = get_user_by_token(token)
            if user:
                set_session_user(user)

    # NEU: alte Sessions (vor dem Fix) enthielten ein UUID-Objekt
    if "user_id" in session and not session.get("is_guest"):
        session["user_id"] = str(session["user_id"])

    if "user_id" not in session and not is_auth_path and path != "/":
        ensure_guest_session()

    check_periodic_cleanup()


@app.after_request
def after_request_hook(response):
    if request.cookies.get("guest_token"):
        response.delete_cookie("guest_token", path="/")
    return handle_game_after_request(response)


load_persisted_games()
start_game_cleanup_thread()


# ---------------------------------------------------------------------------
# Dashboard & Auth
# ---------------------------------------------------------------------------

@app.route('/')
@login_required
def home():
    if not session.get("is_guest") and time.time() - session.get("last_seen_at", 0) > 60:
        update_last_seen(session["user_id"])
        session["last_seen_at"] = time.time()
    return render_template(
        "dashboard.html",
        username=session["username"],
        avatar_emoji=session.get("avatar_emoji", "🎲"),
        avatar_color=session.get("avatar_color", "#3b82f6"),
        avatar_url=session.get("avatar_url"),
        avatar_style=session.get("avatar_style", "diagonal"),
        status_text=session.get("status_text"),
        is_guest=session.get("is_guest", False),
        profile_customized=session.get("profile_customized", False),
    )


@app.route('/login')
def login_page():
    if "user_id" in session and not session.get("is_guest"):
        return redirect("/")
    return render_template("login.html")


@app.route('/verify-email')
def verify_email_page():
    if not session.get("verification_email"):
        return redirect("/login")
    return render_template("verify-email.html", email=session["verification_email"])


@app.route('/api/v1/verify-email', methods=['POST'])
def verify_email():
    email = session.get("verification_email")
    code = (request.get_json(silent=True) or {}).get("code", "")
    if not email:
        return jsonify({"error": "Keine ausstehende Bestätigung"}), 400
    if not isinstance(code, str) or not code.isdigit() or len(code) != 8:
        return jsonify({"error": "Bitte gib den achtstelligen Code ein"}), 400
    try:
        supabase_client.verify_email_code(email, code)
    except supabase_client.AuthError as e:
        app.logger.error("E-Mail-Code-Verifizierung fehlgeschlagen: %s", e)
        return jsonify({"error": "Code ungültig oder abgelaufen"}), 400

    user = get_user_by_email(email)
    if not user:
        return jsonify({"error": "Konto nicht gefunden"}), 404

    session.pop("verification_email", None)
    merged_user = merge_guest_profile_into_user(user[0])
    if merged_user:
        user = merged_user
    set_session_user(user)
    token = create_auth_token(user[0])
    response = jsonify({"message": "E-Mail bestätigt"})
    set_remember_cookie(response, token)
    return response


@app.route('/api/v1/verify-email/resend', methods=['POST'])
def resend_verify_email():
    email = session.get("verification_email")
    if not email:
        return jsonify({"error": "Keine ausstehende Bestätigung"}), 400
    try:
        supabase_client.resend_email_confirmation(email)
    except supabase_client.AuthError as e:
        app.logger.error("E-Mail-Code erneut senden fehlgeschlagen: %s", e)
        return jsonify({"error": "Code konnte nicht erneut gesendet werden"}), 400
    return jsonify({"message": "Ein neuer Code wurde gesendet"})


@app.route('/api/v1/guest', methods=['POST'])
def continue_as_guest():
    if not session.get("is_guest"):
        session.clear()
    set_guest_session()
    return jsonify({"message": "Gastmodus gestartet"}), 200


@app.route('/logout')
def logout():
    token = request.cookies.get("remember_token")
    if token:
        delete_auth_token(token)
    session.clear()
    response = redirect("/login")
    response.delete_cookie("remember_token", path="/")
    return response


@app.route('/activity')
def discord_activity():
    return render_template("activity.html", discord_client_id=DISCORD_CLIENT_ID)


@app.route('/account')
def account_page():
    is_guest = session.get("is_guest", True)
    return render_template(
        "account.html",
        is_guest=is_guest,
        username=session.get("username", ""),
        avatar_emoji=session.get("avatar_emoji", "🎲"),
        avatar_color=session.get("avatar_color", "#3b82f6"),
        avatar_url=session.get("avatar_url"),
        avatar_style=session.get("avatar_style", "diagonal"),
    )


@app.route('/api/v1/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    email = data.get("email", "").strip()
    if not username or not password or not email:
        return jsonify({"error": "Alle Felder sind erforderlich"}), 400
    username, name_error = validate_display_name(username)
    if name_error:
        return jsonify({"error": name_error}), 400
    if len(password) < 6:
        return jsonify({"error": "Passwort muss mindestens 6 Zeichen lang sein"}), 400

    if not supabase_client.is_configured():
        return jsonify({"error": "Supabase muss konfiguriert sein"}), 500

    try:
        auth_uid = supabase_client.register_auth_user(email, password, username)
    except supabase_client.AuthError as e:
        app.logger.error("Supabase Registrierung fehlgeschlagen: %s", e)
        msg = str(e).lower()
        if any(k in msg for k in ("already", "exists", "registered", "duplicate")):
            return jsonify({"error": "Benutzername oder E-Mail bereits vergeben"}), 409
        if "password" in msg:
            return jsonify({"error": "Passwort ist zu schwach"}), 400
        return jsonify({"error": f"Registrierung fehlgeschlagen: {e}"}), 400

    if not create_user(auth_uid, username, auth_provider="supabase"):
        supabase_client.delete_auth_user(auth_uid)
        return jsonify({"error": "Benutzername bereits vergeben"}), 409

    session["verification_email"] = email
    return jsonify({"message": "Bestätigungscode gesendet", "verification_required": True}), 201


@app.route('/api/v1/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    if not username or not password:
        return jsonify({"error": "Benutzername und Passwort erforderlich"}), 400

    user = get_user_by_username(username)
    if not user:
        return jsonify({"error": "Ungueltige Anmeldedaten"}), 401

    provider = auth_provider_of(user)
    if provider == "discord":
        return jsonify({"error": "Bitte mit Discord anmelden"}), 401

    email = get_user_email(user[0])
    if not email:
        return jsonify({"error": "Ungueltige Anmeldedaten"}), 401

    try:
        confirmed = supabase_client.is_email_confirmed(email)
    except supabase_client.AuthError:
        return jsonify({"error": "Bestätigungsstatus konnte nicht geprüft werden"}), 503
    if not confirmed:
        session["verification_email"] = email
        return jsonify({"error": "E-Mail-Adresse noch nicht bestätigt",
                        "verification_required": True}), 403

    try:
        ok = supabase_client.verify_password(email, password)
    except supabase_client.AuthError:
        ok = False
    if not ok:
        return jsonify({"error": "Ungueltige Anmeldedaten"}), 401

    merged_user = merge_guest_profile_into_user(user[0])
    if merged_user:
        user = merged_user
    set_session_user(user)
    token = create_auth_token(user[0])
    response = jsonify({"message": "Login erfolgreich"})
    set_remember_cookie(response, token)
    return response, 200


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

def _start_oauth(provider, intent):
    redirect_uri = request.url_root.rstrip('/') + f'/api/v1/{provider}/callback'
    session[f"{provider}_oauth_intent"] = intent
    try:
        url, verifier = supabase_client.oauth_redirect(provider, redirect_uri=redirect_uri)
    except supabase_client.AuthError:
        return redirect("/login?error=oauth_failed")
    session[f"{provider}_oauth_verifier"] = verifier
    session[f"{provider}_oauth_redirect_uri"] = redirect_uri
    return redirect(url)


def _apply_oauth_identity(user_id, provider, auth_uid, ext_id, avatar, username):
    link_oauth_identity(user_id, provider, auth_uid, ext_id, username, avatar)


def _link_oauth_account(provider, auth_uid, ext_id, avatar, username):
    _apply_oauth_identity(session["user_id"], provider, auth_uid, ext_id, avatar, username)
    if avatar and not session.get("avatar_url"):
        update_user_avatar(session["user_id"], session.get("avatar_emoji", "🎲"),
                           session.get("avatar_color", "#3b82f6"), avatar,
                           session.get("avatar_style", "diagonal"))
        session["avatar_url"] = avatar
    session[f"{provider}_linked"] = True
    return redirect(f"/?{provider}_linked=1")


def _fill_discord_avatar_url(user_row, discord_avatar):
    """Füllt avatar_url (Index 3) aus dem Discord-Profilbild, wenn leer."""
    if not discord_avatar or not user_row or len(user_row) <= 3 or user_row[3]:
        return user_row
    update_user_avatar(user_row[0], user_row[8] or "🎲", user_row[9] or "#3b82f6",
                       discord_avatar, user_row[7] or "diagonal")
    return get_user_by_id(user_row[0])


def _oauth_callback(provider):
    error = request.args.get("error")
    code = request.args.get("code")
    if error or not code:
        app.logger.error("%s OAuth callback ohne Code: error=%r args=%s",
                         provider, error, dict(request.args))
        return redirect("/login?error=oauth_failed")
    verifier = session.pop(f"{provider}_oauth_verifier", None)
    redirect_uri = session.pop(f"{provider}_oauth_redirect_uri", None)
    intent = session.pop(f"{provider}_oauth_intent", None)
    if not verifier or not redirect_uri:
        return redirect("/login?error=oauth_failed")
    try:
        auth_uid, email, username, ext_id, avatar = supabase_client.oauth_callback(
            provider, code, redirect_uri=redirect_uri, code_verifier=verifier)
    except supabase_client.AuthError as e:
        app.logger.error("%s OAuth exchange failed: %s", provider, e)
        return redirect("/login?error=oauth_failed")
    if not auth_uid:
        return redirect("/login?error=oauth_failed")

    if intent == "link" and "user_id" in session and not session.get("is_guest"):
        return _link_oauth_account(provider, auth_uid, ext_id, avatar, username)

    user = get_user_by_id(auth_uid)
    if not user and email:
        user = get_user_by_email(email)
    if not user:
        if not create_user(auth_uid, username or f"{provider}-user", auth_provider=provider):
            return redirect("/login?error=oauth_failed")
        _apply_oauth_identity(auth_uid, provider, auth_uid, ext_id, avatar, username)
        refreshed = get_user_by_id(auth_uid)
    else:
        _apply_oauth_identity(user[0], provider, auth_uid, ext_id, avatar, username)
        refreshed = get_user_by_id(user[0])
    refreshed = _fill_discord_avatar_url(refreshed, avatar)
    merged_user = merge_guest_profile_into_user(refreshed[0])
    if merged_user:
        refreshed = merged_user
    set_session_user(refreshed)
    token = create_auth_token(refreshed[0])
    response = redirect("/")
    set_remember_cookie(response, token)
    return response


@app.route('/login/discord')
def discord_login():
    return _start_oauth("discord", "login")


@app.route('/api/v1/discord/callback')
def discord_callback():
    return _oauth_callback("discord")


@app.route('/login/discord/link')
@login_required
def discord_link():
    return _start_oauth("discord", "link")


# ---------------------------------------------------------------------------
# Konto / Profil
# ---------------------------------------------------------------------------

@app.route('/api/user/profile')
@login_required
def user_profile():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben kein Konto"}), 403
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    linked = public_linked_accounts(user[0])
    discord = next((a for a in linked if a.get("provider") == "discord"), None)
    return jsonify({
        "user_id": user[0],
        "username": profile_display_name(user),
        "email": get_user_email(user[0]),
        "avatar_emoji": user[8] if len(user) > 8 and user[8] else "🎲",
        "avatar_color": user[9] if len(user) > 9 and user[9] else "#3b82f6",
        "avatar_url": user[3] if len(user) > 3 else None,
        "avatar_style": user[7] if len(user) > 7 and user[7] else "diagonal",
        "bio": user[11] if len(user) > 11 else None,
        "status_text": user[12] if len(user) > 12 else None,
        "show_last_seen": True if len(user) <= 13 or user[13] is None else bool(user[13]),
        "show_in_search": True if len(user) <= 14 or user[14] is None else bool(user[14]),
        "allow_friend_requests": True if len(user) <= 15 or user[15] is None else bool(user[15]),
        "linked_accounts": linked,
        "display_name": user[4] if len(user) > 4 else None,
        "discord_username": discord.get("username") if discord else None,
        "discord_avatar": discord.get("avatar") if discord else None,
        "discord_id": discord.get("id") if discord else None,
        "auth_provider": auth_provider_of(user),
        "has_password": _has_password(user),
    })


@app.route('/api/user/profile', methods=['POST'])
@login_required
def update_profile():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben kein Konto"}), 403
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or not isinstance(data.get("username", ""), str):
        return jsonify({"error": "Ungueltige Profildaten"}), 400
    username = data.get("username", "").strip()
    bio = (data.get("bio") or "").strip()[:160] if isinstance(data.get("bio"), (str, type(None))) else ""
    status_text = (data.get("status_text") or "").strip()[:60] if isinstance(data.get("status_text"), (str, type(None))) else ""
    if not username:
        return jsonify({"error": "Benutzername darf nicht leer sein"}), 400
    username, name_error = validate_display_name(username, session["user_id"])
    if name_error:
        return jsonify({"error": name_error}), 400
    if username != session.get("username") and session.get("room_code"):
        return jsonify({"error": "Aendere deinen Namen bitte, nachdem du den Spielraum verlassen hast"}), 409
    if not update_user_display_name(session["user_id"], username):
        return jsonify({"error": "Fehler beim Speichern"}), 500
    if not update_user_bio_status(session["user_id"], bio or None, status_text or None):
        return jsonify({"error": "Fehler beim Speichern"}), 500
    session["username"] = username
    session["status_text"] = status_text or None
    return jsonify({"message": "Profil aktualisiert", "username": username,
                    "bio": bio or None, "status_text": status_text or None})


@app.route('/api/user/avatar', methods=['POST'])
@login_required
def set_avatar():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Ungueltige Profildaten"}), 400

    def text(value, fallback=""):
        if value is None:
            return fallback
        return value.strip() if isinstance(value, str) else None

    emoji = text(data.get("emoji"), "🎲")
    color = text(data.get("color"), "#3b82f6")
    avatar_url = text(data.get("avatar_url")) or None
    avatar_style = text(data.get("avatar_style"), "diagonal")
    username = text(data.get("username"), session.get("username", ""))
    if None in (emoji, color, avatar_style, username):
        return jsonify({"error": "Ungueltige Profildaten"}), 400
    if not emoji or len(emoji) > 4:
        return jsonify({"error": "Ungueltiges Emoji"}), 400
    if not color or len(color) > 20:
        return jsonify({"error": "Ungueltige Farbe"}), 400
    if avatar_style not in AVATAR_STYLES:
        return jsonify({"error": "Ungueltiger Avatar-Stil"}), 400
    if avatar_url and not (avatar_url.startswith("https://cdn.discordapp.com/")
                           or avatar_url.startswith("https://media.discordapp.net/")):
        return jsonify({"error": "Ungueltige Profilbild-URL"}), 400

    username, name_error = validate_display_name(
        username, None if session.get("is_guest") else session["user_id"])
    if name_error:
        return jsonify({"error": name_error}), 400

    if session.get("is_guest"):
        set_guest_session(session.get("guest_id"), username, emoji, color, avatar_url,
                          is_customized=True)
        session["avatar_style"] = avatar_style
        return jsonify({
            "message": "Gastprofil aktualisiert",
            "username": session["username"],
            "avatar_emoji": session["avatar_emoji"],
            "avatar_color": session["avatar_color"],
            "avatar_url": session["avatar_url"],
            "avatar_style": avatar_style,
        }), 200

    if username != session.get("username") and session.get("room_code"):
        return jsonify({"error": "Aendere deinen Namen bitte, nachdem du den Spielraum verlassen hast"}), 409

    if not update_user_avatar(session["user_id"], emoji, color, avatar_url, avatar_style):
        return jsonify({"error": "Fehler beim Speichern"}), 500
    session["avatar_emoji"] = emoji
    session["avatar_color"] = color
    session["avatar_url"] = avatar_url
    session["avatar_style"] = avatar_style
    if username != session.get("username"):
        if not update_user_display_name(session["user_id"], username):
            return jsonify({"error": "Avatar gespeichert, Name fehlgeschlagen"}), 500
        session["username"] = username
    return jsonify({"message": "Profil aktualisiert", "username": session["username"],
                    "avatar_emoji": emoji, "avatar_color": color,
                    "avatar_url": avatar_url, "avatar_style": avatar_style})


@app.route('/api/user/email', methods=['POST'])
@login_required
def update_email():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben keine E-Mail-Adresse"}), 403
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email or len(email) > 254:
        return jsonify({"error": "Bitte gib eine gueltige E-Mail-Adresse ein"}), 400
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    if not _has_password(user):
        return jsonify({"error": "Discord-Nutzer ohne Passwort koennen ihre E-Mail nicht aendern"}), 403
    if not data.get("current_password"):
        return jsonify({"error": "Aktuelles Passwort fehlt"}), 400
    if not _verify_current_password(user, data.get("current_password", "")):
        return jsonify({"error": "Das aktuelle Passwort ist nicht korrekt"}), 403
    auth_uid = user[6]
    try:
        supabase_client.update_email(auth_uid, email)
    except supabase_client.AuthError:
        return jsonify({"error": "Diese E-Mail-Adresse wird bereits verwendet"}), 409
    return jsonify({"message": "E-Mail-Adresse aktualisiert", "email": email})


@app.route('/api/user/password', methods=['POST'])
@login_required
def update_password():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben kein Passwort"}), 403
    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password", "")
    new_password = data.get("new_password", "")
    if len(new_password) < 8:
        return jsonify({"error": "Das neue Passwort muss mindestens 8 Zeichen lang sein"}), 400
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    provider = auth_provider_of(user)
    if provider == "discord":
        return jsonify({"error": "Discord-Nutzer haben kein Passwort"}), 403
    if not _verify_current_password(user, current_password):
        return jsonify({"error": "Das aktuelle Passwort ist nicht korrekt"}), 403
    auth_uid = user[6]
    try:
        supabase_client.update_password(auth_uid, new_password)
    except supabase_client.AuthError:
        return jsonify({"error": "Passwort konnte nicht geaendert werden"}), 500
    return jsonify({"message": "Passwort aktualisiert"})


@app.route('/api/user/privacy', methods=['POST'])
@login_required
def update_privacy():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben keine Privatsphaere-Einstellungen"}), 403
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    data = request.get_json(silent=True) or {}
    flags = {
        "show_last_seen": True if len(user) <= 13 or user[13] is None else bool(user[13]),
        "show_in_search": True if len(user) <= 14 or user[14] is None else bool(user[14]),
        "allow_friend_requests": True if len(user) <= 15 or user[15] is None else bool(user[15]),
    }
    for key in flags:
        if key in data:
            if not isinstance(data[key], bool):
                return jsonify({"error": f"Ungueltiger Wert fuer {key}"}), 400
            flags[key] = data[key]
    update_user_privacy(session["user_id"], flags["show_last_seen"],
                        flags["show_in_search"], flags["allow_friend_requests"])
    return jsonify({"message": "Privatsphaere aktualisiert", **flags})


@app.route('/api/user/connections/<provider>')
@login_required
def get_connection(provider):
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben keine Verknuepfungen"}), 403
    if provider not in supabase_client.OAUTH_PROVIDERS:
        return jsonify({"error": "Unbekannter Provider"}), 400
    accounts = get_linked_accounts(session["user_id"])
    entry = next((a for a in accounts if a.get("provider") == provider), None)
    if not entry:
        return jsonify({"error": "Verknuepfung nicht gefunden"}), 404
    return jsonify(entry)


@app.route('/api/user/connections/<provider>', methods=['DELETE'])
@login_required
def unlink_connection(provider):
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben keine Verknuepfungen"}), 403
    if provider not in supabase_client.OAUTH_PROVIDERS:
        return jsonify({"error": "Unbekannter Provider"}), 400
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    accounts = get_linked_accounts(user[0])
    if not any(a.get("provider") == provider for a in accounts):
        return jsonify({"error": "Verknuepfung nicht gefunden"}), 404
    if auth_provider_of(user) == provider and not _has_password(user):
        return jsonify({"error": "Diese Verknuepfung ist deine einzige Anmeldung; "
                                 "setze zuerst ein Passwort"}), 403
    remove_linked_account(user[0], provider)
    return jsonify({"message": "Verknuepfung entfernt", "provider": provider})


@app.route('/api/user/sessions')
@login_required
def list_sessions():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben keine Sitzungen"}), 403
    token = request.cookies.get("remember_token")
    return jsonify({"sessions": get_sessions(session["user_id"], token)})


@app.route('/api/user/sessions', methods=['DELETE'])
@login_required
def revoke_other_sessions():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben keine Sitzungen"}), 403
    token = request.cookies.get("remember_token")
    count = delete_other_sessions(session["user_id"], token)
    return jsonify({"message": f"{count} andere Sitzungen beendet", "revoked": count})


@app.route('/api/user/delete', methods=['POST'])
@login_required
def delete_account():
    if session.get("is_guest"):
        return jsonify({"error": "Gaeste haben kein Konto"}), 403
    data = request.get_json(silent=True) or {}
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    if _has_password(user):
        if not _verify_current_password(user, data.get("password", "")):
            return jsonify({"error": "Passwort ist nicht korrekt"}), 403
    else:
        if (data.get("username") or "").strip() != user[1]:
            return jsonify({"error": "Benutzername stimmt nicht ueberein"}), 403
    # Raum verlassen
    from game import leave_current_room as _leave_room
    _leave_room(session["user_id"], session["username"])
    auth_uid = user[6]
    if auth_uid:
        try:
            supabase_client.delete_auth_user(auth_uid)
        except Exception:
            pass
    delete_user(session["user_id"])
    token = request.cookies.get("remember_token")
    if token:
        delete_auth_token(token)
    session.clear()
    response = jsonify({"message": "Konto geloescht"})
    response.delete_cookie("remember_token", path="/")
    return response


# ---------------------------------------------------------------------------
# Freunde
# ---------------------------------------------------------------------------

@app.route('/api/friends/search')
@login_required
def friends_search():
    if session.get("is_guest"):
        return jsonify([])
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    return jsonify(search_users(q, session["user_id"]))


@app.route('/api/friends/list')
@login_required
def friends_list():
    if session.get("is_guest"):
        return jsonify({"friends": [], "pending_incoming": [],
                        "pending_outgoing": [], "invites": []})
    update_last_seen(session["user_id"])
    data = get_friends(session["user_id"])
    data["invites"] = get_friend_invites(session["user_id"])
    return jsonify(data)


@app.route('/api/friends/request', methods=['POST'])
@login_required
def friends_request():
    data = request.get_json(silent=True) or {}
    friend_id = data.get("friend_id", "").strip()
    if not friend_id:
        return jsonify({"error": "Benutzer-ID fehlt"}), 400
    if friend_id == session["user_id"]:
        return jsonify({"error": "Du kannst dich nicht selbst hinzufuegen"}), 400
    friend = get_user_by_id(friend_id)
    if not friend:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    if len(friend) > 15 and friend[15] is False:
        return jsonify({"error": "Dieser Nutzer akzeptiert keine Freundschaftsanfragen"}), 403
    success, msg = send_friend_request(session["user_id"], friend_id)
    if not success:
        return jsonify({"error": msg}), 400
    return jsonify({"message": msg})


@app.route('/api/friends/respond', methods=['POST'])
@login_required
def friends_respond():
    data = request.get_json(silent=True) or {}
    friend_id = data.get("friend_id", "").strip()
    accept = data.get("accept", False)
    if not friend_id:
        return jsonify({"error": "Benutzer-ID fehlt"}), 400
    if not respond_friend_request(session["user_id"], friend_id, accept):
        return jsonify({"error": "Diese Anfrage wurde bereits bearbeitet"}), 409
    return jsonify({"message": "Anfrage angenommen" if accept else "Anfrage abgelehnt"})


@app.route('/api/friends/remove', methods=['POST'])
@login_required
def friends_remove():
    data = request.get_json(silent=True) or {}
    friend_id = data.get("friend_id", "").strip()
    if not friend_id:
        return jsonify({"error": "Benutzer-ID fehlt"}), 400
    remove_friend(session["user_id"], friend_id)
    return jsonify({"message": "Freund entfernt"})


@app.route('/api/friends/invite', methods=['POST'])
@login_required
def friends_invite():
    data = request.get_json(silent=True) or {}
    friend_id = data.get("friend_id", "").strip()
    code = session.get("room_code")
    if not code:
        return jsonify({"error": "Du bist in keinem Raum"}), 400
    if not friend_id:
        return jsonify({"error": "Benutzer-ID fehlt"}), 400
    create_friend_invite(session["user_id"], friend_id, code)
    return jsonify({"message": "Einladung gesendet"})


@app.route('/api/friends/invites')
@login_required
def friends_invites():
    return jsonify(get_friend_invites(session["user_id"]))


@app.route('/api/friends/invite/respond', methods=['POST'])
@login_required
def friends_invite_respond():
    data = request.get_json(silent=True) or {}
    invite_id = data.get("invite_id")
    accept = data.get("accept", False)
    if not invite_id:
        return jsonify({"error": "Einladung-ID fehlt"}), 400
    # Vor dem Löschen nachschlagen (Bug-Fix: alte Version hat danach gesucht)
    invites = get_friend_invites(session["user_id"])
    target = next((i for i in invites if i["id"] == invite_id), None)
    dismiss_friend_invite(invite_id)
    if accept and target:
        session["room_code"] = target["room_code"]
        if not session.get("is_guest"):
            update_user_room(session["user_id"], target["room_code"])
        return jsonify({"message": "Beigetreten", "room_code": target["room_code"]})
    return jsonify({"message": "Einladung abgelehnt"})


@app.route('/api/discord/info')
@login_required
def discord_info():
    if session.get("is_guest"):
        return jsonify({
            "has_discord_account": False,
            "discord_username": None,
            "discord_avatar": None,
            "discord_id": None,
        })
    user = get_user_by_id(session["user_id"])
    linked = get_linked_accounts(user[0]) if user else []
    discord = next((a for a in linked if a.get("provider") == "discord"), None)
    return jsonify({
        "has_discord_account": discord is not None,
        "discord_username": re.sub(r"#\d{1,4}$", "",
                                   discord.get("username") or "").strip() if discord else None,
        "discord_avatar": discord.get("avatar") if discord else None,
        "discord_id": discord.get("id") if discord else None,
    })


# ---------------------------------------------------------------------------
# Error-Handler
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(error):
    return render_template("404.html"), 404


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5555, debug=True)