import json
from unittest.mock import patch
import pytest

# Datenbank-Initialisierung beim Import von app verhindern
with patch("database.create_database"):
    from app import app
    from game_logic import Game, active_games


@pytest.fixture(autouse=True)
def reset_state():
    """Bereinigt aktive Spiele und konfiguriert den Test-Client vor jedem Test."""
    active_games.clear()
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret-key"
    yield
    active_games.clear()


@pytest.fixture
def client():
    with app.test_client() as c:
        yield c


def _login_session(client, user_id="user-1", username="Alice", is_guest=False, room_code=None):
    with client.session_transaction() as sess:
        sess["user_id"] = user_id
        sess["username"] = username
        sess["is_guest"] = is_guest
        if room_code:
            sess["room_code"] = room_code


# ---------------------------------------------------------------------------
# 1. Auth, Gastmodus & Profil-Validierung
# ---------------------------------------------------------------------------

def test_redirect_to_login_when_unauthenticated(client):
    res = client.get("/")
    assert res.status_code == 302
    assert "/login" in res.headers["Location"]


def test_start_guest_session(client):
    res = client.post("/api/v1/guest")
    assert res.status_code == 200
    assert res.get_json()["message"] == "Gastmodus gestartet"

    with client.session_transaction() as sess:
        assert sess["is_guest"] is True
        assert sess["user_id"].startswith("guest:")


@patch("app.is_display_name_available", return_value=True)
@patch("app.supabase_client.is_configured", return_value=True)
@patch("app.supabase_client.register_auth_user", return_value="uuid-123")
@patch("app.create_user", return_value=True)
def test_register_success_and_validation(mock_create, mock_reg, mock_cfg, mock_avail, client):
    # Zu kurzer Name
    res_short = client.post("/api/v1/register", json={
        "username": "ab", "password": "secretpassword", "email": "a@example.com"
    })
    assert res_short.status_code == 400

    # Verbotenes Wort im Namen
    res_banned = client.post("/api/v1/register", json={
        "username": "SuperIdiot99", "password": "secretpassword", "email": "a@example.com"
    })
    assert res_banned.status_code == 400

    # Erfolgreiche Registrierung
    res_ok = client.post("/api/v1/register", json={
        "username": "SpielerEins", "password": "secretpassword", "email": "a@example.com"
    })
    assert res_ok.status_code == 201
    assert res_ok.get_json()["verification_required"] is True
    with client.session_transaction() as sess:
        assert sess["verification_email"] == "a@example.com"


@patch("app.update_user_display_name", return_value=True)
@patch("app.is_display_name_available", return_value=True)
def test_cannot_change_username_while_in_room(mock_avail, mock_update, client):
    _login_session(client, user_id="u1", username="Alice", room_code="ROOM01")
    res = client.post("/api/user/profile", json={"username": "NewAlice"})
    assert res.status_code == 409
    assert "Spielraum" in res.get_json()["error"]


# ---------------------------------------------------------------------------
# 2. Raum-Lobby, Einstellungen & Berechtigungen
# ---------------------------------------------------------------------------

@patch("game.update_user_room")
@patch("game.get_game_state", return_value=None)
@patch("game.persist_game")
def test_create_and_join_room(mock_persist, mock_get_state, mock_update_room, client):
    _login_session(client, user_id="host-1", username="HostUser")

    # Raum erstellen
    res = client.post("/api/room/create", json={"start_money": 2000})
    assert res.status_code == 201
    data = res.get_json()
    code = data["code"]
    assert len(code) == 6
    assert data["is_host"] is True
    assert data["settings"]["start_money"] == 2000
    assert code in active_games

    # Zweiter Spieler tritt Raum bei
    with app.test_client() as client2:
        _login_session(client2, user_id="guest-2", username="Bob", is_guest=True)
        res_bad = client2.post("/api/room/join", json={"code": "123"})
        assert res_bad.status_code == 400

        res_404 = client2.post("/api/room/join", json={"code": "XXXXXX"})
        assert res_404.status_code == 404

        res_join = client2.post("/api/room/join", json={"code": code.lower()})
        assert res_join.status_code == 200
        assert res_join.get_json()["code"] == code


