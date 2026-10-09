"""Synthetic terminal fixture only; never run this with a real tunnel token."""
import errno
import json
import os
import pty
import select
import signal
import sys
import time

token = sys.stdin.read()
pid, terminal = pty.fork()
if pid == 0:
    os.execl('/bin/sh', 'sh', sys.argv[1], sys.argv[2])

output = b''
sent = False
deadline = time.monotonic() + 4
try:
    while time.monotonic() < deadline:
        if not select.select([terminal], [], [], 0.1)[0]:
            continue
        try:
            chunk = os.read(terminal, 4096)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        output += chunk
        if not sent and b'(hidden), then Enter:' in output:
            os.write(terminal, token.encode() + b'\n')
            sent = True
    else:
        os.kill(pid, signal.SIGKILL)
        raise TimeoutError('Synthetic token terminal timed out')
finally:
    os.close(terminal)
_, status = os.waitpid(pid, 0)
print(json.dumps({'code': os.waitstatus_to_exitcode(status),
                  'output': output.decode(errors='replace')}))
