import pytest

from game_logic import Game, Field, Player, normalize_settings, DEFAULT_SETTINGS


def make_game():
    game = Game()
    assert game.add_player("u1", "Alice", "blue")
    assert game.add_player("u2", "Bob", "red")
    return game


def test_normalize_settings_uses_defaults_for_invalid_input():
    assert normalize_settings(None) == DEFAULT_SETTINGS
    result = normalize_settings({
        "start_money": "not-a-number",
        "turn_timeout": 9999,
        "cost_multiplier": float("inf"),
        "unknown_setting": "ignored",
    })
    assert result["start_money"] == DEFAULT_SETTINGS["start_money"]
    assert result["turn_timeout"] == 300
    assert result["cost_multiplier"] == DEFAULT_SETTINGS["cost_multiplier"]
    assert "unknown_setting" not in result


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ({"start_money": -10}, 0),
        ({"start_money": 10**12}, 100_000_000),
        ({"timeout_penalty": -1}, 0),
        ({"turn_timeout": 1}, 5),
    ],
)
def test_normalize_settings_clamps_numeric_values(raw, expected):
    key, = raw.keys()
    assert normalize_settings(raw)[key] == expected


def test_add_player_prevents_duplicate_user():
    game = Game()
    assert game.add_player("u1", "Alice", "blue") is True
    assert game.add_player("u1", "Alice", "red") is False
    assert len(game.players) == 1


def test_add_player_uses_configured_start_money():
    game = Game({"start_money": 2300})
    assert game.add_player("u1", "Alice", "blue")
    assert game.players[0].money == 2300


def test_start_game_requires_two_active_players():
    game = Game()
    game.add_player("u1", "Alice", "blue")
    started, message = game.start_game()
    assert started is False
    assert "2 Spieler" in message


def test_start_game_succeeds_with_two_players():
    game = make_game()
    started, _ = game.start_game()
    assert started is True
    assert game.started is True


def test_field_rent_doubles_when_owner_has_complete_color_group():
    owner = Player("u1", "Alice", "blue")

    first = Field("A", "property", 60, [2, 10], "brown")
    second = Field("B", "property", 60, [4, 20], "brown")

    first.owner = owner
    second.owner = owner

    board = [first, second]

    assert first.get_rent(board, owner) == 4


def test_field_rent_is_zero_when_mortgaged():
    owner = Player("u1", "Alice", "blue")
    field = Field("A", "property", 60, [2], "brown")
    field.owner = owner
    field.is_mortgaged = True
    assert field.get_rent([field], owner) == 0


def test_station_rent_scales_with_number_owned():
    owner = Player("u1", "Alice", "blue")
    stations = [
        Field("S1", "station", 200, [25], "station"),
        Field("S2", "station", 200, [25], "station"),
        Field("S3", "station", 200, [25], "station"),
    ]
    stations[0].owner = owner
    stations[1].owner = owner
    assert stations[0].get_rent(stations, owner) == 50


def test_buy_property_deducts_money_and_assigns_owner():
    game = make_game()
    player = game.players[0]
    field = game.board[1]  # Schmiedestraße, 60 €
    player.position = 1
    before = player.money

    assert game.buy_property() is True
    assert player.money == before - 60
    assert field.owner is player
    assert field in player.properties


def test_buy_property_fails_if_not_enough_money():
    game = make_game()
    player = game.players[0]
    field = game.board[1]
    player.position = 1
    player.money = 10

    assert game.buy_property() is False
    assert field.owner is None
    assert field not in player.properties


def test_build_requires_complete_color_group():
    game = make_game()
    player = game.players[0]
    field = game.board[1]
    field.owner = player
    player.properties.append(field)
    game.turn_phase = "action"

    result = game.build(field.name, "house")
    assert result["success"] is False
    assert field.houses == 0


def test_build_house_with_complete_group_deducts_cost():
    game = make_game()
    player = game.players[0]
    first, second = game.board[1], game.board[3]
    for field in (first, second):
        field.owner = player
        player.properties.append(field)
    game.turn_phase = "action"
    before = player.money

    result = game.build(first.name, "house")
    assert result["success"] is True
    assert first.houses == 1
    assert player.money == before - first.house_cost


