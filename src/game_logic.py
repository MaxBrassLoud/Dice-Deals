import random
import time
from dataclasses import dataclass, field
from typing import Optional, List

GROUP_ORDER = ["brown","lightblue","pink","orange","red","yellow","green","darkblue","station","utility"]
TURN_TIMEOUT_SECONDS = 20

CHANCE_CARDS = [
    {"text": "Gehe zu Los. Erhalte 200 €.", "action": "goto", "value": 0},
    {"text": "Bankfehler zu deinen Gunsten. Erhalte 200 €.", "action": "money", "value": 200},
    {"text": "Strafe erhalten. Zahle 100 €.", "action": "money", "value": -100},
    {"text": "Gehe ins Gefängnis.", "action": "jail", "value": 10},
    {"text": "Gehe zur nächsten Station.", "action": "next_station", "value": 0},
    {"text": "2. Preis im Schönheitswettbewerb. Erhalte 10 €.", "action": "money", "value": 10},
    {"text": "Schulden fällig. Zahle 50 €.", "action": "money", "value": -50},
    {"text": "Kurreise. Zahle 100 €.", "action": "money", "value": -100},
    {"text": "Frei aus dem Gefängnis!", "action": "jail_card", "value": 0},
    {"text": "Rücke 3 Felder zurück.", "action": "move", "value": -3},
]

COMMUNITY_CARDS = [
    {"text": "Du erbst 100 €.", "action": "money", "value": 100},
    {"text": "Arztkosten. Zahle 50 €.", "action": "money", "value": -50},
    {"text": "Steuerrückerstattung: 20 €.", "action": "money", "value": 20},
    {"text": "Gehe zu Los. Erhalte 200 €.", "action": "goto", "value": 0},
    {"text": "Versicherungsfälligkeit. Zahle 50 €.", "action": "money", "value": -50},
    {"text": "Gewinn! Erhalte 10 €.", "action": "money", "value": 10},
    {"text": "Bankirrtum. Erhalte 200 €.", "action": "money", "value": 200},
    {"text": "Gehe ins Gefängnis.", "action": "jail", "value": 10},
]


class Player:
    def __init__(self, user_id: str, username: str, color: str, avatar_emoji: str = "🎲", avatar_color: str = "#3b82f6", avatar_url: str = ""):
        self.user_id = user_id
        self.username = username
        self.color = color
        self.avatar_emoji = avatar_emoji
        self.avatar_color = avatar_color
        self.avatar_url = avatar_url or ""
        self.money = 1500
        self.position = 0
        self.properties: List["Field"] = []
        self.in_jail = False
        self.jail_turns = 0
        self.get_out_of_jail_cards = 0
        self.is_bankrupt = False
        self.is_disconnected = False

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "color": self.color,
            "avatar_emoji": self.avatar_emoji,
            "avatar_color": self.avatar_color,
            "avatar_url": self.avatar_url,
            "money": self.money,
            "position": self.position,
            "properties": [p.name for p in self.properties],
            "in_jail": self.in_jail,
            "is_bankrupt": self.is_bankrupt,
            "get_out_of_jail_cards": self.get_out_of_jail_cards,
            "is_disconnected": self.is_disconnected,
        }


class Field:
    def __init__(self, name, field_type, price=0, rent=None, color_group="special", mortgage_value=0, house_cost=0):
        self.name = name
        self.field_type = field_type
        self.price = price
        self.rent = rent or [0]
        self.color_group = color_group
        self.mortgage_value = mortgage_value
        self.house_cost = house_cost
        self.owner: Optional[Player] = None
        self.houses = 0
        self.is_mortgaged = False

    def get_rent(self, board: list, owner: "Player") -> int:
        if self.is_mortgaged or self.owner is None:
            return 0
        if self.field_type == "station":
            owned = sum(1 for f in board if f.field_type == "station" and f.owner == owner)
            return 25 * (2 ** (owned - 1))
        if self.field_type == "utility":
            return None
        if self.houses == 0:
            group_fields = [f for f in board if f.color_group == self.color_group and f.field_type == "property"]
            if all(f.owner == owner for f in group_fields):
                return self.rent[0] * 2
            return self.rent[0]
        return self.rent[min(self.houses, len(self.rent) - 1)]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "field_type": self.field_type,
            "price": self.price,
            "color_group": self.color_group,
            "owner": self.owner.username if self.owner else None,
            "owner_color": self.owner.color if self.owner else None,
            "houses": self.houses,
            "is_mortgaged": self.is_mortgaged,
            "mortgage_value": self.mortgage_value,
            "house_cost": self.house_cost,
            "current_rent": self.rent[self.houses] if self.field_type == "property" and self.rent else 0,
        }


