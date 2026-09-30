import os
import hashlib
import json
import random
import string
import threading
import time
import requests
from functools import wraps
from flask import Flask, request, jsonify, render_template, redirect, session
from database import (create_database, create_user, get_user_by_username,
                      get_user_by_id, update_user_avatar, update_last_seen,
                      search_users, send_friend_request, respond_friend_request,
                      remove_friend, get_friends, create_friend_invite,
                      get_friend_invites, dismiss_friend_invite,
                      update_user_discord_info,
                      create_auth_token, get_user_by_token, delete_auth_token,
                      save_game, load_games, get_game_state, touch_game,
                      delete_game, get_stale_game_codes,
                      update_user_room, clear_room_code_for_game)
from ID_Creator import create_user_id
from game_logic import Game, active_games
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", os.urandom(32))

DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID")
DISCORD_REDIRECT_URI = os.getenv("DISCORD_REDIRECT_URI")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET")

create_database()

def hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect("/login")
        return f(*args, **kwargs)
    return decorated


def generate_room_code() -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=6))
        if code not in active_games and get_game_state(code) is None:
            return code


def get_room_code():
    return session.get("room_code")


def get_current_game():
    code = get_room_code()
    if not code:
        return None, None
    game = maybe_load_game(code)
    if game is None:
        session.pop("room_code", None)
        uid = session.get("user_id")
        if uid:
            try:
                update_user_room(uid, None)
            except Exception:
                pass
        return None, None
    return game, code


