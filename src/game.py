import json
import queue
import random
import string
import threading
import time
from functools import wraps

from flask import (
    Blueprint, request, jsonify, render_template, redirect, session,
    make_response, current_app,
)

from database import (
    save_game, load_games, get_game_state, touch_game,
    delete_game, get_stale_game_codes,
    update_user_room, clear_room_code_for_game,
)
from game_logic import Game, active_games, normalize_settings
from sse_manager import (
    push as sse_push, subscribe as sse_subscribe, unsubscribe as sse_unsubscribe,
)

game_bp = Blueprint("game", __name__)

GAME_IDLE_TIMEOUT = 600  # 10 Minuten ohne Aktivität
_last_game_cleanup = 0.0
_cleanup_thread_started = False
_game_revisions = {}


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect("/login")
        return f(*args, **kwargs)
    return decorated


def parse_int_field(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def generate_room_code() -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=6))
        if code not in active_games and get_game_state(code) is None:
            return code


def get_room_code():
    return session.get("room_code")


def load_game_from_state(room_code, state_json):
    try:
        game = Game.from_storage_dict(json.loads(state_json))
        active_games[room_code] = game
        _game_revisions.setdefault(room_code, 0)
        return game
    except Exception:
        current_app.logger.exception("Spielstand konnte nicht geladen werden: %s", room_code)
        return None


def persist_game(room_code, game):
    if not room_code or game is None:
        return
    try:
        save_game(room_code, json.dumps(game.to_storage_dict(), ensure_ascii=False))
    except Exception:
        current_app.logger.exception("Spielstand konnte nicht gespeichert werden: %s", room_code)


def bump_game_revision(room_code):
    if room_code:
        _game_revisions[room_code] = _game_revisions.get(room_code, 0) + 1


def maybe_load_game(room_code):
    if not room_code or room_code in active_games:
        return active_games.get(room_code)
    state = get_game_state(room_code)
    if not state:
        return None
    return load_game_from_state(room_code, state)


def get_current_game():
    code = get_room_code()
    if not code:
        return None, None
    game = maybe_load_game(code)
    if game is None:
        session.pop("room_code", None)
        uid = session.get("user_id")
        if uid and not session.get("is_guest"):
            try:
                update_user_room(uid, None)
            except Exception:
                pass
        return None, None
    return game, code


def leave_current_room(user_id, username):
    room_code = session.get("room_code")
    if not room_code:
        return
    game = maybe_load_game(room_code)
    if game:
        game.disconnect_player(username)
        active_players = [p for p in game.players
                          if not p.is_disconnected and not p.is_bankrupt]
        if not active_players:
            active_games.pop(room_code, None)
            _game_revisions.pop(room_code, None)
            delete_game(room_code)
            clear_room_code_for_game(room_code)
        else:
            persist_game(room_code, game)
    if not session.get("is_guest"):
        update_user_room(user_id, None)
    session.pop("room_code", None)


def load_persisted_games():
    try:
        for room_code, state in load_games():
            game = load_game_from_state(room_code, state)
            if game is not None:
                touch_game(room_code)
    except Exception:
        current_app.logger.exception("Spielstände konnten nicht geladen werden.")


def cleanup_stale_games():
    global _last_game_cleanup
    _last_game_cleanup = time.time()
    try:
        cutoff = time.time() - GAME_IDLE_TIMEOUT
        for room_code in get_stale_game_codes(cutoff):
            active_games.pop(room_code, None)
            _game_revisions.pop(room_code, None)
            delete_game(room_code)
            clear_room_code_for_game(room_code)
    except Exception:
        pass


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


def check_periodic_cleanup():
    if time.time() - _last_game_cleanup > 60:
        cleanup_stale_games()


def handle_game_after_request(response):
    code = session.get("room_code")
    mutates_game = (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and (
            request.path.startswith("/api/game/")
            or request.path.startswith("/api/trade/")
            or request.path.startswith("/api/room/")
        )
    )
    if response.status_code < 400 and code and code in active_games and mutates_game:
        bump_game_revision(code)
        persist_game(code, active_games[code])
        sse_push(code, active_games[code].to_dict())
    return response


def _require_my_turn(game):
    if not game.players:
        return jsonify({"error": "Kein aktives Spiel"}), 400
    current = game.players[game.current_player_index]
    if current.user_id != session["user_id"]:
        return jsonify({"error": "Du bist nicht dran"}), 403
    return None


# ---------------------------------------------------------------------------
# Raum / Spiel-Lobby
# ---------------------------------------------------------------------------

@game_bp.route('/dice-deals')
@login_required
def dice_deals():
    return render_template("dice-deals.html", room_code=get_room_code() or "",
                           avatar_url=session.get("avatar_url"))