def _create_board() -> List[Field]:
    hp = {"brown": 50, "lightblue": 50, "pink": 100, "orange": 100, "red": 150, "yellow": 150, "green": 200, "darkblue": 200}
    return [
        Field("Los", "special"),
        Field("Schmiedestraße", "property", 60, [2,10,30,90,160,250], "brown", 30, hp["brown"]),
        Field("Gemeinschaft", "community"),
        Field("Töpfergasse", "property", 60, [4,20,60,180,320,450], "brown", 30, hp["brown"]),
        Field("Einkommensteuer", "tax", 0, [200]),
        Field("Südbahnhof", "station", 200, [25,50,100,200], "station", 100),
        Field("Birkenallee", "property", 100, [6,30,90,270,400,550], "lightblue", 50, hp["lightblue"]),
        Field("Chance", "chance"),
        Field("Ahornweg", "property", 100, [6,30,90,270,400,550], "lightblue", 50, hp["lightblue"]),
        Field("Seeblickweg", "property", 120, [8,40,100,300,450,600], "lightblue", 60, hp["lightblue"]),
        Field("Gefängnis / Besuch", "special"),
        Field("Viktoriastraße", "property", 140, [10,50,150,450,625,750], "pink", 70, hp["pink"]),
        Field("Elektrizitätswerk", "utility", 150, [0], "utility", 75),
        Field("Christian Straße", "property", 140, [10,50,150,450,625,750], "pink", 70, hp["pink"]),
        Field("Brunnenring", "property", 160, [12,60,180,500,700,900], "pink", 80, hp["pink"]),
        Field("Westbahnhof", "station", 200, [25,50,100,200], "station", 100),
        Field("Handelsallee", "property", 180, [14,70,200,550,750,950], "orange", 90, hp["orange"]),
        Field("Gemeinschaft", "community"),
        Field("Industrieplatz", "property", 180, [14,70,200,550,750,950], "orange", 90, hp["orange"]),
        Field("Skyline Avenue", "property", 200, [16,80,220,600,800,1000], "orange", 100, hp["orange"]),
        Field("Frei Parken", "special"),
        Field("Rubinweg", "property", 220, [18,90,250,700,875,1050], "red", 110, hp["red"]),
        Field("Chance", "chance"),
        Field("Kronenweg", "property", 220, [18,90,250,700,875,1050], "red", 110, hp["red"]),
        Field("Kaiserpromenade", "property", 240, [20,100,300,750,925,1100], "red", 120, hp["red"]),
        Field("Nordbahnhof", "station", 200, [25,50,100,200], "station", 100),
        Field("Celestia Park", "property", 260, [22,110,330,800,975,1150], "yellow", 130, hp["yellow"]),
        Field("Opal Gardens", "property", 260, [22,110,330,800,975,1150], "yellow", 130, hp["yellow"]),
        Field("Wasserwerk", "utility", 150, [0], "utility", 75),
        Field("Panorama Gardens", "property", 280, [24,120,360,850,1025,1200], "yellow", 140, hp["yellow"]),
        Field("Gehe ins Gefängnis", "special"),
        Field("Eden Heights", "property", 300, [26,130,390,900,1100,1275], "green", 150, hp["green"]),
        Field("Maximilian Straße", "property", 300, [26,130,390,900,1100,1275], "green", 150, hp["green"]),
        Field("Gemeinschaft", "community"),
        Field("Eternity Gardens", "property", 320, [28,150,450,1000,1200,1400], "green", 160, hp["green"]),
        Field("Hauptbahnhof", "station", 200, [25,50,100,200], "station", 100),
        Field("Chance", "chance"),
        Field("Royal Boulevard", "property", 350, [35,175,500,1100,1300,1500], "darkblue", 175, hp["darkblue"]),
        Field("Zusatzsteuer", "tax", 0, [100]),
        Field("Bernsteinallee", "property", 400, [50,200,600,1400,1700,2000], "darkblue", 200, hp["darkblue"]),
    ]


