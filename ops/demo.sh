#!/usr/bin/env bash
# FP-300 refunds demo: proves the case-file "done when" boxes 1-5 end to end through the API.
# Usage (local docker compose stack, from the repo root):   ops/demo.sh
# Hosted (box 6):  BASE_URL=https://host MERCHANT_ID=<uuid> EMAIL=... PASSWORD=... \
#                  [PSQL='psql "$DATABASE_URL" -tAc'] [HOOK_URL=https://your-receiver/hook] ops/demo.sh
# Hosted: box 2 needs PSQL; the local receiver and box 3 (demo-only backdate + run-batch) run only against localhost.
# Outside NODE_ENV=development there is no devOtpCode: pass OTP_CODE=<code> or type it when asked; SKIP_SMOKE=1.
# Needs: bash, curl, node (JSON parsing), docker compose for the local DB/receiver steps. Money is integer fils.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-http://localhost:3000}"
EMAIL="${EMAIL:-owner@alpharetail.example}"
PASSWORD="${PASSWORD:-FilsPaySeed!2026}"   # dev seed only: SEED_USER_PASSWORD in db/seed/generate.ts
COMPOSE="docker compose -f ops/docker-compose.yml"
CARD='{"pan":"4242424242424242","expiryMonth":12,"expiryYear":2030,"cvv":"123"}'
RUN="$(date +%s)"; FAILS=0
TMP="$(mktemp -d)"; command -v cygpath >/dev/null && TMP="$(cygpath -m "$TMP")"; JAR="$TMP/jar"; : >"$JAR"
cleanup() { [ -n "${HOOK_CONTAINER:-}" ] && docker rm -f "$HOOK_CONTAINER" >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }
check() { if [ "$1" = "$2" ]; then pass "$3 ($1)"; else fail "$3: got '$1', expected '$2'"; fi; }
hdr() { echo; echo "=== $* ==="; }
# j <path> : read JSON on stdin, print the value at a dotted path (arrays: numeric index); objects as JSON.
j() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v=undefined}
for(const k of (process.argv[1]||"").split(".").filter(Boolean))v=v==null?undefined:v[k];
process.stdout.write(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):String(v))})' "${1:-}"; }
# canon : JSON on stdin with object keys sorted (replays come from a jsonb column, so key order may differ).
canon() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=v=>Array.isArray(v)?v.map(c):v&&typeof v==="object"?
Object.fromEntries(Object.keys(v).sort().map(k=>[k,c(v[k])])):v;process.stdout.write(JSON.stringify(c(JSON.parse(s))))})'; }
# call <s|k|-> <METHOD> <path> [json] [curl args...] -> sets CODE, BODY. s = session cookie, k = API key, - = none.
call() {
  local auth=$1 m=$2 p=$3 d=${4:-}; shift 3; [ $# -gt 0 ] && shift
  local a=(-s -X "$m" "$BASE_URL$p" -w $'\n%{http_code}')
  case "$auth" in s) a+=(-b "$JAR");; k) a+=(-H "authorization: Bearer $API_KEY");; esac
  [ -n "$d" ] && a+=(-H 'content-type: application/json' --data "$d")
  local out; out="$(curl "${a[@]}" "$@")"; CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}
LOCAL=0; case "$BASE_URL" in http://localhost*|http://127.0.0.1*) LOCAL=1;; esac; DB=$LOCAL; [ -n "${PSQL:-}" ] && DB=1
sql() { if [ -n "${PSQL:-}" ]; then eval "$PSQL \"\$1\""; else $COMPOSE exec -T postgres psql -U filspay -d filspay -v ON_ERROR_STOP=1 -tAc "$1"; fi; }
bh_date() { node -e 'process.stdout.write(new Date(Date.now()+3*3600e3+Number(process.argv[1])*864e5).toISOString().slice(0,10))' "$1"; }
TODAY="$(bh_date 0)"; TOMORROW="$(bh_date 1)"   # Bahrain business day (UTC+3, no DST)
if [ -z "${MERCHANT_ID:-}" ] && [ "$DB" = 1 ]; then MERCHANT_ID="$(sql "SELECT id FROM merchants WHERE display_name = 'Alpha Retail Co'")"; fi
[ -n "${MERCHANT_ID:-}" ] || { echo "MERCHANT_ID is required"; exit 2; }
echo "FP-300 demo against $BASE_URL  merchant=$MERCHANT_ID  Bahrain day=$TODAY  run=$RUN"