@game_bp.route('/api/room/create', methods=['POST'])
@login_required
def create_room():
    leave_current_room(session["user_id"], session["username"])
    code = generate_room_code()
    settings = normalize_settings(request.get_json(silent=True) or {})
    game = Game(settings)
    game.host_id = session["user_id"]
    game.host_username = session["username"]
    active_games[code] = game
    session["room_code"] = code
    if not session.get("is_guest"):
        update_user_room(session["user_id"], code)
    return jsonify({"code": code, "is_host": True, "settings": game.settings}), 201


@game_bp.route('/api/room/join', methods=['POST'])
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
    if not session.get("is_guest"):
        update_user_room(session["user_id"], code)
    return jsonify({"code": code}), 200


@game_bp.route('/api/room/leave', methods=['POST'])
@login_required
def leave_room():
    leave_current_room(session["user_id"], session["username"])
    return jsonify({"message": "Raum verlassen"}), 200


@game_bp.route('/api/room/settings', methods=['POST'])
@login_required
def update_room_settings():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    if game.host_id != session["user_id"]:
        return jsonify({"error": "Nur der Host kann die Einstellungen aendern."}), 403
    if game.started:
        return jsonify({"error": "Einstellungen sind nach Spielstart gesperrt."}), 400
    result = game.update_settings(normalize_settings(request.get_json(silent=True) or {}))
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/room/info')
@login_required
def room_info():
    code = get_room_code()
    if not code:
        return jsonify({"in_room": False}), 200
    game = maybe_load_game(code)
    if game is None:
        return jsonify({"in_room": False}), 200
    is_host = game.host_id == session.get("user_id", "")
    return jsonify({"in_room": True, "code": code,
                    "player_count": len(game.players), "is_host": is_host}), 200


# ---------------------------------------------------------------------------
# Spielzustand & SSE
# ---------------------------------------------------------------------------

@game_bp.route('/api/game/state')
@login_required
def game_state():
    game, room_code = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum beigetreten"}), 400
    if game.check_turn_timeout():
        bump_game_revision(room_code)
        persist_game(room_code, game)
    revision = str(_game_revisions.get(room_code, 0))
    if request.headers.get("If-None-Match") == f'"{revision}"':
        response = make_response("", 304)
    else:
        response = make_response(jsonify(game.to_dict()))
    response.set_etag(revision)
    response.headers["Cache-Control"] = "private, no-cache"
    return response


