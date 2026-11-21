import base64
import hashlib
import urllib.parse

import pytest
import supabase_client


def test_discord_public_name_removes_legacy_discriminator():
    assert supabase_client._discord_public_name("Example#1234") == "Example"
    assert supabase_client._discord_public_name("Example") == "Example"
    assert supabase_client._discord_public_name(None) is None


def test_extract_discord_identity_builds_avatar_url():
    username, external_id, avatar = supabase_client._extract_identity(
        "discord",
        {"username": "Max#1234", "id": 987654, "avatar": "hash123"},
        "fallback@example.com",
    )
    assert username == "Max"
    assert external_id == "987654"
    assert avatar == "https://cdn.discordapp.com/avatars/987654/hash123.png"


def test_extract_identity_falls_back_to_email_name():
    identity = supabase_client._extract_identity("discord", {}, "alice@example.com")
    assert identity == ("alice", None, None)


def test_oauth_redirect_rejects_unknown_provider():
    with pytest.raises(supabase_client.AuthError):
        supabase_client.oauth_redirect("google", "https://example.test/callback")


def test_oauth_redirect_requires_redirect_uri(monkeypatch):
    monkeypatch.setattr(supabase_client, "SUPABASE_REDIRECT_URI", None, raising=False)
    with pytest.raises(supabase_client.AuthError):
        supabase_client.oauth_redirect("discord", None)


def test_oauth_redirect_creates_valid_pkce_pair(monkeypatch):
    monkeypatch.setattr(supabase_client, "SUPABASE_URL", "https://project.supabase.co")
    url, verifier = supabase_client.oauth_redirect(
        "discord", "https://app.example.test/api/v1/discord/callback"
    )
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)

    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")

    assert parsed.path == "/auth/v1/authorize"
    assert params["provider"] == ["discord"]
    assert params["redirect_to"] == ["https://app.example.test/api/v1/discord/callback"]
    assert params["code_challenge_method"] == ["S256"]
    assert params["code_challenge"] == [expected]
    assert len(verifier) >= 43
