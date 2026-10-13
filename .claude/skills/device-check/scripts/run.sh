#!/bin/bash
# Run a dev script on the booted iOS simulator and/or the connected Android emulator,
# then pull the full-resolution render (and a screenshot) back to this Mac.
#
#   run.sh <ios|android|both> '<dev-script json>' [--name NAME] [--timeout SEC]
#   run.sh stop                # stop the Metro and script server this runner started
#
# The JSON is the dev-script format from src/dev/devScript.ts, e.g.
#   '{"sample":"portrait","commands":["make my face brighter"]}'
# "capture" is set to NAME automatically. Results land in $DEVCHECK_DIR
# (default $TMPDIR/kuindzhi-device-check): NAME-<platform>.jpg and NAME-<platform>-screen.png.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
DIR="${DEVCHECK_DIR:-${TMPDIR:-/tmp}/kuindzhi-device-check}"
APP=app.kuindzhi
METRO=8081
SCRIPT_PORT=8099
mkdir -p "$DIR"

listening() { lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
kill_tree() { local c; for c in $(pgrep -P "$1"); do kill_tree "$c"; done; kill "$1" 2>/dev/null || true; }

if [ "${1:-}" = stop ]; then
  for p in metro server; do
    if alive "$DIR/$p.pid"; then kill_tree "$(cat "$DIR/$p.pid")"; fi
    rm -f "$DIR/$p.pid"
  done
  echo "stopped"; exit 0
fi

PLATFORM="${1:?usage: run.sh <ios|android|both> '<json>' [--name NAME] [--timeout SEC]}"
JSON="${2:?missing dev-script json}"
shift 2
NAME=check; TIMEOUT=180
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

python3 -c 'import json,sys; s=json.loads(sys.argv[1]); s["capture"]=sys.argv[2]; open(sys.argv[3],"w").write(json.dumps(s))' \
  "$JSON" "$NAME" "$DIR/demo.json"

# Script server: serves demo.json to the app.
if ! listening $SCRIPT_PORT; then
  python3 -m http.server $SCRIPT_PORT --bind 127.0.0.1 --directory "$DIR" </dev/null >"$DIR/server.log" 2>&1 &
  echo $! >"$DIR/server.pid"
fi

# Metro, with the dev-script URL inlined at bundle time. Never in CI mode (no file watching).
if listening $METRO; then
  alive "$DIR/metro.pid" || echo "note: Metro on :$METRO wasn't started by this runner. If the app ignores the script, stop it and rerun (it must run with EXPO_PUBLIC_DEV_SCRIPT_URL=http://localhost:$SCRIPT_PORT/demo.json)." >&2
else
  # The whole group is redirected so nothing left in the background holds this script's stdout open.
  (cd "$REPO" && exec env -u CI EXPO_PUBLIC_DEV_SCRIPT_URL="http://localhost:$SCRIPT_PORT/demo.json" \
    npx expo start --dev-client --port $METRO --clear) </dev/null >"$DIR/metro.log" 2>&1 &
  echo $! >"$DIR/metro.pid"
  for _ in $(seq 1 90); do curl -s "localhost:$METRO/status" | grep -q running && break; sleep 1; done
  curl -s "localhost:$METRO/status" | grep -q running || { echo "Metro didn't start; see $DIR/metro.log" >&2; exit 1; }
fi

wait_for() { # wait_for <command printing the file size> ; succeeds once the size is stable
  local last=-1 size
  for _ in $(seq 1 "$TIMEOUT"); do
    size=$(eval "$1" 2>/dev/null || true)
    if [ -n "$size" ] && [ "$size" = "$last" ] && [ "$size" -gt 0 ]; then return 0; fi
    last="${size:--1}"; sleep 1
  done
  return 1
}

run_ios() {
  local udid data
  udid=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys; d=[x["udid"] for v in json.load(sys.stdin)["devices"].values() for x in v if x["state"]=="Booted"]; print(d[0] if d else "")')
  [ -n "$udid" ] || { echo "no booted iOS simulator (open -a Simulator, or npm run ios)" >&2; return 1; }
  data=$(xcrun simctl get_app_container "$udid" $APP data 2>/dev/null) || { echo "$APP isn't installed on $udid; run npm run ios once" >&2; return 1; }
  # The dev menu's first-launch onboarding covers the app; mark it done (takes effect after a reboot).
  if [ "$(xcrun simctl spawn "$udid" defaults read $APP EXDevMenuIsOnboardingFinished 2>/dev/null)" != 1 ]; then
    xcrun simctl spawn "$udid" defaults write $APP EXDevMenuIsOnboardingFinished -bool YES
    xcrun simctl shutdown "$udid"; xcrun simctl boot "$udid"; xcrun simctl bootstatus "$udid" -b >/dev/null
  fi
  rm -f "$data/Library/Caches/$NAME.jpg"
  xcrun simctl terminate "$udid" $APP 2>/dev/null || true
  # --initialUrl skips the dev launcher; `simctl openurl` would show a confirmation alert instead.
  xcrun simctl launch "$udid" $APP --initialUrl "http://localhost:$METRO" >/dev/null
  wait_for "stat -f %z '$data/Library/Caches/$NAME.jpg'" || { echo "ios: no capture after ${TIMEOUT}s; see $DIR/metro.log" >&2; return 1; }
  cp "$data/Library/Caches/$NAME.jpg" "$DIR/$NAME-ios.jpg"
  sleep 1; xcrun simctl io "$udid" screenshot "$DIR/$NAME-ios-screen.png" >/dev/null 2>&1 || true
  echo "ios: $DIR/$NAME-ios.jpg  (screen: $DIR/$NAME-ios-screen.png)"
}

run_android() {
  local serial
  serial=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
  [ -n "$serial" ] || { echo "no Android device or emulator (emulator -avd <name>, or npm run android)" >&2; return 1; }
  local a=(adb -s "$serial")
  "${a[@]}" shell pm path $APP >/dev/null 2>&1 || { echo "$APP isn't installed on $serial; run npm run android once" >&2; return 1; }
  "${a[@]}" reverse tcp:$METRO tcp:$METRO >/dev/null
  "${a[@]}" reverse tcp:$SCRIPT_PORT tcp:$SCRIPT_PORT >/dev/null
  "${a[@]}" shell run-as $APP rm -f "cache/$NAME.jpg" 2>/dev/null || true
  "${a[@]}" shell am force-stop $APP
  "${a[@]}" shell am start -a android.intent.action.VIEW \
    -d "kuindzhi://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$METRO" >/dev/null
  wait_for "${a[*]} shell run-as $APP stat -c %s cache/$NAME.jpg | tr -d '\r'" || { echo "android: no capture after ${TIMEOUT}s; see $DIR/metro.log" >&2; return 1; }
  "${a[@]}" exec-out run-as $APP cat "cache/$NAME.jpg" >"$DIR/$NAME-android.jpg"
  sleep 1; "${a[@]}" exec-out screencap -p >"$DIR/$NAME-android-screen.png" 2>/dev/null || true
  echo "android: $DIR/$NAME-android.jpg  (screen: $DIR/$NAME-android-screen.png)"
}

status=0
case "$PLATFORM" in
  ios) run_ios || status=1 ;;
  android) run_android || status=1 ;;
  both) run_ios || status=1; run_android || status=1 ;;
  *) echo "platform must be ios, android or both" >&2; exit 2 ;;
esac
grep -E "\[dev\]|ERROR|Error:" "$DIR/metro.log" 2>/dev/null | tail -5 || true
exit $status