@game_bp.route('/api/game/stream')
@login_required
def game_stream():
    code = session.get("room_code")
    if not code:
        return "", 404

    def generate():
        q = sse_subscribe(code)
        try:
            last_heartbeat = time.time()
            while True:
                try:
                    payload = q.get(timeout=5)
                except queue.Empty:
                    if time.time() - last_heartbeat > 25:
                        yield ": heartbeat\n\n"
                        last_heartbeat = time.time()
                    continue
                yield f"data: {payload}\n\n"
                last_heartbeat = time.time()
        finally:
            sse_unsubscribe(code, q)

    response = current_app.response_class(generate(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["X-Accel-Buffering"] = "no"
    response.headers["Connection"] = "keep-alive"
    return response


# ---------------------------------------------------------------------------
# Spielaktionen
# ---------------------------------------------------------------------------

@game_bp.route('/api/game/start', methods=['POST'])
@login_required
def start_game():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    if game.host_id != session["user_id"]:
        return jsonify({"error": "Nur der Host kann das Spiel starten."}), 403
    ok, msg = game.start_game()
    if not ok:
        return jsonify({"error": msg}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/roll', methods=['POST'])
@login_required
def roll_dice():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    err = _require_my_turn(game)
    if err:
        return err
    if not game.started:
        return jsonify({"error": "Das Spiel hat noch nicht gestartet."}), 400
    if game.pending_rent:
        return jsonify({"error": "Du musst zuerst die Miete bezahlen."}), 400
    if game.pending_tax:
        return jsonify({"error": "Du musst zuerst die Steuer bezahlen."}), 400
    if game.pending_card:
        return jsonify({"error": "Du musst zuerst die Karte bestaetigen."}), 400
    game.roll_dice()
    return jsonify(game.to_dict())


@game_bp.route('/api/game/buy', methods=['POST'])
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


@game_bp.route('/api/game/build', methods=['POST'])
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


@game_bp.route('/api/game/join', methods=['POST'])
@login_required
def join_game():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    color = data.get("color", "blue")
    valid = ["red", "green", "yellow", "blue", "purple", "orange",
             "pink", "teal", "lime", "white", "brown", "cyan"]
    if color not in valid:
        return jsonify({"error": "Ungueltige Farbe."}), 400
    if any(p.color == color and not p.is_disconnected for p in game.players):
        return jsonify({"error": f"Die Farbe '{color}' ist bereits vergeben."}), 409
    success = game.add_player(
        session["user_id"], session["username"], color,
        session.get("avatar_emoji", "🎲"),
        session.get("avatar_color", "#3b82f6"),
        session.get("avatar_url"),
        session.get("avatar_style", "diagonal"),
    )
    if not success:
        return jsonify({"error": "Beitreten fehlgeschlagen (max. 10 Spieler oder bereits drin)."}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/mortgage', methods=['POST'])
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


@game_bp.route('/api/room/kick', methods=['POST'])
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


@game_bp.route('/api/game/confirm_card', methods=['POST'])
@login_required
def confirm_card():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.confirm_card(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/use_jail_card', methods=['POST'])
@login_required
def use_jail_card():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.use_jail_card(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/buy_out_of_jail', methods=['POST'])
@login_required
def buy_out_of_jail():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.buy_out_of_jail(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/sell_building', methods=['POST'])
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


@game_bp.route('/api/game/end_turn', methods=['POST'])
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


@game_bp.route('/api/game/pay_rent', methods=['POST'])
@login_required
def pay_rent():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.confirm_rent_payment(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/offer_prop_for_rent', methods=['POST'])
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


@game_bp.route('/api/game/respond_rent_offer', methods=['POST'])
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


@game_bp.route('/api/game/pay_tax', methods=['POST'])
@login_required
def pay_tax():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.confirm_tax_payment(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


# ---------------------------------------------------------------------------
# Handel
# ---------------------------------------------------------------------------

@game_bp.route('/api/trade/send', methods=['POST'])
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
    my_jail_cards = parse_int_field(data.get("my_jail_cards", 0))
    their_jail_cards = parse_int_field(data.get("their_jail_cards", 0))
    result = game.send_trade(session["username"], to, my_props, my_money,
                             their_props, their_money, my_jail_cards, their_jail_cards)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/trade/respond', methods=['POST'])
@login_required
def trade_respond():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    action = data.get("action", "")
    if action not in ("accept", "reject", "counter"):
        return jsonify({"error": "Ungueltige Aktion"}), 400
    trade_id = data.get("trade_id", "")
    counter = None
    if action == "counter":
        counter = {
            "my_props": data.get("my_props", []),
            "my_money": parse_int_field(data.get("my_money", 0)),
            "their_props": data.get("their_props", []),
            "their_money": parse_int_field(data.get("their_money", 0)),
            "my_jail_cards": parse_int_field(data.get("my_jail_cards", 0)),
            "their_jail_cards": parse_int_field(data.get("their_jail_cards", 0)),
        }
    result = game.respond_trade(session["username"], trade_id, action, counter)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/trade/cancel', methods=['POST'])
@login_required
def trade_cancel():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    trade_id = data.get("trade_id", "")
    result = game.cancel_trade(session["username"], trade_id)
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@game_bp.route('/api/game/chat', methods=['POST'])
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
        "text": text,
    })
    if len(game.chat_messages) > 200:
        game.chat_messages = game.chat_messages[-200:]
    return jsonify(game.to_dict())


# ---------------------------------------------------------------------------
# Casino
# ---------------------------------------------------------------------------

@game_bp.route('/api/game/casino/start', methods=['POST'])
@login_required
def casino_start():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    data = request.get_json(silent=True) or {}
    game_type = data.get("game_type")
    bet = parse_int_field(data.get("bet", 0))
    if game_type == "blackjack":
        result = game.start_blackjack(session["username"], bet)
    elif game_type == "roulette":
        color = data.get("color", "")
        result = game.play_roulette(session["username"], bet, color)
    elif game_type == "double_or_nothing":
        result = game.start_double_or_nothing(session["username"], bet)
    else:
        return jsonify({"error": "Ungültiger Spieltyp"}), 400
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/casino/blackjack/hit', methods=['POST'])
@login_required
def casino_blackjack_hit():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.blackjack_hit(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/casino/blackjack/stand', methods=['POST'])
@login_required
def casino_blackjack_stand():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.blackjack_stand(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/casino/acknowledge', methods=['POST'])
@login_required
def casino_acknowledge():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.acknowledge_casino(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/casino/double_or_nothing/continue', methods=['POST'])
@login_required
def casino_double_continue():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.double_or_nothing_continue(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())


@game_bp.route('/api/game/casino/double_or_nothing/cashout', methods=['POST'])
@login_required
def casino_double_cashout():
    game, _ = get_current_game()
    if not game:
        return jsonify({"error": "Kein Raum"}), 400
    result = game.double_or_nothing_cashout(session["username"])
    if not result.get("success"):
        return jsonify({"error": result.get("error", "Fehler")}), 400
    return jsonify(game.to_dict())