@patch("game.persist_game")
@patch("game.sse_push")
def test_only_host_can_change_settings_and_start_game(mock_sse, mock_persist, client):
    game = Game()
    game.host_id = "host-1"
    game.host_username = "Alice"
    game.add_player("host-1", "Alice", "blue")
    game.add_player("p-2", "Bob", "red")
    active_games["ABCD12"] = game

    # Nicht-Host versucht Einstellungen zu ändern
    _login_session(client, user_id="p-2", username="Bob", room_code="ABCD12")
    res_settings = client.post("/api/room/settings", json={"start_money": 5000})
    assert res_settings.status_code == 403

    # Nicht-Host versucht Spiel zu starten
    res_start = client.post("/api/game/start")
    assert res_start.status_code == 403

    # Host startet Spiel
    _login_session(client, user_id="host-1", username="Alice", room_code="ABCD12")
    res_ok = client.post("/api/game/start")
    assert res_ok.status_code == 200
    assert active_games["ABCD12"].started is True
    assert mock_persist.called
    assert mock_sse.called


# ---------------------------------------------------------------------------
# 3. Spielzug-Guardrails & API-Aktionen
# ---------------------------------------------------------------------------

@patch("game.persist_game")
@patch("game.sse_push")
def test_roll_dice_turn_and_pending_guards(mock_sse, mock_persist, client):
    game = Game()
    game.host_id = "p-1"
    game.add_player("p-1", "Alice", "blue")
    game.add_player("p-2", "Bob", "red")
    game.start_game()
    active_games["GAME01"] = game

    # Bob ist nicht am Zug
    _login_session(client, user_id="p-2", username="Bob", room_code="GAME01")
    res_wrong_turn = client.post("/api/game/roll")
    assert res_wrong_turn.status_code == 403

    # Alice ist am Zug, hat aber noch offene Steuer
    _login_session(client, user_id="p-1", username="Alice", room_code="GAME01")
    game.pending_tax = {"payer": "Alice", "amount": 200, "field_name": "Einkommensteuer"}
    res_tax_block = client.post("/api/game/roll")
    assert res_tax_block.status_code == 400
    assert "Steuer" in res_tax_block.get_json()["error"]

    # Steuer bezahlen, danach darf gewürfelt werden
    res_pay = client.post("/api/game/pay_tax")
    assert res_pay.status_code == 200
    assert game.pending_tax is None

    res_roll = client.post("/api/game/roll")
    assert res_roll.status_code == 200
    assert res_roll.get_json()["dice"] is not None


@patch("game.persist_game")
@patch("game.sse_push")
def test_join_game_duplicate_color_rejected(mock_sse, mock_persist, client):
    game = Game()
    game.add_player("p-1", "Alice", "blue")
    active_games["COLR01"] = game

    _login_session(client, user_id="p-2", username="Bob", room_code="COLR01")
    res = client.post("/api/game/join", json={"color": "blue"})
    assert res.status_code == 409
    assert "vergeben" in res.get_json()["error"]


def test_game_state_etag_returns_304(client):
    game = Game()
    game.add_player("p-1", "Alice", "blue")
    active_games["ETAG01"] = game

    _login_session(client, user_id="p-1", username="Alice", room_code="ETAG01")
    res1 = client.get("/api/game/state")
    assert res1.status_code == 200
    etag = res1.headers.get("ETag")
    assert etag is not None

    res2 = client.get("/api/game/state", headers={"If-None-Match": etag})
    assert res2.status_code == 304


# ---------------------------------------------------------------------------
# 4. Freunde & Einladungen
# ---------------------------------------------------------------------------

@patch("app.get_user_by_id")
def test_friend_request_blocked_by_privacy_setting(mock_get_user, client):
    _login_session(client, user_id="u-1", username="Alice")
    # Index 15 ist allow_friend_requests = False
    target_user = ["u-2", "Bob"] + [None] * 13 + [False]
    mock_get_user.return_value = tuple(target_user)

    res = client.post("/api/friends/request", json={"friend_id": "u-2"})
    assert res.status_code == 403
    assert "keine Freundschaftsanfragen" in res.get_json()["error"]


@patch("app.update_user_room")
@patch("app.dismiss_friend_invite")
@patch("app.get_friend_invites")
def test_accept_friend_invite_sets_room_code(mock_get_invites, mock_dismiss, mock_update_room, client):
    _login_session(client, user_id="u-2", username="Bob")
    mock_get_invites.return_value = [{"id": 42, "room_code": "INV123", "from_username": "Alice"}]

    res = client.post("/api/friends/invite/respond", json={"invite_id": 42, "accept": True})
    assert res.status_code == 200
    assert res.get_json()["room_code"] == "INV123"
    mock_dismiss.assert_called_once_with(42)
    mock_update_room.assert_called_once_with("u-2", "INV123")
    with client.session_transaction() as sess:
        assert sess["room_code"] == "INV123"