class Game:
    def __init__(self):
        self.players: List[Player] = []
        self.current_player_index = 0
        self.board = _create_board()
        self.dice_result: Optional[tuple] = None
        self.status_message = "Warte auf Spieler…"
        self.can_buy = False
        self.double_roll_count = 0
        self.chance_deck = CHANCE_CARDS.copy()
        self.community_deck = COMMUNITY_CARDS.copy()
        random.shuffle(self.chance_deck)
        random.shuffle(self.community_deck)
        self.turn_phase = "roll"
        self.last_event = None
        self.last_move: Optional[dict] = None
        self.turn_started_at = time.time()
        self.movement_this_turn = False


        self.pending_rent: Optional[dict] = None
        self.incoming_rent_offer: Optional[dict] = None


        self.pending_tax: Optional[dict] = None


        self.active_trade: Optional[dict] = None


        self.free_parking_pot: int = 0


        self.pending_card: Optional[dict] = None


        self.chat_messages: List[dict] = []


        self.host_id: str = ""
        self.host_username: str = ""



    def add_player(self, user_id, username, color, avatar_emoji="🎲", avatar_color="#3b82f6", avatar_url="") -> bool:
        existing = next((p for p in self.players if p.user_id == user_id), None)
        if existing and existing.is_disconnected:
            existing.is_disconnected = False
            existing.is_bankrupt = False
            existing.color = color
            existing.avatar_emoji = avatar_emoji
            existing.avatar_color = avatar_color
            existing.avatar_url = avatar_url or ""
            self.status_message = f"{username} ist zurückgekehrt!"
            self._sys_chat(f"{username} ist dem Spiel wieder beigetreten! 🎉")
            return True
        if len(self.players) >= 6:
            return False
        if any(p.user_id == user_id for p in self.players):
            return False

        self.players.append(Player(user_id, username, color, avatar_emoji, avatar_color, avatar_url))
        if len(self.players) <= 2:
            self._reset_turn_timer()
        self.status_message = f"{username} ist dem Spiel beigetreten!"
        self._sys_chat(f"{username} ist dem Spiel beigetreten! 🎉")
        return True

    def _sys_chat(self, text: str):
        self.chat_messages.append({"type": "system", "text": text})
        if len(self.chat_messages) > 200:
            self.chat_messages = self.chat_messages[-200:]



    def roll_dice(self):
        if self.turn_phase != "roll":
            return
        d1, d2 = random.randint(1, 6), random.randint(1, 6)
        self.dice_result = (d1, d2)
        player = self.players[self.current_player_index]
        is_double = d1 == d2
        if player.in_jail:
            self._handle_jail_roll(player, d1, d2, is_double)
            return
        if is_double:
            self.double_roll_count += 1
            if self.double_roll_count >= 3:
                self._send_to_jail(player)
                self.double_roll_count = 0
                self.turn_phase = "end"
                return
        else:
            self.double_roll_count = 0
        self._move_player(player, d1 + d2)
        if is_double and self.can_buy:
            self.status_message += " Du kannst kaufen oder erneut würfeln."
        self.turn_phase = "action" if not is_double else "roll"

    def _handle_jail_roll(self, player, d1, d2, is_double):
        if is_double:
            player.in_jail = False
            player.jail_turns = 0
            self.status_message = f"{player.username} würfelt Pasch und kommt frei!"
            self._move_player(player, d1 + d2)
            self.turn_phase = "action"
        else:
            player.jail_turns += 1
            if player.jail_turns >= 3:
                player.money -= 50
                player.in_jail = False
                player.jail_turns = 0
                self.status_message = f"{player.username} zahlt 50 € Kaution."
                self._move_player(player, d1 + d2)
                self.turn_phase = "action"
            else:
                self.status_message = f"{player.username} bleibt im Gefängnis (Runde {player.jail_turns}/3)"
                self.turn_phase = "end"

    def _move_player(self, player, steps):
        self.movement_this_turn = True
        old_pos = player.position
        player.position = (player.position + steps) % 40

        self.last_move = {
            "player": player.username,
            "from": old_pos,
            "to": player.position,
            "steps": steps,
            "passed_go": player.position < old_pos and steps > 0
        }
        if player.position < old_pos and steps > 0:
            player.money += 200
            self.status_message = f"{player.username} überquert Los und erhält 200 €!"
        self._handle_field(player)

    def _handle_field(self, player):
        field = self.board[player.position]
        d1, d2 = self.dice_result or (0, 0)
        self.can_buy = False
        self.last_event = None

        if player.position == 30:
            self._send_to_jail(player)
            return

        if field.field_type == "tax":
            amount = field.rent[0]
            self.pending_tax = {
                "payer": player.username,
                "amount": amount,
                "field_name": field.name,
            }
            self.status_message = f"{player.username} muss {amount} € Steuer zahlen. ({field.name})"
            self.last_event = {"type": "tax", "amount": amount}
            self._sys_chat(f"🏛️ {player.username} muss {amount} € Steuer zahlen")
            return

        if field.field_type == "chance":
            card = self.chance_deck.pop(0)
            self.chance_deck.append(card)
            self._apply_card(player, card)
            return

        if field.field_type == "community":
            card = self.community_deck.pop(0)
            self.community_deck.append(card)
            self._apply_card(player, card)
            return

        if player.position == 20:
            pot = self.free_parking_pot
            if pot > 0:
                player.money += pot
                self.free_parking_pot = 0
                self.status_message = f"{player.username} landet auf Frei Parken und erhält {pot} € aus dem Topf!"
                self.last_event = {"type": "free_parking", "amount": pot}
                self._sys_chat(f"🅿️ {player.username} räumt den Topf ab: {pot} €!")
            else:
                self.status_message = f"{player.username} landet auf Frei Parken. (Topf ist leer)"
            return

        if field.field_type in ("property", "station", "utility"):
            if field.owner is None and field.price > 0:
                self.status_message = f"{player.username} landet auf {field.name}. Kaufpreis: {field.price} €."
                self.can_buy = player.money >= field.price
                self.last_event = {"type": "land_empty", "field": field.name, "price": field.price}

            elif field.owner and field.owner != player and not field.is_mortgaged:
                if field.field_type == "utility":
                    owned = sum(1 for f in self.board if f.field_type == "utility" and f.owner == field.owner)
                    rent = (d1 + d2) * (10 if owned == 2 else 4)
                else:
                    rent = field.get_rent(self.board, field.owner)


                rent = min(rent, player.money + sum(f.price for f in player.properties))
                self.pending_rent = {
                    "payer": player.username,
                    "creditor": field.owner.username,
                    "creditor_id": field.owner.user_id,
                    "amount": rent,
                    "field_name": field.name,
                    "field_color": field.color_group,
                }
                self.status_message = f"{player.username} schuldet {rent} € Miete an {field.owner.username} ({field.name})."
                self.last_event = {"type": "rent", "amount": rent, "to": field.owner.username}
                self._sys_chat(f"💸 {player.username} schuldet {rent} € Miete an {field.owner.username}")
            else:
                self.status_message = f"{player.username} landet auf {field.name}." + (" (Eigenes Grundstück)" if field.owner == player else "")
        else:
            self.status_message = f"{player.username} landet auf {field.name}."

    def _apply_card(self, player: "Player", card: dict):
        self.last_event = {"type": "card", "text": card["text"]}
        self.status_message = f"{player.username} zieht eine Karte…"
        field = self.board[player.position]
        card_type = "community" if field.field_type == "community" else "chance"
        self.pending_card = {
            "player": player.username,
            "card_type": card_type,
            "text": card["text"],
            "action": card["action"],
            "value": card["value"],
        }

    def confirm_card(self, username: str) -> dict:
        if not self.pending_card:
            return {"success": False, "error": "Keine Karte ausstehend."}
        if self.pending_card["player"] != username:
            return {"success": False, "error": "Nicht deine Karte."}
        card = self.pending_card
        self.pending_card = None
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        self._execute_card(player, card)
        return {"success": True}

    def _execute_card(self, player: "Player", card: dict):
        action = card["action"]
        value  = card["value"]
        if action in ("goto", "jail", "move", "next_station"):
            self.movement_this_turn = True
        self.status_message = f"Karte: {card['text']}"
        if action == "money":
            player.money += value
            if value < 0:
                self.free_parking_pot += abs(value)
                self._check_bankruptcy(player)
        elif action == "goto":
            old = player.position
            player.position = value
            if old > value:
                player.money += 200
            self._handle_field(player)
        elif action == "jail":
            self._send_to_jail(player)
        elif action == "jail_card":
            player.get_out_of_jail_cards += 1
            self._sys_chat(f"🃏 {player.username} erhält eine Gefängnisfreikarte!")
        elif action == "move":
            player.position = max(0, player.position + value)
            self._handle_field(player)
        elif action == "next_station":
            stations = [5, 15, 25, 35]
            pos = player.position
            nxt = next((s for s in stations if s > pos), stations[0])
            if nxt < pos:
                player.money += 200
            player.position = nxt
            self._handle_field(player)

    def _send_to_jail(self, player):
        player.position = 10
        player.in_jail = True
        player.jail_turns = 0
        self.double_roll_count = 0
        self.status_message = f"{player.username} geht ins Gefängnis!"
        self.last_event = {"type": "jail"}
        self._sys_chat(f"⛓️ {player.username} wurde ins Gefängnis geschickt!")

    def _total_asset_value(self, player: "Player") -> int:
        total = player.money
        for prop in player.properties:
            if not prop.is_mortgaged:
                total += prop.price // 2
            if prop.houses == 5:
                total += prop.house_cost
            else:
                total += prop.houses * prop.house_cost
        return total

    def _check_bankruptcy(self, player: "Player"):
        self._check_true_bankruptcy(player)

    def _check_true_bankruptcy(self, player: "Player"):
        if player.is_bankrupt:
            return
        if self._total_asset_value(player) <= 0:
            self._declare_bankrupt(player)

    def _declare_bankrupt(self, player: "Player"):
        player.is_bankrupt = True
        for prop in player.properties:
            prop.owner = None
            prop.houses = 0
            prop.is_mortgaged = False
        player.properties = []
        self.status_message = f"💀 {player.username} ist bankrott!"
        self.last_event = {"type": "bankrupt", "player": player.username}
        self._sys_chat(f"💀 {player.username} ist bankrott! Alle Grundstücke zurück an die Bank.")
        self._check_winner()

    def _check_winner(self):
        active = [p for p in self.players if not p.is_bankrupt and not p.is_disconnected]
        if len(active) == 1:
            winner = active[0]
            self.status_message = f"🏆 {winner.username} hat gewonnen!"
            self.last_event = {"type": "winner", "player": winner.username,
                               "money": winner.money,
                               "assets": self._total_asset_value(winner)}
            self._sys_chat(f"🏆🏆🏆 {winner.username} hat das Spiel gewonnen! 🏆🏆🏆")
        elif len(active) == 0:
            self.status_message = "Kein Gewinner — alle ausgeschieden."
            self.last_event = {"type": "draw"}

    def buy_property(self) -> bool:
        player = self.players[self.current_player_index]
        field = self.board[player.position]
        if (field.field_type not in ("property", "station", "utility")
                or field.owner is not None
                or player.money < field.price
                or field.price == 0):
            return False
        player.money -= field.price
        field.owner = player
        player.properties.append(field)
        self.can_buy = False
        self.status_message = f"{player.username} kauft {field.name} für {field.price} €."
        self._sys_chat(f"🏠 {player.username} kauft {field.name} für {field.price} €")
        return True

    def build(self, property_name, build_type) -> dict:
        player = self.players[self.current_player_index]
        if self.turn_phase not in ("action", "roll"):
            return {"success": False, "error": "Bauen nicht möglich."}
        field = next((f for f in self.board if f.name == property_name), None)
        if not field or field not in player.properties:
            return {"success": False, "error": "Diese Straße gehört dir nicht."}
        if field.field_type != "property":
            return {"success": False, "error": "Nur Straßen können bebaut werden."}
        group = [f for f in self.board if f.color_group == field.color_group and f.field_type == "property"]
        if not all(f.owner == player for f in group):
            return {"success": False, "error": "Du besitzt nicht alle Straßen dieser Farbe."}
        if any(f.is_mortgaged for f in group):
            return {"success": False, "error": "Keine Straße darf verpfändet sein."}
        if build_type == "house":
            if field.houses >= 4:
                return {"success": False, "error": "Maximal 4 Häuser möglich."}
            min_h = min(f.houses for f in group)
            if field.houses > min_h:
                return {"success": False, "error": "Du musst gleichmäßig bauen."}
            if player.money < field.house_cost:
                return {"success": False, "error": "Nicht genug Geld."}
            player.money -= field.house_cost
            field.houses += 1
            self.status_message = f"{player.username} baut Haus auf {field.name} ({field.house_cost} €)."
            self.last_event = {"type": "build", "field": field.name, "houses": field.houses}
        elif build_type == "hotel":
            if field.houses != 4:
                return {"success": False, "error": "4 Häuser erforderlich."}
            if player.money < field.house_cost:
                return {"success": False, "error": "Nicht genug Geld."}
            player.money -= field.house_cost
            field.houses = 5
            self.status_message = f"{player.username} baut Hotel auf {field.name} ({field.house_cost} €)."
            self.last_event = {"type": "build", "field": field.name, "hotel": True}
        else:
            return {"success": False, "error": "Ungültige Bauaktion."}
        return {"success": True}

    def sell_building(self, property_name: str, sell_type: str, username: str) -> dict:
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        field = next((f for f in self.board if f.name == property_name), None)
        if not field or field not in player.properties:
            return {"success": False, "error": "Dieses Grundstück gehört dir nicht."}
        if field.field_type != "property":
            return {"success": False, "error": "Nur Straßen haben Gebäude."}
        group = [f for f in self.board if f.color_group == field.color_group and f.field_type == "property"]

        if sell_type == "hotel":
            if field.houses != 5:
                return {"success": False, "error": "Kein Hotel vorhanden."}
            field.houses = 4
            player.money += field.house_cost
            self.status_message = f"{username} verkauft Hotel auf {field.name} (+{field.house_cost} €)."
            self.last_event = {"type": "sell_building", "field": field.name, "hotel": True}
            self._sys_chat(f"🔨 {username} verkauft Hotel auf {field.name} für {field.house_cost} €")

        elif sell_type == "house":
            if field.houses == 0:
                return {"success": False, "error": "Keine Häuser vorhanden."}
            if field.houses == 5:
                return {"success": False, "error": "Zuerst Hotel verkaufen."}
            max_h = max(f.houses for f in group)
            if field.houses < max_h:
                return {"success": False, "error": "Gleichmäßig abreißen – zuerst Straßen mit mehr Häusern."}
            field.houses -= 1
            player.money += field.house_cost
            self.status_message = f"{username} verkauft Haus auf {field.name} (+{field.house_cost} €)."
            self.last_event = {"type": "sell_building", "field": field.name, "houses": field.houses}
            self._sys_chat(f"🔨 {username} verkauft Haus auf {field.name} für {field.house_cost} €")
        else:
            return {"success": False, "error": "Ungültige Aktion."}
        return {"success": True}

    def confirm_rent_payment(self, payer_username: str) -> dict:
        if not self.pending_rent:
            return {"success": False, "error": "Keine ausstehende Miete."}
        rent = self.pending_rent
        if rent["payer"] != payer_username:
            return {"success": False, "error": "Du bist nicht der Schuldner."}
        payer    = next((p for p in self.players if p.username == payer_username), None)
        creditor = next((p for p in self.players if p.username == rent["creditor"]), None)
        if not payer or not creditor:
            return {"success": False, "error": "Spieler nicht gefunden."}

        amount = rent["amount"]
        self.pending_rent = None

        if payer.money >= amount:
            payer.money    -= amount
            creditor.money += amount
            self.status_message = f"{payer_username} zahlt {amount} € Miete an {creditor.username}."
            self._sys_chat(f"💸 {payer_username} zahlt {amount} € Miete an {creditor.username}")
        else:
            total = self._total_asset_value(payer)
            if total < amount:
                partial = max(0, payer.money)
                payer.money     = 0
                creditor.money += partial
                self.status_message = f"{payer_username} kann Miete nicht zahlen und ist bankrott!"
                self._sys_chat(f"💀 {payer_username} kann {amount} € Miete nicht decken (Vermögen: {total} €)")
                self._declare_bankrupt(payer)
            else:
                return {"success": False, "error":
                    f"Nicht genug Bargeld ({payer.money} €). "
                    f"Verkaufe zuerst Häuser oder nimm eine Hypothek auf (Gesamtvermögen: {total} €)."}
        return {"success": True}

    def offer_property_for_rent(self, payer_username: str, prop_name: str) -> dict:
        if not self.pending_rent:
            return {"success": False, "error": "Keine ausstehende Miete."}
        rent = self.pending_rent
        if rent["payer"] != payer_username:
            return {"success": False, "error": "Du bist nicht der Schuldner."}
        payer = next((p for p in self.players if p.username == payer_username), None)
        prop = next((f for f in payer.properties if f.name == prop_name), None) if payer else None
        if not prop:
            return {"success": False, "error": "Grundstück nicht gefunden."}
        self.incoming_rent_offer = {
            "from": payer_username,
            "to": rent["creditor"],
            "prop_name": prop_name,
            "prop_color": prop.color_group,
            "prop_value": prop.price,
            "rent_amount": rent["amount"],
        }
        self.status_message = f"{payer_username} bietet '{prop_name}' statt Miete an."
        return {"success": True}

    def respond_rent_offer(self, creditor_username: str, accept: bool) -> dict:
        if not self.incoming_rent_offer:
            return {"success": False, "error": "Kein Angebot vorhanden."}
        offer = self.incoming_rent_offer
        if offer["to"] != creditor_username:
            return {"success": False, "error": "Du bist nicht der Empfänger."}
        payer = next((p for p in self.players if p.username == offer["from"]), None)
        creditor = next((p for p in self.players if p.username == creditor_username), None)
        self.incoming_rent_offer = None
        self.pending_rent = None
        if accept:
            prop = next((f for f in payer.properties if f.name == offer["prop_name"]), None)
            if prop and payer and creditor:
                payer.properties.remove(prop)
                prop.owner = creditor
                creditor.properties.append(prop)
                self.status_message = f"{creditor_username} erhält '{prop.name}' statt Miete."
                self._sys_chat(f"🤝 {creditor_username} akzeptiert '{prop.name}' statt Miete von {payer.username}")
        else:
            self.status_message = f"{creditor_username} lehnt das Grundstücksangebot ab. Miete muss gezahlt werden."
            self.pending_rent = {
                "payer": offer["from"],
                "creditor": creditor_username,
                "amount": offer["rent_amount"],
                "field_name": "",
            }
        return {"success": True}

    def confirm_tax_payment(self, payer_username: str) -> dict:
        if not self.pending_tax:
            return {"success": False, "error": "Keine ausstehende Steuer."}
        if self.pending_tax["payer"] != payer_username:
            return {"success": False, "error": "Nicht deine Steuer."}
        payer = next((p for p in self.players if p.username == payer_username), None)
        if not payer:
            return {"success": False, "error": "Spieler nicht gefunden."}
        tax = self.pending_tax
        amount = tax["amount"]
        self.pending_tax = None

        if payer.money >= amount:
            payer.money -= amount
            self.free_parking_pot += amount
            self.status_message = f"{payer_username} hat {amount} € Steuer gezahlt."
            self._sys_chat(f"🏛️ {payer_username} zahlt {amount} € Steuer")
        else:
            total = self._total_asset_value(payer)
            if total < amount:
                self.free_parking_pot += payer.money
                payer.money = 0
                self.status_message = f"{payer_username} kann die Steuer nicht zahlen und ist bankrott!"
                self._sys_chat(f"💀 {payer_username} kann {amount} € Steuer nicht decken (Vermögen: {total} €)")
                self._declare_bankrupt(payer)
            else:
                self.pending_tax = {
                    "payer": payer_username,
                    "amount": amount,
                    "field_name": tax.get("field_name", "Steuer"),
                }
                return {"success": False, "error":
                    f"Nicht genug Bargeld ({payer.money} €). "
                    f"Verkaufe zuerst Häuser oder nimm eine Hypothek auf (Gesamtvermögen: {total} €)."}
        return {"success": True}

    def send_trade(self, from_user, to_user, my_props, my_money, their_props, their_money) -> dict:
        sender = next((p for p in self.players if p.username == from_user), None)
        receiver = next((p for p in self.players if p.username == to_user), None)
        if not sender or not receiver:
            return {"success": False, "error": "Spieler nicht gefunden."}
        if self.active_trade:
            return {"success": False, "error": "Es läuft bereits ein Handel."}
        for pn in my_props:
            if not any(f.name == pn for f in sender.properties):
                return {"success": False, "error": f"Du besitzt '{pn}' nicht."}
        for pn in their_props:
            if not any(f.name == pn for f in receiver.properties):
                return {"success": False, "error": f"{to_user} besitzt '{pn}' nicht."}
        if my_money < 0 or their_money < 0:
            return {"success": False, "error": "Negativer Geldbetrag nicht möglich."}
        if sender.money < my_money:
            return {"success": False, "error": "Nicht genug Geld."}

        self.active_trade = {
            "from": from_user,
            "to": to_user,
            "my_props": my_props,
            "my_money": my_money,
            "their_props": their_props,
            "their_money": their_money,
            "history": [{"by": from_user, "action": f"Angebot gesendet: {len(my_props)} Grundstück(e) + {my_money}€ gegen {len(their_props)} Grundstück(e) + {their_money}€"}],
        }
        self._sys_chat(f"🤝 {from_user} möchte mit {to_user} handeln")
        return {"success": True}

    def respond_trade(self, responder: str, action: str, counter: Optional[dict] = None) -> dict:
        trade = self.active_trade
        if not trade:
            return {"success": False, "error": "Kein aktiver Handel."}
        if responder != trade["to"]:
            return {"success": False, "error": "Du bist nicht der Empfänger."}

        if action == "reject":
            self.active_trade = None
            self.status_message = f"{responder} hat den Handel abgelehnt."
            self._sys_chat(f"❌ {responder} hat den Handel abgelehnt")
            return {"success": True}

        if action == "accept":
            return self._execute_trade(trade)

        if action == "counter":
            if not counter:
                return {"success": False, "error": "Kein Gegenangebot angegeben."}
            if counter.get("my_money", 0) < 0 or counter.get("their_money", 0) < 0:
                return {"success": False, "error": "Negativer Geldbetrag nicht möglich."}
            new_trade = {
                "from": responder,
                "to": trade["from"],
                "my_props": counter.get("my_props", []),
                "my_money": counter.get("my_money", 0),
                "their_props": counter.get("their_props", []),
                "their_money": counter.get("their_money", 0),
                "history": trade["history"] + [{"by": responder, "action": f"Gegenangebot: {len(counter.get('my_props',[]))} Grundstück(e) + {counter.get('my_money',0)}€ gegen {len(counter.get('their_props',[]))} Grundstück(e) + {counter.get('their_money',0)}€"}],
            }
            sender = next((p for p in self.players if p.username == responder), None)
            orig_sender = next((p for p in self.players if p.username == trade["from"]), None)
            if sender and orig_sender:
                for pn in counter.get("my_props", []):
                    if not any(f.name == pn for f in sender.properties):
                        return {"success": False, "error": f"Du besitzt '{pn}' nicht."}
                for pn in counter.get("their_props", []):
                    if not any(f.name == pn for f in orig_sender.properties):
                        return {"success": False, "error": f"{trade['from']} besitzt dieses Grundstück nicht."}
            self.active_trade = new_trade
            self._sys_chat(f"↩ {responder} hat ein Gegenangebot an {trade['from']} gesendet")
            return {"success": True}

        return {"success": False, "error": "Ungültige Aktion."}

    def _execute_trade(self, trade: dict) -> dict:
        sender = next((p for p in self.players if p.username == trade["from"]), None)
        receiver = next((p for p in self.players if p.username == trade["to"]), None)
        if not sender or not receiver:
            self.active_trade = None
            return {"success": False, "error": "Spieler nicht gefunden."}

        sender_pays = trade.get("my_money", 0)
        receiver_pays = trade.get("their_money", 0)
        if sender_pays < 0 or receiver_pays < 0:
            self.active_trade = None
            return {"success": False, "error": "Negativer Geldbetrag nicht möglich."}

        if sender_pays > 0:
            if sender.money < sender_pays:
                self.active_trade = None
                return {"success": False, "error": f"{sender.username} hat nicht genug Geld."}
            sender.money -= sender_pays
            receiver.money += sender_pays

        if receiver_pays > 0:
            if receiver.money < receiver_pays:
                self.active_trade = None
                return {"success": False, "error": f"{receiver.username} hat nicht genug Geld."}
            receiver.money -= receiver_pays
            sender.money += receiver_pays

        for pn in trade.get("my_props", []):
            prop = next((f for f in self.board if f.name == pn), None)
            if prop and prop in sender.properties:
                sender.properties.remove(prop)
                prop.owner = receiver
                receiver.properties.append(prop)

        for pn in trade.get("their_props", []):
            prop = next((f for f in self.board if f.name == pn), None)
            if prop and prop in receiver.properties:
                receiver.properties.remove(prop)
                prop.owner = sender
                sender.properties.append(prop)

        self.active_trade = None
        self.status_message = f"Handel zwischen {sender.username} und {receiver.username} abgeschlossen!"
        self._sys_chat(f"✅ Handel zwischen {sender.username} und {receiver.username} erfolgreich abgeschlossen!")
        self.last_event = {"type": "trade", "a": sender.username, "b": receiver.username}

        self._check_true_bankruptcy(sender)
        self._check_true_bankruptcy(receiver)
        return {"success": True}

    def take_mortgage(self, property_name: str, username: str) -> dict:
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        field = next((f for f in self.board if f.name == property_name), None)
        if not field or field not in player.properties:
            return {"success": False, "error": "Dieses Grundstück gehört dir nicht."}
        if field.is_mortgaged:
            return {"success": False, "error": "Bereits verpfändet."}
        if field.houses > 0:
            return {"success": False, "error": "Erst alle Häuser/Hotels verkaufen."}
        mortgage_val = field.price // 2
        field.is_mortgaged = True
        player.money += mortgage_val
        self.status_message = f"{username} verpfändet {field.name} für {mortgage_val} €."
        self.last_event = {"type": "mortgage", "field": field.name, "amount": mortgage_val}
        self._sys_chat(f"🏦 {username} nimmt Hypothek auf {field.name}: +{mortgage_val} €")
        return {"success": True}

    def lift_mortgage(self, property_name: str, username: str) -> dict:
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        field = next((f for f in self.board if f.name == property_name), None)
        if not field or field not in player.properties:
            return {"success": False, "error": "Dieses Grundstück gehört dir nicht."}
        if not field.is_mortgaged:
            return {"success": False, "error": "Keine Hypothek vorhanden."}
        mortgage_val = field.price // 2
        repay = int(mortgage_val * 1.1)
        if player.money < repay:
            return {"success": False, "error": f"Nicht genug Geld. Rückzahlung: {repay} €"}
        field.is_mortgaged = False
        player.money -= repay
        self.status_message = f"{username} löst Hypothek auf {field.name} ab ({repay} €)."
        self.last_event = {"type": "unmortgage", "field": field.name, "amount": repay}
        self._sys_chat(f"✅ {username} löst Hypothek auf {field.name} ab: -{repay} €")
        return {"success": True}

    def use_jail_card(self, username: str) -> dict:
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        if not player.in_jail:
            return {"success": False, "error": "Du bist nicht im Gefängnis."}
        if player.get_out_of_jail_cards < 1:
            return {"success": False, "error": "Keine Gefängnisfreikarte vorhanden."}
        player.get_out_of_jail_cards -= 1
        player.in_jail = False
        player.jail_turns = 0
        self.status_message = f"{username} nutzt eine Gefängnisfreikarte und kommt frei!"
        self.last_event = {"type": "jail_card_used"}
        self._sys_chat(f"🃏 {username} nutzt eine Gefängnisfreikarte!")
        return {"success": True}

    def buy_out_of_jail(self, username: str) -> dict:
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        if not player.in_jail:
            return {"success": False, "error": "Du bist nicht im Gefängnis."}
        if player.money < 50:
            return {"success": False, "error": "Nicht genug Geld (50 € Kaution)."}
        player.money -= 50
        self.free_parking_pot += 50
        player.in_jail = False
        player.jail_turns = 0
        self.status_message = f"{username} zahlt 50 € Kaution und kommt frei!"
        self.last_event = {"type": "jail_buyout"}
        self._sys_chat(f"🔓 {username} hat sich für 50 € aus dem Gefängnis freigekauft")
        return {"success": True}

    def disconnect_player(self, username: str) -> dict:
        player = next((p for p in self.players if p.username == username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        player.is_disconnected = True
        self._sys_chat(f"👋 {username} hat den Raum verlassen.")
        self.status_message = f"{username} hat das Spiel verlassen."
        if self.players[self.current_player_index].username == username:
            active = [p for p in self.players if not p.is_bankrupt and not p.is_disconnected]
            if active:
                self._next_player()
                self.dice_result = None
                self.can_buy = False
                self.turn_phase = "roll"
        return {"success": True}

    def kick_player(self, host_id: str, target_username: str) -> dict:
        if self.host_id != host_id:
            return {"success": False, "error": "Nur der Host kann Spieler entfernen."}
        player = next((p for p in self.players if p.username == target_username), None)
        if not player:
            return {"success": False, "error": "Spieler nicht gefunden."}
        for prop in player.properties:
            prop.owner = None
            prop.houses = 0
            prop.is_mortgaged = False
        player.properties = []
        player.is_disconnected = True
        player.is_bankrupt = True
        self._sys_chat(f"🚫 {target_username} wurde vom Host aus dem Spiel entfernt.")
        self.status_message = f"{target_username} wurde entfernt."
        if self.players[self.current_player_index].username == target_username:
            active = [p for p in self.players if not p.is_bankrupt and not p.is_disconnected]
            if active:
                self._next_player()
                self.dice_result = None
                self.can_buy = False
                self.turn_phase = "roll"
        return {"success": True}

    def _reset_turn_timer(self):
        self.turn_started_at = time.time()
        self.movement_this_turn = False

    def _turn_deadline(self):
        if not self.players:
            return None
        active = [p for p in self.players if not p.is_bankrupt and not p.is_disconnected]
        if len(active) < 2:
            return None
        if self.movement_this_turn:
            return None
        if self.pending_rent or self.pending_tax or self.pending_card or self.active_trade:
            return None
        if self.last_event and self.last_event.get("type") in ("winner", "draw"):
            return None
        return self.turn_started_at + TURN_TIMEOUT_SECONDS

    def end_turn(self):
        self.dice_result = None
        self.can_buy = False
        self.turn_phase = "roll"
        self.last_move = None
        self._next_player()
        current = self.players[self.current_player_index] if self.players else None
        if current:
            self.status_message = f"{current.username} ist dran."
        self._reset_turn_timer()

    def check_turn_timeout(self):
        deadline = self._turn_deadline()
        if deadline is None or time.time() < deadline:
            return False
        self.end_turn()
        current = self.players[self.current_player_index] if self.players else None
        if current:
            self.status_message = f"Zeit abgelaufen - {current.username} ist dran."
        return True

    def _next_player(self):
        active = [p for p in self.players if not p.is_bankrupt and not p.is_disconnected]
        if not active:
            self.status_message = "Kein aktiver Spieler übrig."
            return
        idx = (self.current_player_index + 1) % len(self.players)
        while self.players[idx].is_bankrupt or self.players[idx].is_disconnected:
            idx = (idx + 1) % len(self.players)
        self.current_player_index = idx
        self._reset_turn_timer()

    def _player_to_dict(self, player: Player) -> dict:
        data = player.to_dict()
        props_info = []
        for field in player.properties:
            if field.field_type == "property":
                group = [f for f in self.board if f.color_group == field.color_group and f.field_type == "property"]
                min_h = min(f.houses for f in group)
                can_house = (field.houses < 4 and not field.is_mortgaged
                             and all(f.owner == player for f in group)
                             and all(not f.is_mortgaged for f in group)
                             and field.houses == min_h and player.money >= field.house_cost)
                can_hotel = (field.houses == 4 and not field.is_mortgaged
                             and all(f.owner == player for f in group)
                             and all(not f.is_mortgaged for f in group)
                             and player.money >= field.house_cost)
                max_h = max(f.houses for f in group)
                can_sell_house = (0 < field.houses < 5 and field.houses == max_h)
                can_sell_hotel = (field.houses == 5)
                mortgage_val = field.price // 2
                repay_val = int(mortgage_val * 1.1)
                can_mortgage = (not field.is_mortgaged and field.houses == 0)
                can_unmortgage = (field.is_mortgaged and player.money >= repay_val)
                props_info.append({
                    "name": field.name, "houses": field.houses, "color_group": field.color_group,
                    "is_mortgaged": field.is_mortgaged, "house_cost": field.house_cost,
                    "price": field.price,
                    "mortgage_value": mortgage_val, "repay_value": repay_val,
                    "can_build_house": can_house, "can_build_hotel": can_hotel,
                    "can_sell_house": can_sell_house, "can_sell_hotel": can_sell_hotel,
                    "can_mortgage": can_mortgage, "can_unmortgage": can_unmortgage
                })
            else:
                mortgage_val2 = field.price // 2
                repay_val2 = int(mortgage_val2 * 1.1)
                props_info.append({
                    "name": field.name, "houses": 0, "color_group": field.color_group,
                    "is_mortgaged": field.is_mortgaged, "house_cost": 0,
                    "price": field.price,
                    "mortgage_value": mortgage_val2, "repay_value": repay_val2,
                    "can_build_house": False, "can_build_hotel": False,
                    "can_sell_house": False, "can_sell_hotel": False,
                    "can_mortgage": not field.is_mortgaged,
                    "can_unmortgage": field.is_mortgaged and player.money >= repay_val2
                })
        def sort_key(p):
            cg = p.get("color_group","special")
            try: gi = GROUP_ORDER.index(cg)
            except ValueError: gi = 99
            return (gi, p.get("price", 0))
        props_info.sort(key=sort_key)
        data["properties"] = props_info
        return data

    def to_storage_dict(self) -> dict:
        return {
            "current_player_index": self.current_player_index,
            "dice_result": list(self.dice_result) if self.dice_result else None,
            "status_message": self.status_message,
            "can_buy": self.can_buy,
            "double_roll_count": self.double_roll_count,
            "chance_deck": self.chance_deck,
            "community_deck": self.community_deck,
            "turn_phase": self.turn_phase,
            "last_event": self.last_event,
            "last_move": self.last_move,
            "pending_rent": self.pending_rent,
            "incoming_rent_offer": self.incoming_rent_offer,
            "pending_tax": self.pending_tax,
            "active_trade": self.active_trade,
            "free_parking_pot": self.free_parking_pot,
            "pending_card": self.pending_card,
            "chat_messages": self.chat_messages,
            "host_id": self.host_id,
            "host_username": self.host_username,
            "turn_started_at": self.turn_started_at,
            "movement_this_turn": self.movement_this_turn,
            "players": [{
                "user_id": p.user_id,
                "username": p.username,
                "color": p.color,
                "avatar_emoji": p.avatar_emoji,
                "avatar_color": p.avatar_color,
                "avatar_url": p.avatar_url,
                "money": p.money,
                "position": p.position,
                "in_jail": p.in_jail,
                "jail_turns": p.jail_turns,
                "get_out_of_jail_cards": p.get_out_of_jail_cards,
                "is_bankrupt": p.is_bankrupt,
                "is_disconnected": p.is_disconnected,
            } for p in self.players],
            "board": [{
                "owner_id": f.owner.user_id if f.owner else None,
                "houses": f.houses,
                "is_mortgaged": f.is_mortgaged,
            } for f in self.board],
        }

    @classmethod
    def from_storage_dict(cls, data: dict) -> "Game":
        game = cls()
        game.board = _create_board()
        game.current_player_index = int(data.get("current_player_index", 0) or 0)

        dice = data.get("dice_result")
        game.dice_result = tuple(dice) if dice else None

        players = []
        for pd in data.get("players", []):
            p = Player(
                pd.get("user_id", ""),
                pd.get("username", ""),
                pd.get("color", "blue"),
                pd.get("avatar_emoji", "🎲"),
                pd.get("avatar_color", "#3b82f6"),
                pd.get("avatar_url", ""),
            )
            p.money = int(pd.get("money", 1500) or 0)
            p.position = int(pd.get("position", 0) or 0)
            p.in_jail = bool(pd.get("in_jail", False))
            p.jail_turns = int(pd.get("jail_turns", 0) or 0)
            p.get_out_of_jail_cards = int(pd.get("get_out_of_jail_cards", 0) or 0)
            p.is_bankrupt = bool(pd.get("is_bankrupt", False))
            p.is_disconnected = bool(pd.get("is_disconnected", False))
            players.append(p)
        game.players = players
        if players:
            game.current_player_index = max(0, min(game.current_player_index, len(players) - 1))
        else:
            game.current_player_index = 0

        player_by_id = {p.user_id: p for p in players}
        for idx, bd in enumerate(data.get("board", [])):
            if idx >= len(game.board):
                break
            field = game.board[idx]
            owner_id = bd.get("owner_id")
            field.owner = player_by_id.get(owner_id)
            field.houses = int(bd.get("houses", 0) or 0)
            field.is_mortgaged = bool(bd.get("is_mortgaged", False))

        for p in players:
            p.properties = []
        for field in game.board:
            if field.owner is not None:
                field.owner.properties.append(field)

        game.chance_deck = list(data.get("chance_deck") or CHANCE_CARDS)
        game.community_deck = list(data.get("community_deck") or COMMUNITY_CARDS)
        game.status_message = data.get("status_message", "Warte auf Spieler...")
        game.can_buy = bool(data.get("can_buy", False))
        game.double_roll_count = int(data.get("double_roll_count", 0) or 0)
        game.turn_phase = data.get("turn_phase", "roll")
        game.last_event = data.get("last_event")
        game.last_move = data.get("last_move")
        game.pending_rent = data.get("pending_rent")
        game.incoming_rent_offer = data.get("incoming_rent_offer")
        game.pending_tax = data.get("pending_tax")
        game.active_trade = data.get("active_trade")
        game.free_parking_pot = int(data.get("free_parking_pot", 0) or 0)
        game.pending_card = data.get("pending_card")
        game.chat_messages = list(data.get("chat_messages") or [])
        game.host_id = data.get("host_id", "")
        game.host_username = data.get("host_username", "")
        game.movement_this_turn = bool(data.get("movement_this_turn", False))
        if game.movement_this_turn:
            game.turn_started_at = float(data.get("turn_started_at") or time.time())
        else:
            game.turn_started_at = time.time()
        return game

    def to_dict(self) -> dict:
        current = self.players[self.current_player_index] if self.players else None
        return {
            "players": [self._player_to_dict(p) for p in self.players],
            "board": [f.to_dict() for f in self.board],
            "current_player": current.username if current else None,
            "current_player_color": current.color if current else None,
            "dice": self.dice_result,
            "status": self.status_message,
            "can_buy": self.can_buy,
            "turn_phase": self.turn_phase,
            "turn_deadline": self._turn_deadline(),
            "server_time": time.time(),
            "last_event": self.last_event,
            "pending_rent": self.pending_rent,
            "incoming_rent_offer": self.incoming_rent_offer,
            "pending_tax": self.pending_tax,
            "incoming_trade": self.active_trade,
            "last_move": self.last_move,
            "host_username": self.host_username,
            "pending_card": self.pending_card,
            "winner": self.last_event.get("player") if self.last_event and self.last_event.get("type") == "winner" else None,
            "free_parking_pot": self.free_parking_pot,
            "chat_messages": self.chat_messages[-80:],
        }


active_games: dict[str, Game] = {}