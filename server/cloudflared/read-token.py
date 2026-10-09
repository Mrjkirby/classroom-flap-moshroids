"""Hidden terminal input and syntax validation only; no Cloudflare authentication."""
import base64
import binascii
import json
import os
import re
import select
import sys
import termios


def validate_input(raw):
    # Bracketed paste markers are terminal framing, not credential characters.
    if raw.startswith(b'\x1b[200~') and raw.endswith(b'\x1b[201~'):
        raw = raw[6:-6]
    if not raw:
        raise ValueError('Empty input; nothing saved.')
    if any(chr(c).isspace() for c in raw):
        raise ValueError('Whitespace or multiline input rejected; nothing saved.')
    if not re.fullmatch(rb'eyJ[A-Za-z0-9+/]*={0,2}', raw) or not 32 <= len(raw) <= 4096:
        raise ValueError('Expected only a Cloudflare tunnel token, not a Docker command or terminal controls; nothing saved.')
    try:
        value = json.loads(base64.b64decode(raw, validate=True))
        if not isinstance(value, dict) or not all(isinstance(value.get(k), str) and value[k] for k in ('a', 't', 's')):
            raise ValueError()
    except (ValueError, binascii.Error, UnicodeError):
        raise ValueError('Invalid Cloudflare token envelope; nothing saved.') from None
    return raw


def read_terminal():
    terminal = os.open('/dev/tty', os.O_RDWR)
    previous = termios.tcgetattr(terminal)
    settings = termios.tcgetattr(terminal)
    settings[3] &= ~(termios.ECHO | termios.ICANON)
    settings[6][termios.VMIN] = 1
    settings[6][termios.VTIME] = 0
    raw = b''
    try:
        termios.tcsetattr(terminal, termios.TCSANOW, settings)
        os.write(terminal, b'Paste ONLY the Astroids-KNAS tunnel token (hidden), then Enter: ')
        while True:
            char = os.read(terminal, 1)
            if not char:
                raise ValueError('Input interrupted; nothing saved.')
            if char == b'\n':
                # Reject a multiline paste, rather than saving just its first line.
                while select.select([terminal], [], [], 0.15)[0]:
                    raw += b'\n' + os.read(terminal, 4096)
                    if len(raw) > 8192:
                        break
                break
            raw += char
            if len(raw) > 8192:
                raise ValueError('Input too long; nothing saved.')
        return validate_input(raw)
    finally:
        termios.tcsetattr(terminal, termios.TCSANOW, previous)
        os.write(terminal, b'\n')
        os.close(terminal)


if __name__ == '__main__':
    try:
        # The shell captures stdout privately; nothing is echoed to the terminal.
        sys.stdout.buffer.write(read_terminal())
    except (ValueError, OSError) as error:
        print(str(error) if isinstance(error, ValueError) else 'Terminal unavailable; nothing saved.', file=sys.stderr)
        sys.exit(1)
