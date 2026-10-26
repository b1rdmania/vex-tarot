#!/usr/bin/env bash
# Run before a party. Checks the live kiosk, the agent machine and every paid service.
# The keys come from agent/.env and .dev.vars. They must match the deployed Fly and Worker secrets.
set -uo pipefail
cd "$(dirname "$0")/.."
KIOSK="https://vex-tarot.andy-ff7.workers.dev"
APP="vex-agent"
export GODEBUG=netdns=go
get() { grep -h "^$1=" "$2" | head -1 | cut -d= -f2- | tr -d '"'; }
ok=0
pass() { printf '  ok    %s\n' "$1"; }
warn() { printf '  FAIL  %s\n' "$1"; ok=1; }

echo "Kiosk"
code=$(get ACCESS_CODE .dev.vars)
s=$(curl -s -o /dev/null -w '%{http_code}' "$KIOSK/?code=$code")
[ "$s" = 200 ] && pass "page loads" || warn "page returned $s"
s=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Vex-Code: $code" "$KIOSK/api/token")
[ "$s" = 200 ] && pass "session token issued" || warn "token returned $s"

echo "Agent machine"
m=$(fly machine list -a "$APP" --json 2>/dev/null)
state=$(echo "$m" | python3 -c 'import json,sys;print(" ".join(x["state"] for x in json.load(sys.stdin)))')
mem=$(echo "$m" | python3 -c 'import json,sys;print(min(x["config"]["guest"]["memory_mb"] for x in json.load(sys.stdin)))')
[ "$state" = started ] && pass "machine started" || warn "machine state: ${state:-none}"
[ "${mem:-0}" -ge 2048 ] && pass "memory ${mem} MB" || warn "memory ${mem:-?} MB; needs 2048 (fly.agent.toml)"
since=$(echo "$m" | python3 -c 'import json,sys;print(max(x["updated_at"] for x in json.load(sys.stdin)))')
# Only lines since the machine last (re)started; older kills were before the current deploy.
logs=$(perl -e 'alarm 30; exec @ARGV' fly logs -a "$APP" --no-tail 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | awk -v t="$since" '$1 >= t')
n=$(echo "$logs" | grep -c "Out of memory")
[ "$n" = 0 ] && pass "no out-of-memory kills since $since" || warn "$n out-of-memory kills since $since"
echo "$logs" | grep -q "registered worker" && pass "worker registered with LiveKit" || echo "  ?     no 'registered worker' line in recent logs (normal if it started long ago)"

echo "Services"
el=$(curl -s https://api.elevenlabs.io/v1/user/subscription -H "xi-api-key: $(get ELEVENLABS_KEY agent/.env)")
left=$(echo "$el" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["character_limit"]-d["character_count"])' 2>/dev/null)
# About 1,500 characters a reading.
[ "${left:-0}" -ge 30000 ] && pass "ElevenLabs: $left characters left (~$((left / 1500)) readings)" || warn "ElevenLabs: ${left:-unknown} characters left"
or=$(curl -s https://openrouter.ai/api/v1/credits -H "Authorization: Bearer $(get OPENROUTER_KEY agent/.env)")
cr=$(echo "$or" | python3 -c 'import json,sys;d=json.load(sys.stdin)["data"];print(round(d["total_credits"]-d["total_usage"],2))' 2>/dev/null)
python3 -c "import sys;sys.exit(0 if float('${cr:-0}')>=5 else 1)" && pass "OpenRouter: \$$cr credit" || warn "OpenRouter: \$${cr:-unknown} credit"
# The key has no billing scope, so transcribe a test clip instead. A clip that comes back as words proves key and credit.
words=$(curl -s "https://api.deepgram.com/v1/listen?model=nova-3&language=en-GB" -H "Authorization: Token $(get DEEPGRAM_API_KEY agent/.env)" -H "Content-Type: audio/wav" --data-binary @test/question.wav | python3 -c 'import json,sys;print(json.load(sys.stdin)["results"]["channels"][0]["alternatives"][0]["transcript"])' 2>/dev/null)
[ -n "$words" ] && pass "Deepgram transcribes (\"${words:0:40}...\")" || warn "Deepgram transcription failed"
echo
[ $ok = 0 ] && echo "Ready." || echo "Fix the FAIL lines before the party."
exit $ok