def test_build_enforces_even_building():
    game = make_game()
    player = game.players[0]
    first, second = game.board[1], game.board[3]
    for field in (first, second):
        field.owner = player
        player.properties.append(field)
    first.houses = 1
    game.turn_phase = "action"

    result = game.build(first.name, "house")
    assert result["success"] is False
    assert first.houses == 1
    assert second.houses == 0


def test_mortgage_and_unmortgage_update_money_and_state():
    game = make_game()
    player = game.players[0]
    field = game.board[1]
    field.owner = player
    player.properties.append(field)
    before = player.money

    result = game.take_mortgage(field.name, player.username)
    assert result["success"] is True
    assert field.is_mortgaged is True
    assert player.money == before + 30

    result = game.lift_mortgage(field.name, player.username)
    assert result["success"] is True
    assert field.is_mortgaged is False
    assert player.money == before - 3  # 30 € mortgage, 33 € repayment


def test_mortgage_rejects_property_with_buildings():
    game = make_game()
    player = game.players[0]
    field = game.board[1]
    field.owner = player
    field.houses = 1
    player.properties.append(field)

    result = game.take_mortgage(field.name, player.username)
    assert result["success"] is False
    assert field.is_mortgaged is False


def test_storage_roundtrip_preserves_players_and_properties():
    game = make_game()
    player = game.players[0]
    field = game.board[1]
    field.owner = player
    field.houses = 2
    field.is_mortgaged = False
    player.properties.append(field)
    player.money = 1234
    player.position = 7
    game.started = True
    game.turn_phase = "action"

    restored = Game.from_storage_dict(game.to_storage_dict())
    restored_player = restored.players[0]
    restored_field = next(f for f in restored.board if f.name == field.name)

    assert restored.started is True
    assert restored_player.money == 1234
    assert restored_player.position == 7
    assert restored_field.owner.user_id == player.user_id
    assert restored_field.houses == 2


@pytest.mark.parametrize("money", [0, -1, -50, -100])
def test_player_with_no_assets_goes_bankrupt(money):
    """Spieler ohne Vermögen müssen bei 0 oder negativem Kontostand ausscheiden."""
    game = Game()

    player = Player("u1", "Alice", "blue")
    opponent = Player("u2", "Bob", "red")

    player.money = money
    opponent.money = 1500

    game.players = [player, opponent]

    game._check_bankruptcy(player)

    assert player.is_bankrupt is True
    assert player.properties == []

    # Der verbleibende Spieler muss als Gewinner erkannt werden.
    assert game.last_event["type"] == "winner"
    assert game.last_event["player"] == "Bob"


def test_player_with_positive_assets_is_not_bankrupt_at_zero_cash():
    """0 € Bargeld bedeutet nicht automatisch Bankrott, wenn noch Vermögen besteht."""
    game = Game()

    player = Player("u1", "Alice", "blue")
    opponent = Player("u2", "Bob", "red")

    player.money = 0
    opponent.money = 1500

    # Spieler hat ein Grundstück (Asset)
    field = Field("Schmiedestraße", "property", 60, [2, 10], "brown")
    field.owner = player
    player.properties.append(field)

    game.players = [player, opponent]

    game._check_bankruptcy(player)

    assert player.is_bankrupt is False


@pytest.mark.parametrize("money", [-1, -50, -100])
def test_player_with_assets_goes_bankrupt_when_cash_below_zero(money):
    """Spieler mit Vermögen scheiden sofort aus, wenn das Konto unter 0 fährt."""
    game = Game()

    player = Player("u1", "Alice", "blue")
    opponent = Player("u2", "Bob", "red")

    player.money = money
    opponent.money = 1500

    # Spieler hat ein Grundstück (Asset), aber der Kontostand ist unter 0
    field = Field("Schmiedestraße", "property", 60, [2, 10], "brown")
    field.owner = player
    player.properties.append(field)

    game.players = [player, opponent]

    game._check_bankruptcy(player)

    assert player.is_bankrupt is True
    assert player.properties == []


def test_bankrupt_player_cannot_be_declared_bankrupt_twice():
    """Eine bereits bankrotte Person darf nicht erneut verarbeitet werden."""
    game = Game()

    player = Player("u1", "Alice", "blue")
    opponent = Player("u2", "Bob", "red")

    player.money = 0
    game.players = [player, opponent]

    game._check_bankruptcy(player)
    first_event = game.last_event.copy()

    game._check_bankruptcy(player)

    assert player.is_bankrupt is True
    assert game.last_event == first_event