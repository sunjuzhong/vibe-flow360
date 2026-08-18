#!/bin/sh

set -eu

binary=${1:?usage: restart-serve.sh BINARY ENV_FILE ADDRESS}
env_file=${2:?usage: restart-serve.sh BINARY ENV_FILE ADDRESS}
address=${3:?usage: restart-serve.sh BINARY ENV_FILE ADDRESS}

for required_command in pgrep ps; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "make serve requires $required_command to restart an existing service" >&2
    exit 1
  fi
done

matching_pids() {
  pgrep -f '[v]ibe-flow360 serve' 2>/dev/null | while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    command=$(ps -p "$pid" -o command= 2>/dev/null || true)
    [ -n "$command" ] || continue
    padded="$command "

    case "$padded" in
      *" --addr $address "*|*" --addr=$address "*)
        printf '%s\n' "$pid"
        ;;
      *" --addr "*|*" --addr="*)
        ;;
      *)
        if [ "$address" = ":9292" ]; then
          printf '%s\n' "$pid"
        fi
        ;;
    esac
  done
}

pids=$(matching_pids)
if [ -n "$pids" ]; then
  echo "Stopping existing Vibe Flow360 service on $address: $(printf '%s' "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true

  attempts=0
  while [ "$attempts" -lt 50 ]; do
    remaining=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        remaining="$remaining $pid"
      fi
    done
    [ -n "$remaining" ] || break
    sleep 0.1
    attempts=$((attempts + 1))
  done

  if [ -n "${remaining:-}" ]; then
    echo "Forcing stale Vibe Flow360 service to stop:$remaining" >&2
    # shellcheck disable=SC2086
    kill -KILL $remaining 2>/dev/null || true
  fi
fi

echo "Starting freshly built Vibe Flow360 service on $address"
exec "$binary" serve --env-file "$env_file" --addr "$address"