hdr "0. Smoke (ops/smoke.sh)"
if [ "${SKIP_SMOKE:-0}" = 1 ]; then echo "SKIP  smoke (SKIP_SMOKE=1; smoke.sh needs devOtpCode, i.e. NODE_ENV=development)"
else BASE_URL="$BASE_URL" MERCHANT_ID="$MERCHANT_ID" EMAIL="$EMAIL" PASSWORD="$PASSWORD" bash ops/smoke.sh || fail "smoke"; fi

# capture <amountFils> -> TX (authorize with the API key, then capture; both with Idempotency-Key)
capture() {
  call k POST /v1/transactions "{\"amountFils\":$1,\"card\":$CARD,\"reference\":\"fp300-demo-$RUN\"}" -H "idempotency-key: auth-$RUN-$2"
  [ "$CODE" = 201 ] || { fail "authorize $1: $CODE $BODY"; return 1; }
  TX="$(echo "$BODY" | j id)"
  call k POST "/v1/transactions/$TX/capture" '{}' -H "idempotency-key: cap-$RUN-$2"
  [ "$CODE" = 200 ] || { fail "capture $TX: $CODE $BODY"; return 1; }
  echo "      captured $1 fils: transaction $TX (status $(echo "$BODY" | j status))"
}
refund() { local h=(); [ -n "${3:-}" ] && h=(-H "idempotency-key: $3")
  call s POST /v1/refunds "{\"transactionId\":\"$1\",\"amountFils\":$2,\"reason\":\"customer_request\"}" ${h[@]+"${h[@]}"}; }
volumes() { call s GET "/v1/analytics/volumes?from=$TODAY&to=$TOMORROW"; echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);const r=(b.points||[]).find(x=>x.date===process.argv[1])||{};process.stdout.write((r.refundCount||0)+" "+(r.refundGrossFils||0))})' "$TODAY"; }

hdr "1. Refunds through the API (box 1)"
call - POST /v1/auth/login "{\"merchantId\":\"$MERCHANT_ID\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" -c "$JAR"
OTP="$(echo "$BODY" | j devOtpCode)"   # development only; elsewhere pass OTP_CODE or type the code when asked
case "$CODE" in 2??) [ -n "$OTP" ] || OTP="${OTP_CODE:-}"; [ -n "$OTP" ] || read -r -p "      OTP code for $EMAIL: " OTP </dev/tty
  pass "login: OTP issued";; *) fail "login: $CODE $BODY"; exit 1;; esac
call s POST /v1/auth/otp/verify "{\"code\":\"$OTP\"}" -c "$JAR"; check "$CODE" 200 "OTP verify"
if [ -z "${API_KEY:-}" ]; then
  call s POST "/v1/merchants/$MERCHANT_ID/api-keys" '{"label":"fp300-demo"}'; check "$CODE" 201 "issue API key (owner session)"
  API_KEY="$(echo "$BODY" | j rawKey)"
fi
VOL0="$(volumes)"; echo "      analytics before: refundCount refundGrossFils on $TODAY = $VOL0"
capture 10000 main && MAIN="$TX"
refund "$MAIN" 3333 "K1-$RUN"; check "$CODE" 200 "refund 3,333 (K1)"; R1="$BODY"; echo "      $R1"
[ "$DB" = 1 ] && W0="$(sql "SELECT COUNT(*) FROM refunds WHERE transaction_id = '$MAIN'")"
refund "$MAIN" 3333 "K1-$RUN"; check "$CODE" 200 "replay K1"
check "$([ "$(echo "$BODY" | canon)" = "$(echo "$R1" | canon)" ] && echo identical || echo different)" identical "replay K1 body (same fields and values, refund id $(echo "$BODY" | j id))"
[ "$DB" = 1 ] && check "$(sql "SELECT COUNT(*) FROM refunds WHERE transaction_id = '$MAIN'")" "$W0" "replay wrote no new refund row"
refund "$MAIN" 3333 "K2-$RUN"; check "$CODE" 200 "refund 3,333 (K2)"; R2="$BODY"; echo "      $R2"
refund "$MAIN" 3334 "K3-$RUN"; check "$CODE" 200 "refund 3,334 (K3)"; R3="$BODY"; echo "      $R3"
check "$(echo "$R3" | j transactionStatus)" refunded "status after 3,333+3,333+3,334"
refund "$MAIN" 1 "K4-$RUN"; echo "      $BODY"
case "$CODE" in 4??) pass "refund 1 fil more (K4) rejected ($CODE $(echo "$BODY" | j code)$(echo "$BODY" | j error))";; *) fail "K4 got $CODE";; esac
refund "$MAIN" 1000 ""; check "$CODE $(echo "$BODY" | j error)" "400 idempotency_key_required" "refund without Idempotency-Key"
capture 10000 race && RACE="$TX"
( refund "$RACE" 6000 "C1-$RUN"; echo "$CODE" >"$TMP/c1" ) & ( refund "$RACE" 6000 "C2-$RUN"; echo "$CODE" >"$TMP/c2" ) & wait
check "$(sort "$TMP/c1" "$TMP/c2" | tr '\n' ' ')" "200 422 " "two concurrent 6,000 refunds on a 10,000 capture: exactly one succeeds"
NR=4; GR=16000   # refunds made so far this run: 3,333 + 3,333 + 3,334 + 6,000

