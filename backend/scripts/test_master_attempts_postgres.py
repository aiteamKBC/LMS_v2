"""Start a fresh guarded cluster and execute the existing attempt persistence suite."""
from pathlib import Path
import socket
import subprocess
import tempfile

import test_subject_attempts_isolated_postgres as attempts


def main():
    directory = Path(tempfile.mkdtemp(prefix='kbc_attempts_')).resolve()
    binaries = Path('C:/Program Files/PostgreSQL/18/bin')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    subprocess.run([str(binaries / 'initdb.exe'), '-D', str(directory), '-U', 'postgres',
                    '--auth=trust', '--encoding=UTF8', '--no-locale'], check=True, capture_output=True)
    with (directory / 'control.log').open('w') as log:
        subprocess.run([str(binaries / 'pg_ctl.exe'), '-D', str(directory), '-l', str(directory / 'server.log'),
                        '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start'], check=True, stdout=log, stderr=log)
        try:
            schema = attempts.development_schema()
            config = attempts.prepare(port, directory, schema)
            success = attempts.run(config)
            if attempts.development_schema() != schema:
                raise AssertionError('Development attempt fingerprint changed.')
            return int(not success)
        finally:
            subprocess.run([str(binaries / 'pg_ctl.exe'), '-D', str(directory), '-m', 'fast', '-w', 'stop'],
                           check=True, stdout=log, stderr=log)


if __name__ == '__main__':
    raise SystemExit(main())
