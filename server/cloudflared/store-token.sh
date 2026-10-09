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
tunnel_token=$(python3 "$(dirname -- "$0")/read-token.py")
stty "$terminal_state" </dev/tty
mkdir -p "$token_directory"
chmod 700 "$token_directory"
# Noclobber also protects against another process creating the file after check.
set -C
printf '%s' "$tunnel_token" >"$token_file"
unset tunnel_token
chmod 600 "$token_file"
printf 'Tunnel credential saved privately. No container started.\n'