hdr "2. Ledger right to the fil (box 2)"
if [ "$DB" = 1 ]; then
  sql "SELECT account_id, SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END) FROM ledger_entries
       WHERE transaction_id = '$MAIN' GROUP BY 1 ORDER BY 1" | sed 's/^/      net by account: /'
  check "$(sql "SELECT COUNT(*) FROM (SELECT account_id FROM ledger_entries WHERE transaction_id = '$MAIN' AND account_id IN
       ('merchant_payable','platform_fee_revenue','card_scheme_clearing') GROUP BY 1 HAVING SUM(CASE WHEN direction = 'credit'
       THEN amount_fils ELSE -amount_fils END) <> 0) x")" 0 "merchant_payable, platform_fee_revenue, card_scheme_clearing each net 0"
  F="$(sql "SELECT SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END) FROM ledger_entries WHERE transaction_id = '$MAIN'
       AND account_id = 'platform_fee_revenue' AND COALESCE(description, '') NOT LIKE 'refund:%'")"
  FR="$(sql "SELECT string_agg(fee_reversed_fils::text, '+' ORDER BY occurred_at, id) || ' = ' || SUM(fee_reversed_fils) FROM refunds WHERE transaction_id = '$MAIN'")"
  echo "      fee charged at capture F = $F; fee reversed by the refunds = $FR"
  check "${FR##* }" "$F" "sum of refunds.fee_reversed_fils equals the capture fee"
else echo "SKIP  no DB access (set PSQL to run the ledger checks)"; fi

