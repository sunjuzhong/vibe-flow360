#!/bin/sh

set -eu

binary=${1:?usage: restart-serve.sh BINARY ENV_FILE ADDRESS}
env_file=${2:?usage: restart-serve.sh BINARY ENV_FILE ADDRESS}
address=${3:?usage: restart-serve.sh BINARY ENV_FILE ADDRESS}

if ! command -v lsof >/dev/null 2>&1; then
  echo "make serve requires lsof to restart an existing service" >&2
  exit 1
fi

port=${address##*:}
case "$port" in
  ''|*[!0-9]*)
    echo "make serve cannot determine the TCP port from address: $address" >&2
    exit 1
    ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "make serve received an invalid TCP port in address: $address" >&2
  exit 1
fi

listener_pids() {
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

process_name() {
  lsof -a -p "$1" -Fc 2>/dev/null | sed -n 's/^c//p' | head -1
}

validate_vibe_listeners() {
  for pid in $1; do
    name=$(process_name "$pid")
    case "$name" in
      vibe-flow360|vibe-flow)
        ;;
      *)
        echo "Cannot restart Vibe Flow360: $address is owned by $name (PID $pid)" >&2
        exit 1
        ;;
    esac
  done
}

stop_listeners() {
  pids=$1
  validate_vibe_listeners "$pids"
  echo "Stopping existing Vibe Flow360 service on $address: $(printf '%s' "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true

  attempts=0
  while [ "$attempts" -lt 50 ]; do
    remaining=$(listener_pids)
    [ -n "$remaining" ] || return 0
    validate_vibe_listeners "$remaining"
    sleep 0.1
    attempts=$((attempts + 1))
  done

  echo "Forcing stale Vibe Flow360 listener on $address to stop: $(printf '%s' "$remaining" | tr '\n' ' ')" >&2
  # shellcheck disable=SC2086
  kill -KILL $remaining 2>/dev/null || true
}

# A quiet interval also catches an older invocation that was already waiting
# to take over the port and binds it shortly after the first listener exits.
quiet_checks=0
stop_cycles=0
while [ "$quiet_checks" -lt 12 ]; do
  pids=$(listener_pids)
  if [ -n "$pids" ]; then
    stop_cycles=$((stop_cycles + 1))
    if [ "$stop_cycles" -gt 10 ]; then
      echo "Cannot keep $address free; another service is repeatedly restarting" >&2
      exit 1
    fi
    stop_listeners "$pids"
    quiet_checks=0
  else
    quiet_checks=$((quiet_checks + 1))
  fi
  sleep 0.1
done

if [ -n "$(listener_pids)" ]; then
  echo "Cannot restart Vibe Flow360 because $address is still in use" >&2
  exit 1
fi

echo "Starting freshly built Vibe Flow360 service on $address"
exec "$binary" serve --env-file "$env_file" --addr "$address"
