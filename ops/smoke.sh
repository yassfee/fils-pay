#!/usr/bin/env bash
# Smoke test for a running FilsPay stack (local or hosted).
# Usage: BASE_URL=https://host MERCHANT_ID=<uuid> EMAIL=owner@... PASSWORD=... ops/smoke.sh
# Checks: health, readiness, a pre-OTP cookie is refused (AUTH-1), login + OTP, /v1/auth/me.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
jar="$(mktemp)"; trap 'rm -f "$jar"' EXIT
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; exit 1; }

[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/healthz")" = 200 ] && pass healthz || fail healthz
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/readyz")" = 200 ] && pass readyz || fail readyz
# WEB-1: with ADMIN_URL set, BASE_URL is the web service (Caddy): both SPAs load, deep links fall back to index.html.
for u in ${ADMIN_URL:+"$BASE_URL/" "$BASE_URL/pay/smoke-deep-link" "$ADMIN_URL/merchants"}; do
  case "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$u")" in "200 text/html"*) pass "SPA $u";; *) fail "SPA $u";; esac
done

login="$(curl -s -c "$jar" -X POST "$BASE_URL/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"merchantId\":\"$MERCHANT_ID\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
code="$(printf '%s' "$login" | sed -n 's/.*"devOtpCode":"\([0-9]*\)".*/\1/p')"
[ -n "$code" ] && pass "login (OTP issued)" || fail "login: $login"

pre="$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' "$BASE_URL/v1/auth/me")"
[ "$pre" = 401 ] && pass "pre-OTP cookie refused (401)" || fail "pre-OTP cookie got $pre (AUTH-1)"

verify="$(curl -s -b "$jar" -c "$jar" -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/v1/auth/otp/verify" \
  -H 'content-type: application/json' -d "{\"code\":\"$code\"}")"
[ "$verify" = 200 ] && pass "OTP verify" || fail "OTP verify got $verify"

me="$(curl -s -b "$jar" -o /dev/null -w '%{http_code}' "$BASE_URL/v1/auth/me")"
[ "$me" = 200 ] && pass "/v1/auth/me after OTP" || fail "/v1/auth/me got $me"
echo "smoke: all checks passed against $BASE_URL"