hdr "4. refund.succeeded webhook, HMAC verified by a local receiver (box 4)"
VERIFY='const {createHmac,timingSafeEqual}=require("crypto");const secret=process.env.WEBHOOK_SECRET;
function verify(raw,header,now){const m=/^t=(\d+),v1=([0-9a-f]{64})$/.exec(header||"");if(!m)return false;
if(Math.abs(now-Number(m[1]))>300)return false;
const exp=createHmac("sha256",secret).update(Buffer.concat([Buffer.from(m[1]+"."),raw])).digest();const got=Buffer.from(m[2],"hex");
return got.length===exp.length&&timingSafeEqual(got,exp);}'
RECEIVER="$VERIFY"'
require("http").createServer((req,res)=>{const c=[];req.on("data",d=>c.push(d)).on("end",()=>{const raw=Buffer.concat(c);
const ok=verify(raw,req.headers["webhook-signature"],Math.floor(Date.now()/1000));let ev={};try{ev=JSON.parse(raw)}catch{}
console.log(JSON.stringify({verified:ok,type:ev.type,deliveryId:req.headers["webhook-delivery-id"],data:ev.data,sig:req.headers["webhook-signature"],raw:raw.toString("base64")}));
res.writeHead(ok?200:400).end();});}).listen(4000,"0.0.0.0",()=>console.log("receiver listening on :4000"));'
HOOK_URL="${HOOK_URL:-}"
if [ -z "$HOOK_URL" ] && [ "$LOCAL" = 1 ]; then HOOK_CONTAINER="filspay-demo-hook"; HOOK_URL="http://$HOOK_CONTAINER:4000/hook"; fi
if [ -n "$HOOK_URL" ]; then
  call s POST "/v1/merchants/$MERCHANT_ID/webhook-endpoints" "{\"url\":\"$HOOK_URL\"}"; check "$CODE" 201 "register webhook endpoint $HOOK_URL"
  EP="$(echo "$BODY" | j id)"; SECRET="$(echo "$BODY" | j secret)"; echo "      endpoint $EP, secret prefix $(echo "$BODY" | j secretPrefix) (secret shown once)"
  if [ -n "${HOOK_CONTAINER:-}" ]; then
    docker rm -f "$HOOK_CONTAINER" >/dev/null 2>&1
    # Receiver = the api image's node, on the api container's network (no image pull, nothing external).
    API_CID="$($COMPOSE ps -q api)"; HOOK_IMG="$(docker inspect -f '{{.Config.Image}}' "$API_CID")"
    HOOK_NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$API_CID" | awk '{print $1}')"
    docker run -d --rm --name "$HOOK_CONTAINER" --network "$HOOK_NET" -e WEBHOOK_SECRET="$SECRET" "$HOOK_IMG" node -e "$RECEIVER" >/dev/null || fail "start receiver"
  fi
  capture 10000 hook && HOOKTX="$TX"
  refund "$HOOKTX" 4000 "W1-$RUN"; check "$CODE" 200 "refund 4,000" && { NR=5; GR=20000; }; RID="$(echo "$BODY" | j id)"
  if [ -n "${HOOK_CONTAINER:-}" ]; then
    LINE=""; for i in $(seq 1 30); do LINE="$(docker logs "$HOOK_CONTAINER" 2>/dev/null | grep "\"refundId\":\"$RID\"" | head -1)"; [ -n "$LINE" ] && break; sleep 1; done
    if [ -n "$LINE" ]; then
      echo "$LINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s);console.log("      received "+e.type+" delivery "+e.deliveryId+" "+JSON.stringify(e.data)+"\n      Webhook-Signature: "+e.sig)})'
      check "$(echo "$LINE" | j type) $(echo "$LINE" | j verified)" "refund.succeeded true" "receiver verified HMAC-SHA256 over t + raw bytes (timingSafeEqual, 300 s window)"
      # Same verifier on the host: one flipped byte and a stale timestamp must both fail.
      check "$(echo "$LINE" | WEBHOOK_SECRET="$SECRET" node -e "$VERIFY let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const e=JSON.parse(s);const raw=Buffer.from(e.raw,'base64');const now=Math.floor(Date.now()/1000);const t=Buffer.from(raw);t[t.length-2]^=1;process.stdout.write([verify(raw,e.sig,now),verify(t,e.sig,now),verify(raw,e.sig,now+3600)].join(' '))})")" \
        "true false false" "host re-check: genuine true, tampered false, stale false"
    else fail "no refund.succeeded for refund $RID within 30 s (docker logs $HOOK_CONTAINER)"; fi
    call s PATCH "/v1/merchants/$MERCHANT_ID/webhook-endpoints/$EP" '{"status":"disabled"}'; echo "      demo endpoint disabled ($CODE)"
  else echo "      check your receiver at $HOOK_URL for refund.succeeded refundId=$RID"; fi
else echo "SKIP  no HOOK_URL and no local docker"; fi

hdr "5. Timeline, reports, reconciliation (box 5)"
call s GET "/v1/transactions/$MAIN/events"
echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);const ev=Array.isArray(b)?b:(b.events||b.data||[]);for(const e of ev)console.log("      "+(e.eventType||e.event_type)+" "+(e.amountFils??e.amount_fils??""))})'
check "$(echo "$BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);const ev=Array.isArray(b)?b:(b.events||b.data||[]);process.stdout.write(ev.filter(e=>/refund/.test(e.eventType||e.event_type)).map(e=>(e.eventType||e.event_type)+":"+(e.amountFils??e.amount_fils)).join(" "))})')" \
  "refund_partial:-3333 refund_partial:-3333 refunded:-3334" "timeline rows"
EXPECT="$(echo "$VOL0" | awk -v n="$NR" -v g="$GR" '{print $1+n, $2+g}')"   # this run's refunds
for i in $(seq 1 20); do VOL1="$(volumes)"; [ "$VOL1" = "$EXPECT" ] && break; sleep 1; done
check "$VOL1" "$EXPECT" "GET /v1/analytics/volumes $TODAY refundCount refundGrossFils (before: $VOL0, +$NR refunds, +$GR fils)"
call s GET "/v1/settlement/reconciliation?from=$TODAY&to=$TOMORROW"; echo "      $BODY"
check "$(echo "$BODY" | j gapFils)" 0 "reconciliation $TODAY gapFils (pending refunds line $(echo "$BODY" | j pendingUnbatchedRefundsFils))"

