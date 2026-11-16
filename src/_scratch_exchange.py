"""Scratch: Dummy-Code gegen echtes Supabase tauschen -> Fehlerstruktur sichtbar."""
from dotenv import load_dotenv
load_dotenv("../.env")
import supabase_client as sa

uri = "http://localhost:5555/api/v1/discord/callback"
# 1) Ohne verifier
try:
    sa.discord_oauth_callback("dummy-code-123", redirect_uri=uri, code_verifier=None)
except sa.AuthError as e:
    print("ohne verifier ->", e)

# 2) Mit falschem verifier
try:
    sa.discord_oauth_callback("dummy-code-123", redirect_uri=uri, code_verifier="x" * 43)
except sa.AuthError as e:
    print("falscher verifier ->", e)

# 3) redirect_to weggelassen
try:
    sa.discord_oauth_callback("dummy-code-123", redirect_uri=None, code_verifier="x" * 43)
except sa.AuthError as e:
    print("ohne redirect_to ->", e)