def parse_int_field(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

GAME_IDLE_TIMEOUT = 300
_last_game_cleanup = 0.0
_cleanup_thread_started = False


def load_game_from_state(room_code, state_json):
    try:
        game = Game.from_storage_dict(json.loads(state_json))
        active_games[room_code] = game
        return game
    except Exception:
        app.logger.exception("Spielstand konnte nicht geladen werden: %s", room_code)
        return None


def persist_game(room_code, game):
    if not room_code or game is None:
        return
    try:
        save_game(room_code, json.dumps(game.to_storage_dict(), ensure_ascii=False))
    except Exception:
        app.logger.exception("Spielstand konnte nicht gespeichert werden: %s", room_code)


def leave_current_room(user_id, username):
    room_code = session.get("room_code")
    if not room_code:
        return
    game = maybe_load_game(room_code)
    if game:
        game.disconnect_player(username)
        active_players = [p for p in game.players if not p.is_disconnected and not p.is_bankrupt]
        if not active_players:
            active_games.pop(room_code, None)
            delete_game(room_code)
            clear_room_code_for_game(room_code)
        else:
            persist_game(room_code, game)
    update_user_room(user_id, None)
    session.pop("room_code", None)


def maybe_load_game(room_code):
    if not room_code or room_code in active_games:
        return active_games.get(room_code)
    state = get_game_state(room_code)
    if not state:
        return None
    return load_game_from_state(room_code, state)


def load_persisted_games():
    try:
        for room_code, state in load_games():
            game = load_game_from_state(room_code, state)
            if game is not None:
                touch_game(room_code)
    except Exception:
        app.logger.exception("Spielstände konnten nicht geladen werden.")


def cleanup_stale_games():
    global _last_game_cleanup
    _last_game_cleanup = time.time()
    try:
        cutoff = time.time() - GAME_IDLE_TIMEOUT
        for room_code in get_stale_game_codes(cutoff):
            active_games.pop(room_code, None)
            delete_game(room_code)
            clear_room_code_for_game(room_code)
    except Exception:
        app.logger.exception("Aufräumen alter Spiele fehlgeschlagen.")


def _cleanup_worker():
    while True:
        time.sleep(60)
        cleanup_stale_games()


def start_game_cleanup_thread():
    global _cleanup_thread_started
    if _cleanup_thread_started:
        return
    _cleanup_thread_started = True
    threading.Thread(target=_cleanup_worker, daemon=True).start()


def set_session_user(user):
    session["user_id"] = user[0]
    session["username"] = user[1]
    session["avatar_emoji"] = user[7] if len(user) > 7 and user[7] else "\U0001F3B2"
    session["avatar_color"] = user[8] if len(user) > 8 and user[8] else "#3b82f6"
    session["avatar_url"] = user[14] if len(user) > 14 and user[14] else None
    saved_room = user[13] if len(user) > 13 and user[13] else None
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


@app.before_request
def auto_login_and_cleanup():
    if "user_id" not in session:
        token = request.cookies.get("remember_token")
        if token:
            user = get_user_by_token(token)
            if user:
                set_session_user(user)
    if time.time() - _last_game_cleanup > 60:
        cleanup_stale_games()


@app.after_request
def save_game_after_request(response):
    code = session.get("room_code")
    if code and code in active_games:
        persist_game(code, active_games[code])
    return response


load_persisted_games()
start_game_cleanup_thread()


@app.route('/')
@login_required
def home():
    update_last_seen(session["user_id"])
    return render_template("dashboard.html",
                           username=session["username"],
                           avatar_emoji=session.get("avatar_emoji", "🎲"),
                           avatar_color=session.get("avatar_color", "#3b82f6"),
                           avatar_url=session.get("avatar_url"))


@app.route('/login')
def login_page():
    if "user_id" in session:
        return redirect("/")
    return render_template("login.html")


@app.route('/logout')
def logout():
    token = request.cookies.get("remember_token")
    if token:
        delete_auth_token(token)
    session.clear()
    response = redirect("/login")
    response.delete_cookie("remember_token", path="/")
    return response


@app.route('/dice-deals')
@login_required
def dice_deals():
    return render_template("dice-deals.html", room_code=get_room_code() or "", avatar_url=session.get("avatar_url"))


@app.route('/activity')
def discord_activity():
    return render_template("activity.html", discord_client_id=DISCORD_CLIENT_ID)


@app.route('/api/v1/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    email = data.get("email", "").strip()
    if not username or not password or not email:
        return jsonify({"error": "Alle Felder sind erforderlich"}), 400
    if len(username) < 3 or len(username) > 20:
        return jsonify({"error": "Benutzername muss 3-20 Zeichen lang sein"}), 400
    if len(password) < 6:
        return jsonify({"error": "Passwort muss mindestens 6 Zeichen lang sein"}), 400
    user_id = create_user_id()
    success = create_user(user_id, username, hash_password(password), email)
    if not success:
        return jsonify({"error": "Benutzername oder E-Mail bereits vergeben"}), 409
    return jsonify({"message": "Registrierung erfolgreich"}), 201


@app.route('/api/v1/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")
    if not username or not password:
        return jsonify({"error": "Benutzername und Passwort erforderlich"}), 400
    user = get_user_by_username(username)
    if not user or user[2] != hash_password(password):
        return jsonify({"error": "Ungueltige Anmeldedaten"}), 401
    set_session_user(user)
    token = create_auth_token(user[0])
    response = jsonify({"message": "Login erfolgreich"})
    set_remember_cookie(response, token)
    return response, 200


@app.route('/login/discord')
def discord_login():
    url = (
        "https://discord.com/api/oauth2/authorize"
        f"?client_id={DISCORD_CLIENT_ID}"
        "&response_type=code"
        f"&redirect_uri={DISCORD_REDIRECT_URI}"
        "&scope=identify email"
    )
    return redirect(url)


@app.route('/api/v1/discord/callback')
def discord_callback():
    code = request.args.get("code")
    state = request.args.get("state")
    if not code:
        return redirect("/login?error=oauth_failed")
    token_res = requests.post(
        "https://discord.com/api/oauth2/token",
        data={"client_id": DISCORD_CLIENT_ID, "client_secret": DISCORD_CLIENT_SECRET,
              "grant_type": "authorization_code", "code": code, "redirect_uri": DISCORD_REDIRECT_URI},
        headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=10)
    access_token = token_res.json().get("access_token")
    if not access_token:
        return redirect("/login?error=oauth_failed")
    user_res = requests.get("https://discord.com/api/users/@me",
                            headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    user_data = user_res.json()
    discord_id = user_data.get("id")
    username = user_data.get("username")
    email = user_data.get("email")
    avatar_hash = user_data.get("avatar")
    discord_avatar_url = None
    if avatar_hash:
        ext = "gif" if avatar_hash.startswith("a_") else "png"
        discord_avatar_url = f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.{ext}?size=128"

    if state == "link_account" and "user_id" in session:
        update_user_discord_info(session["user_id"], discord_id, discord_avatar_url, username)
        session["discord_linked"] = True
        return redirect("/?discord_linked=1")

    user = get_user_by_username(username)
    if not user:
        user_id = create_user_id()
        create_user(user_id, username, "DISCORD_LOGIN", email, third_party=1, provider=1, ext_user_id=discord_id)
        update_user_discord_info(user_id, discord_id, discord_avatar_url, username)
    else:
        user_id = user[0]
        update_user_discord_info(user_id, discord_id, discord_avatar_url, username)
    refreshed = get_user_by_id(user_id)
    if refreshed:
        set_session_user(refreshed)
    else:
        session["user_id"] = user_id
        session["username"] = username
    token = create_auth_token(user_id)
    response = redirect("/")
    set_remember_cookie(response, token)
    return response


@app.route('/login/discord/link')
@login_required
def discord_link():
    url = (
        "https://discord.com/api/oauth2/authorize"
        f"?client_id={DISCORD_CLIENT_ID}"
        "&response_type=code"
        f"&redirect_uri={DISCORD_REDIRECT_URI}"
        "&scope=identify"
        "&state=link_account"
    )
    return redirect(url)


@app.route('/api/room/create', methods=['POST'])
@login_required
def create_room():
    leave_current_room(session["user_id"], session["username"])
    code = generate_room_code()
    game = Game()
    game.host_id = session["user_id"]
    game.host_username = session["username"]
    active_games[code] = game
    session["room_code"] = code
    update_user_room(session["user_id"], code)
    return jsonify({"code": code, "is_host": True}), 201

@app.route('/api/room/join', methods=['POST'])
@login_required
def join_room():
    data = request.get_json(silent=True) or {}
    code = data.get("code", "").strip().upper()
    if not code or len(code) != 6:
        return jsonify({"error": "Ungueltiger Code"}), 400
    game = maybe_load_game(code)
    if game is None:
        return jsonify({"error": "Raum nicht gefunden"}), 404
    if session.get("room_code") != code:
        leave_current_room(session["user_id"], session["username"])
    session["room_code"] = code
    update_user_room(session["user_id"], code)
    return jsonify({"code": code}), 200

@app.route('/api/room/leave', methods=['POST'])
@login_required
def leave_room():
    leave_current_room(session["user_id"], session["username"])
    return jsonify({"message": "Raum verlassen"}), 200

@app.route('/api/room/info')
@login_required
def room_info():
    code = get_room_code()
    if not code:
        return jsonify({"in_room": False}), 200
    game = maybe_load_game(code)
    if game is None:
        return jsonify({"in_room": False}), 200
    is_host = game.host_id == session.get("user_id","")
    return jsonify({"in_room": True, "code": code, "player_count": len(game.players), "is_host": is_host}), 200

@app.route('/api/game/state')
@login_required
def game_state():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum beigetreten"}), 400
    game.check_turn_timeout()
    return jsonify(game.to_dict())

def _require_my_turn(game):
    if not game.players:
        return jsonify({"error": "Kein aktives Spiel"}), 400
    current = game.players[game.current_player_index]
    if current.user_id != session["user_id"]:
        return jsonify({"error": "Du bist nicht dran"}), 403
    return None

@app.route('/api/game/roll', methods=['POST'])
@login_required
def roll_dice():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    err = _require_my_turn(game)
    if err:
        return err
    if game.pending_rent:
        return jsonify({"error": "Du musst zuerst die Miete bezahlen."}), 400
    if game.pending_tax:
        return jsonify({"error": "Du musst zuerst die Steuer bezahlen."}), 400
    if game.pending_card:
        return jsonify({"error": "Du musst zuerst die Karte bestaetigen."}), 400
    game.roll_dice()
    return jsonify(game.to_dict())

@app.route('/api/game/buy', methods=['POST'])
@login_required
def buy_property():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    err = _require_my_turn(game)
    if err:
        return err
    success = game.buy_property()
    return jsonify({"success": success, **game.to_dict()})

@app.route('/api/game/build', methods=['POST'])
@login_required
def build_property():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    err = _require_my_turn(game)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    prop = data.get("property", "").strip()
    btype = data.get("type", "house")
    if not prop:
        return jsonify({"error": "Grundstuecksname fehlt"}), 400
    result = game.build(prop, btype)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Bauen fehlgeschlagen")}), 400
    return jsonify(game.to_dict())

@app.route('/api/game/join', methods=['POST'])
@login_required
def join_game():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    color = data.get("color", "blue")
    valid = ["red","green","yellow","blue","purple","orange","pink","teal","lime","white","brown","cyan"]
    if color not in valid:
        return jsonify({"error": f"Ungueltige Farbe."}), 400
    if any(p.color == color and not p.is_disconnected for p in game.players):
        return jsonify({"error": f"Die Farbe '{color}' ist bereits vergeben."}), 409
    avatar_emoji = session.get("avatar_emoji", "🎲")
    avatar_color = session.get("avatar_color", "#3b82f6")
    avatar_url = session.get("avatar_url")
    success = game.add_player(session["user_id"], session["username"], color, avatar_emoji, avatar_color, avatar_url)
    if not success:
        return jsonify({"error": "Beitreten fehlgeschlagen (max. 6 Spieler oder bereits drin)."}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/mortgage', methods=['POST'])
@login_required
def mortgage():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    prop = data.get("property", "").strip()
    action = data.get("action", "take")
    if not prop:
        return jsonify({"error": "Grundstuecksname fehlt"}), 400
    if action == "take":
        result = game.take_mortgage(prop, session["username"])
    else:
        result = game.lift_mortgage(prop, session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/room/kick', methods=['POST'])
@login_required
def kick_player():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    target = data.get("username", "").strip()
    if not target:
        return jsonify({"error": "Kein Benutzername angegeben"}), 400
    result = game.kick_player(session["user_id"], target)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/confirm_card', methods=['POST'])
@login_required
def confirm_card():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.confirm_card(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/use_jail_card', methods=['POST'])
@login_required
def use_jail_card():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.use_jail_card(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/buy_out_of_jail', methods=['POST'])
@login_required
def buy_out_of_jail():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.buy_out_of_jail(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/sell_building', methods=['POST'])
@login_required
def sell_building():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    prop = data.get("property", "").strip()
    sell_type = data.get("type", "house")
    if not prop:
        return jsonify({"error": "Grundstuecksname fehlt"}), 400
    result = game.sell_building(prop, sell_type, session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/end_turn', methods=['POST'])
@login_required
def end_turn():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    err = _require_my_turn(game)
    if err:
        return err
    if game.pending_rent:
        return jsonify({"error": "Du musst zuerst die Miete bezahlen."}), 400
    if game.pending_tax:
        return jsonify({"error": "Du musst zuerst die Steuer bezahlen."}), 400
    if game.pending_card:
        return jsonify({"error": "Du musst zuerst die Karte bestaetigen."}), 400
    game.end_turn()
    return jsonify(game.to_dict())

@app.route('/api/game/pay_rent', methods=['POST'])
@login_required
def pay_rent():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.confirm_rent_payment(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/offer_prop_for_rent', methods=['POST'])
@login_required
def offer_prop_for_rent():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    prop = data.get("property", "").strip()
    result = game.offer_property_for_rent(session["username"], prop)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/game/respond_rent_offer', methods=['POST'])
@login_required
def respond_rent_offer():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    accept = data.get("accept", False)
    result = game.respond_rent_offer(session["username"], accept)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())

@app.route('/api/game/pay_tax', methods=['POST'])
@login_required
def pay_tax():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.confirm_tax_payment(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())

@app.route('/api/trade/send', methods=['POST'])
@login_required
def trade_send():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    to = data.get("to", "").strip()
    my_props = data.get("my_props", [])
    my_money = parse_int_field(data.get("my_money", 0))
    their_props = data.get("their_props", [])
    their_money = parse_int_field(data.get("their_money", 0))
    result = game.send_trade(session["username"], to, my_props, my_money, their_props, their_money)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@app.route('/api/trade/respond', methods=['POST'])
@login_required
def trade_respond():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    action = data.get("action", "")
    if action not in ("accept", "reject", "counter"):
        return jsonify({"error": "Ungueltige Aktion"}), 400
    counter = None
    if action == "counter":
        counter = {
            "my_props": data.get("my_props", []),
            "my_money": parse_int_field(data.get("my_money", 0)),
            "their_props": data.get("their_props", []),
            "their_money": parse_int_field(data.get("their_money", 0))
        }
    result = game.respond_trade(session["username"], action, counter)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())

@app.route('/api/game/chat', methods=['POST'])
@login_required
def chat():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    text = data.get("text", "").strip()[:200]
    if not text:
        return jsonify({"error": "Leere Nachricht"}), 400
    me = next((p for p in game.players if p.username == session["username"]), None)
    color = me.color if me else "blue"
    game.chat_messages.append({
        "type": "chat",
        "from": session["username"],
        "from_color": color,
        "text": text
    })
    if len(game.chat_messages) > 200:
        game.chat_messages = game.chat_messages[-200:]
    return jsonify(game.to_dict())


@app.route('/api/user/profile')
@login_required
def user_profile():
    user = get_user_by_id(session["user_id"])
    if not user:
        return jsonify({"error": "Benutzer nicht gefunden"}), 404
    return jsonify({
        "user_id": user[0],
        "username": user[1],
        "email": user[3],
        "avatar_emoji": user[7] if len(user) > 7 and user[7] else "🎲",
        "avatar_color": user[8] if len(user) > 8 and user[8] else "#3b82f6",
        "avatar_url": user[14] if len(user) > 14 else None,
        "discord_username": user[12] if len(user) > 12 else None,
        "discord_avatar": user[11] if len(user) > 11 else None,
    })


@app.route('/api/user/avatar', methods=['POST'])
@login_required
def set_avatar():
    data = request.get_json(silent=True) or {}
    emoji = data.get("emoji", "🎲").strip()
    color = data.get("color", "#3b82f6").strip()
    avatar_url = (data.get("avatar_url") or "").strip() or None
    if not emoji or len(emoji) > 4:
        return jsonify({"error": "Ungueltiges Emoji"}), 400
    if not color or len(color) > 20:
        return jsonify({"error": "Ungueltige Farbe"}), 400
    if avatar_url and not (avatar_url.startswith("https://cdn.discordapp.com/") or avatar_url.startswith("https://media.discordapp.net/")):
        return jsonify({"error": "Ungueltige Profilbild-URL"}), 400
    success = update_user_avatar(session["user_id"], emoji, color, avatar_url)
    if not success:
        return jsonify({"error": "Fehler beim Speichern"}), 500
    session["avatar_emoji"] = emoji
    session["avatar_color"] = color
    session["avatar_url"] = avatar_url
    return jsonify({"message": "Avatar aktualisiert", "avatar_emoji": emoji, "avatar_color": color, "avatar_url": avatar_url})


@app.route('/api/friends/search')
@login_required
def friends_search():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    results = search_users(q, session["user_id"])
    return jsonify(results)


@app.route('/api/friends/list')
@login_required
def friends_list():
    update_last_seen(session["user_id"])
    data = get_friends(session["user_id"])
    invites = get_friend_invites(session["user_id"])
    data["invites"] = invites
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
    respond_friend_request(session["user_id"], friend_id, accept)
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
    code = get_room_code()
    if not code:
        return jsonify({"error": "Du bist in keinem Raum"}), 400
    if not friend_id:
        return jsonify({"error": "Benutzer-ID fehlt"}), 400
    create_friend_invite(session["user_id"], friend_id, code)
    return jsonify({"message": "Einladung gesendet"})


@app.route('/api/friends/invites')
@login_required
def friends_invites():
    invites = get_friend_invites(session["user_id"])
    return jsonify(invites)


@app.route('/api/friends/invite/respond', methods=['POST'])
@login_required
def friends_invite_respond():
    data = request.get_json(silent=True) or {}
    invite_id = data.get("invite_id")
    accept = data.get("accept", False)
    if not invite_id:
        return jsonify({"error": "Einladung-ID fehlt"}), 400
    dismiss_friend_invite(invite_id)
    if accept:
        invites = get_friend_invites(session["user_id"])
        target = next((i for i in invites if i["id"] == invite_id), None)
        if target:
            session["room_code"] = target["room_code"]
            return jsonify({"message": "Beigetreten", "room_code": target["room_code"]})
    return jsonify({"message": "Einladung abgelehnt"})


@app.route('/api/discord/info')
@login_required
def discord_info():
    user = get_user_by_id(session["user_id"])
    has_discord = bool(user and len(user) > 10 and user[10])
    return jsonify({
        "has_discord_account": has_discord,
        "discord_username": user[12] if user and len(user) > 12 else None,
        "discord_avatar": user[11] if user and len(user) > 11 else None,
        "discord_id": user[10] if user and len(user) > 10 else None,
    })


@app.errorhandler(404)
def not_found(error):
    return render_template("404.html"), 404


if __name__ == '__main__':
    app.run(debug=False, host="0.0.0.0", port=5000)
