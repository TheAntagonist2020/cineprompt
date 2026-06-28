#!/usr/bin/env python3
"""Trakt OAuth device-auth flow for the Cineprompt data generator.

Run this once to authorize. It caches the token in .trakt_token.json next to
this file and auto-refreshes when expired. Import get_access_token() elsewhere.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.path.join(HERE, ".trakt_token.json")
API = "https://api.trakt.tv"


def _load_env():
    env = {}
    p = os.path.join(HERE, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    # allow real env vars to override
    for k in ("TRAKT_CLIENT_ID", "TRAKT_CLIENT_SECRET"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


ENV = _load_env()
CLIENT_ID = ENV.get("TRAKT_CLIENT_ID")
CLIENT_SECRET = ENV.get("TRAKT_CLIENT_SECRET")


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cineprompt-DataGen/1.0"


def _post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": UA},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None


def request_device_code():
    status, body = _post("/oauth/device/code", {"client_id": CLIENT_ID})
    if status != 200 or not body:
        sys.exit(f"Failed to get device code (HTTP {status}).")
    return body


def poll_for_token(device_code, interval, expires_in):
    deadline = time.time() + expires_in
    while time.time() < deadline:
        status, body = _post(
            "/oauth/device/token",
            {
                "code": device_code,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
            },
        )
        if status == 200 and body:
            body["obtained_at"] = int(time.time())
            json.dump(body, open(TOKEN_PATH, "w"))
            return body
        if status == 400:  # pending — keep polling
            time.sleep(interval)
            continue
        if status == 404:
            sys.exit("Device code invalid.")
        if status == 409:
            sys.exit("Already approved.")
        if status == 410:
            sys.exit("Device code expired — re-run to restart.")
        if status == 418:
            sys.exit("User denied the authorization.")
        if status == 429:
            time.sleep(interval + 1)
            continue
        time.sleep(interval)
    sys.exit("Timed out waiting for authorization.")


def refresh(token):
    status, body = _post(
        "/oauth/token",
        {
            "refresh_token": token["refresh_token"],
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
            "grant_type": "refresh_token",
        },
    )
    if status == 200 and body:
        body["obtained_at"] = int(time.time())
        json.dump(body, open(TOKEN_PATH, "w"))
        return body
    return None


def get_access_token():
    """Return a valid access token, refreshing if needed. None if not authed."""
    if not os.path.exists(TOKEN_PATH):
        return None
    token = json.load(open(TOKEN_PATH))
    age = int(time.time()) - token.get("obtained_at", 0)
    if age >= token.get("expires_in", 0) - 3600:  # refresh 1h before expiry
        token = refresh(token) or token
    return token.get("access_token")


def interactive():
    if not CLIENT_ID or not CLIENT_SECRET:
        sys.exit("Set TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET in datagen/.env")
    existing = get_access_token()
    if existing:
        print("Already authorized. Token is valid.")
        return
    code = request_device_code()
    print("\n=== Trakt authorization ===")
    print(f"1. Go to:   {code['verification_url']}")
    print(f"2. Enter code:   {code['user_code']}")
    print("\nWaiting for you to approve (poll every "
          f"{code['interval']}s, expires in {code['expires_in']}s)...\n")
    poll_for_token(code["device_code"], code["interval"], code["expires_in"])
    print("Authorized. Token saved to .trakt_token.json")


if __name__ == "__main__":
    interactive()
