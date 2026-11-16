"""Live-Smoke-Test gegen die echte Supabase-Instanz. Legt einen kurzlebigen
Auth-User + App-User an, prueft DB- und Auth-Roundtrips und raeumt alles
wieder auf. Läuft auch auf einer leeren Datenbank."""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv()

import database as db
import supabase_client as sa

suffix = uuid.uuid4().hex[:8]
username = f"smoke_{suffix}"
email = f"{username}@example.com"
uid = f"uid-smoke-{suffix}"
user_id = f"SMK-{suffix[:4]}-{suffix[4:8]}-{suffix[8:12]}"

# --- Supabase Auth roundtrip ---
uid = sa.create_auth_user(email, "Smoketest-123", username)
print("auth create+verify:", sa.verify_password(email, "Smoketest-123"))
sa.update_password(uid, "Smoketest-456")
print("auth verify new pw:", sa.verify_password(email, "Smoketest-456"))
sa.update_email(uid, f"{username}-new@example.com")

# --- App-User in der DB ---
db.create_user(user_id, username, None, email, third_party=0, provider=0,
               ext_user_id=None, auth_provider="supabase", auth_uid=uid)
u = db.get_user_by_username(username)
print("user loaded:", u[1], "provider=", u[16], "uid=", u[17])
print("search ILIKE smoke ->", [x["username"] for x in db.search_users("smoke")])
print("name available?", db.is_display_name_available(username + "X"))

# --- Game roundtrip ---
db.save_game("SMOKE1", '{"t":1}')
print("game state:", db.get_game_state("SMOKE1"))
db.touch_game("SMOKE1")
db.delete_game("SMOKE1")
print("game deleted:", db.get_game_state("SMOKE1"))

# --- Token roundtrip ---
tok = db.create_auth_token(user_id)
u2 = db.get_user_by_token(tok)
print("token roundtrip user:", u2[1] if u2 else None)
db.delete_auth_token(tok)
print("token deleted:", db.get_user_by_token(tok))

# --- Room roundtrip ---
db.update_user_room(user_id, "SMKRM")
print("room set:", db.get_user_by_id(user_id)[13])
db.update_user_room(user_id, None)
print("room cleared:", db.get_user_by_id(user_id)[13])

# --- Cleanup ---
sa.delete_auth_user(uid)
with db.get_connection() as conn:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM users")
        print("cleanup done; remaining users:", cur.fetchone()[0])