hdr "3. Fees and payouts: refund netted into a closed batch (box 3)"
if [ "$LOCAL" = 1 ]; then
  capture 10000 net && NET="$TX"
  refund "$NET" 3333 "N1-$RUN"; check "$CODE" 200 "refund 3,333"
  # The daemon closes a Bahrain day only after it has ended (CLOSE-1), and yesterday is already closed, so the
  # DEMO-ONLY step below moves this ONE transaction (events, ledger legs, refund) to the latest earlier day D that has no
  # batch, ledger rows or events for this merchant (so the batch and the reconciliation for D contain only this case).
  D="$(sql "SELECT d::date FROM generate_series((now() AT TIME ZONE 'Asia/Bahrain')::date - 1, (now() AT TIME ZONE 'Asia/Bahrain')::date - 730,
       interval '-1 day') d WHERE NOT EXISTS (SELECT 1 FROM settlement_batches WHERE merchant_id = '$MERCHANT_ID' AND batch_date = d::date)
     AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE merchant_id = '$MERCHANT_ID' AND occurred_at >= d::date::timestamp AT TIME ZONE 'Asia/Bahrain'
       AND occurred_at < (d::date + 1)::timestamp AT TIME ZONE 'Asia/Bahrain')
     AND NOT EXISTS (SELECT 1 FROM transaction_events te JOIN transactions t ON t.id = te.transaction_id WHERE t.merchant_id = '$MERCHANT_ID'
       AND te.occurred_at >= d::date::timestamp AT TIME ZONE 'Asia/Bahrain' AND te.occurred_at < (d::date + 1)::timestamp AT TIME ZONE 'Asia/Bahrain')
     AND NOT EXISTS (SELECT 1 FROM refunds WHERE merchant_id = '$MERCHANT_ID' AND status = 'succeeded' AND settlement_batch_id IS NULL
       AND transaction_id <> '$NET' AND occurred_at < (d::date + 1)::timestamp AT TIME ZONE 'Asia/Bahrain')
     ORDER BY d DESC LIMIT 1")"
  N="$(sql "SELECT (now() AT TIME ZONE 'Asia/Bahrain')::date - DATE '$D'")"
  echo "      DEMO-ONLY SQL: backdating transaction $NET by $N day(s) to Bahrain day $D"
  sql "UPDATE transaction_events SET occurred_at = occurred_at - make_interval(days => $N) WHERE transaction_id = '$NET';
       ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_append_only; -- DEMO-ONLY time travel (LED-1)
       UPDATE ledger_entries SET occurred_at = occurred_at - make_interval(days => $N) WHERE transaction_id = '$NET';
       ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_append_only;
       UPDATE refunds SET occurred_at = occurred_at - make_interval(days => $N) WHERE transaction_id = '$NET';" >/dev/null
  $COMPOSE exec -T settlement ./settlement run-batch --date="$D" --merchant="$MERCHANT_ID" | sed 's/^/      /'
  ROW="$(sql "SELECT b.id, b.status, b.gross_fils, b.fee_fils, b.refund_gross_fils, b.refund_fee_reversed_fils, b.net_payout_fils,
       (SELECT COUNT(*) FROM refunds r WHERE r.settlement_batch_id = b.id AND r.transaction_id = '$NET')
       FROM settlement_batches b WHERE b.merchant_id = '$MERCHANT_ID' AND b.batch_date = '$D'")"
  IFS='|' read -r BID BST G FEE RG RF NETP STAMPED <<<"$ROW"
  echo "      batch $BID $BST: gross $G - fee $FEE - (refund $RG - fee reversed $RF) = net $NETP"
  check "$NETP" "$(( (G - FEE) - (RG - RF) ))" "net = sum(gross - fee) - sum(r - f)"
  check "$STAMPED" 1 "refund stamped with batch $BID"
  call s GET "/v1/settlement/reconciliation?from=$D&to=$(node -e 'const d=new Date(process.argv[1]);d.setUTCDate(d.getUTCDate()+1);process.stdout.write(d.toISOString().slice(0,10))' "$D")"
  echo "      $BODY"
  check "$(echo "$BODY" | j gapFils) $(echo "$BODY" | j nettedRefundsFils)" "0 $(( RF - RG ))" "reconciliation $D: gap 0, netted refunds line"
else echo "SKIP  local stack only (demo-only SQL); proof: go test ./internal/settlement/ -run NetsRefundIntoPayout -v"; fi

echo; [ "$FAILS" = 0 ] && echo "demo: ALL CHECKS PASSED against $BASE_URL" || { echo "demo: $FAILS check(s) FAILED"; exit 1; }
