"""
Per-user profile store (Phase 5 — onboarding + BYOK).

Backs the free-trial run counter and user-supplied API keys. Firestore only
(no file-backed fallback like tools.py's usage counters) — this system only
matters once Firebase auth is configured (multi-user, deployed context); local
dev with no FIREBASE_PROJECT_ID never calls into this module at all, same
"clean no-op when unset" convention as the rest of the app.

Reuses tools._get_firestore_client() rather than a second lazy singleton —
one Firestore client per process is enough.
"""
import os
from datetime import datetime, timezone
from cryptography.fernet import Fernet, InvalidToken
from . import tools

_COLLECTION = "user_profiles"

# Number of full ResearchTeam pipeline executions a user gets before the app
# requires their own OpenAI + listing-provider keys. Constant, not env-configurable
# — matches the style of tools.py's _RENTCAST_MONTHLY_LIMIT etc.
_FREE_RUN_LIMIT = 2

# Keys a user can BYOK. "openai" + at least one of "rentcast"/"apify" are
# REQUIRED for BYOK to unlock the app past the free trial (see is_byok_active).
# Gemini and Google Maps are deliberately absent — they stay app-managed
# permanently (tiered BYOK decision).
_BYOK_PROVIDERS = ("openai", "rentcast", "apify")

_BYOK_REQUIRED_MESSAGE = (
    "BYOK_REQUIRED: You've used your 2 free searches. Add your own OpenAI API "
    "key and a RentCast or Apify key in Settings to keep searching — every "
    "search after that uses only your own keys."
)

_fernet: Fernet | None = None
_fernet_checked = False


def _get_fernet() -> Fernet | None:
    global _fernet, _fernet_checked
    if not _fernet_checked:
        _fernet_checked = True
        key = os.getenv("PROFILE_ENCRYPTION_KEY")
        if key:
            _fernet = Fernet(key.encode())
    return _fernet


def _encrypt(value: str) -> str:
    fernet = _get_fernet()
    if fernet is None:
        raise RuntimeError(
            "PROFILE_ENCRYPTION_KEY is not set — cannot store a user API key "
            "without an encryption key configured."
        )
    return fernet.encrypt(value.encode()).decode()


def _decrypt(value: str) -> str | None:
    fernet = _get_fernet()
    if fernet is None:
        return None
    try:
        return fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def _doc(uid: str):
    return tools._get_firestore_client().collection(_COLLECTION).document(uid)


def _get_raw(uid: str) -> dict:
    """Read the raw Firestore doc, defaulting to a fresh empty profile on any
    failure — fail-open, same convention as tools._load_usage."""
    try:
        snap = _doc(uid).get()
        if snap.exists:
            return snap.to_dict() or {}
    except Exception as e:
        print(f"   ⚠️  Firestore profile read failed for uid={uid} ({e}). Treating as empty.")
    return {}


def ensure_profile(uid: str, email: str) -> None:
    """Create the profile doc on first sight of a user (idempotent)."""
    data = _get_raw(uid)
    if data:
        return
    try:
        _doc(uid).set({
            "email": email,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "run_count": 0,
            "api_keys": {},
        })
    except Exception as e:
        print(f"   ⚠️  Firestore profile create failed for uid={uid} ({e}).")


def get_profile_summary(uid: str) -> dict:
    data = _get_raw(uid)
    run_count = int(data.get("run_count", 0))
    keys = data.get("api_keys", {}) or {}
    keys_set = {p: bool(keys.get(p)) for p in _BYOK_PROVIDERS}
    return {
        "email": data.get("email"),
        "run_count": run_count,
        "free_runs_remaining": max(0, _FREE_RUN_LIMIT - run_count),
        "byok_active": _is_byok_active(keys_set),
        "keys_set": keys_set,
    }


def _is_byok_active(keys_set: dict) -> bool:
    return bool(keys_set.get("openai")) and bool(keys_set.get("rentcast") or keys_set.get("apify"))


def is_byok_active(uid: str) -> bool:
    data = _get_raw(uid)
    keys = data.get("api_keys", {}) or {}
    return _is_byok_active({p: bool(keys.get(p)) for p in _BYOK_PROVIDERS})


def get_decrypted_key(uid: str, provider: str) -> str | None:
    data = _get_raw(uid)
    encrypted = (data.get("api_keys", {}) or {}).get(provider)
    if not encrypted:
        return None
    return _decrypt(encrypted)


def save_api_key(uid: str, email: str, provider: str, value: str) -> None:
    if provider not in _BYOK_PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    ensure_profile(uid, email)
    encrypted = _encrypt(value)
    try:
        _doc(uid).set({"api_keys": {provider: encrypted}}, merge=True)
    except Exception as e:
        print(f"   ⚠️  Firestore profile key save failed for uid={uid}/{provider} ({e}).")
        raise


def clear_api_key(uid: str, provider: str) -> None:
    if provider not in _BYOK_PROVIDERS:
        raise ValueError(f"Unknown provider: {provider}")
    try:
        _doc(uid).set({"api_keys": {provider: None}}, merge=True)
    except Exception as e:
        print(f"   ⚠️  Firestore profile key clear failed for uid={uid}/{provider} ({e}).")
        raise


def increment_run_count(uid: str) -> int:
    """Bump the free-trial run counter. Best-effort: a failed write shouldn't
    break a search that already spent external API calls (same fail-open
    philosophy as tools._save_usage)."""
    data = _get_raw(uid)
    new_count = int(data.get("run_count", 0)) + 1
    try:
        _doc(uid).set({"run_count": new_count}, merge=True)
    except Exception as e:
        print(f"   ⚠️  Firestore run-count write failed for uid={uid} ({e}). Not persisted.")
    return new_count


def can_run(uid: str) -> tuple[bool, str | None]:
    data = _get_raw(uid)
    run_count = int(data.get("run_count", 0))
    keys = data.get("api_keys", {}) or {}
    keys_set = {p: bool(keys.get(p)) for p in _BYOK_PROVIDERS}
    if run_count < _FREE_RUN_LIMIT or _is_byok_active(keys_set):
        return True, None
    return False, _BYOK_REQUIRED_MESSAGE
