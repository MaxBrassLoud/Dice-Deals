"""Live-Smoke-Test gegen die echte Supabase-Instanz. Liest/veraendert nur
temporaere Daten (Spielstand, Token, room_code) und legt einen kurzlebigen
Auth-User an, der am Ende wieder geloescht wird."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv()

import database as db
import supabase_client as sa

# --- read-only Auth check ---
users = sa.get_client().auth.admin.list_users()
print("supabase auth users:", len(users))

# --- database.py smoke against live Supabase ---
mika = db.get_user_by_username("Mika")
print("Mika loaded:", mika[1], "provider=", mika[16])
print("search ILIKE mik ->", [u["username"] for u in db.search_users("mik")])
print("name Mika available?", db.is_display_name_available("mika"))
print("name MikaZZ available?", db.is_display_name_available("MikaZZ"))

db.save_game("SMOKE1", '{"t":1}')
print("game state:", db.get_game_state("SMOKE1"))
db.touch_game("SMOKE1")
db.delete_game("SMOKE1")
print("game deleted, state now:", db.get_game_state("SMOKE1"))

tok = db.create_auth_token(mika[0])
u2 = db.get_user_by_token(tok)
print("token roundtrip user:", u2[1] if u2 else None)
db.delete_auth_token(tok)
print("token deleted, lookup:", db.get_user_by_token(tok))

db.update_user_room(mika[0], "SMOKE2")
print("room set:", db.get_user_by_id(mika[0])[13])
db.update_user_room(mika[0], None)
print("room cleared:", db.get_user_by_id(mika[0])[13])

# --- Supabase Auth round trip ---
import time

email = f"smoke-{int(time.time())}@example.invalid"
uid = sa.create_auth_user(email, "TempPass123!", "smoketest")
print("auth user created:", uid)
ok = sa.verify_password(email, "TempPass123!")
print("verify_password ok:", ok)
sa.update_password(uid, "TempPass456!")
print("password updated, verify new:", sa.verify_password(email, "TempPass456!"))
sa.update_email(uid, f"smoke-moved-{int(time.time())}@example.invalid")
sa.delete_auth_user(uid)
print("auth user deleted; verify after delete:", sa.verify_password(email, "TempPass456!"))

# Aufraeumen: keine Restzeilen in users
with db.get_connection() as conn:
    with conn.cursor() as c:
        c.execute("SELECT COUNT(*) FROM users WHERE username = 'smoketest'")
        print("leftover smoketest rows:", c.fetchone()[0])
        c.execute("SELECT COUNT(*) FROM games WHERE room_code = 'SMOKE1'")
        print("leftover smoke games:", c.fetchone()[0])
        c.execute("SELECT COUNT(*) FROM auth_tokens WHERE user_id = %s", (mika[0],))
        print("leftover tokens for Mika (should be 0):", c.fetchone()[0])
print("SMOKE OK")
