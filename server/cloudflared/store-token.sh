#!/bin/sh
# Owner-operated terminal helper. Never pass the credential as an argument.
set -eu
set +x
umask 077
token_directory=${1:-"$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/secrets"}
token_file=$token_directory/tunnel-token
if [ -e "$token_file" ] || [ -L "$token_file" ]; then
  printf 'Credential already exists; refusing to overwrite it.\n' >&2
  exit 1
fi
if ! terminal_state=$(stty -g </dev/tty 2>/dev/null); then
  printf 'Run this helper in your own interactive terminal (SSH -t).\n' >&2
  exit 1
fi
cleanup() {
  stty "$terminal_state" </dev/tty 2>/dev/null || :
  unset tunnel_token
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
stty -echo </dev/tty
printf 'Paste ONLY the Astroids-KNAS tunnel token (hidden), then Enter: ' >/dev/tty
IFS= read -r tunnel_token </dev/tty
stty "$terminal_state" </dev/tty
printf '\n' >/dev/tty
case "$tunnel_token" in
  ''|*[!A-Za-z0-9_+/=-]*) printf 'Invalid token format; nothing saved.\n' >&2; exit 1 ;;
esac
if [ "${#tunnel_token}" -lt 32 ] || [ "${#tunnel_token}" -gt 4096 ]; then
  printf 'Invalid token length; nothing saved.\n' >&2
  exit 1
fi
mkdir -p "$token_directory"
chmod 700 "$token_directory"
# Noclobber also protects against another process creating the file after check.
set -C
printf '%s' "$tunnel_token" >"$token_file"
unset tunnel_token
chmod 600 "$token_file"
printf 'Tunnel credential saved privately. No container started.\n'
