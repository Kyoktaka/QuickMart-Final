#!/usr/bin/env python3
"""Run the repository's portable checks without contacting physical hardware."""
import argparse
import ast
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*args):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', action='store_true', help='Also test disposable MySQL databases using QUICKMART_TEST_DSN.')
    options = parser.parse_args()
    for command in ('php', 'node'):
        if shutil.which(command) is None:
            parser.error(command + ' must be installed and available on PATH.')
    sources = [p for folder in ('api', 'config', 'includes', 'js', 'assets/js', 'tools', 'tests', 'rfid-bridge')
               for p in (ROOT / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    for path in sorted(sources):
        if path.suffix == '.php':
            run('php', '-l', path.relative_to(ROOT))
        elif path.suffix == '.js':
            run('node', '--check', path.relative_to(ROOT))
        elif path.suffix == '.py':
            ast.parse(path.read_text(encoding='utf-8-sig'), filename=str(path))
    run('php', 'tests/demo-qr.php')
    run('php', 'tests/product-description-contract.php')
    for path in sorted((ROOT / 'tests').glob('*.js')):
        run('node', path.relative_to(ROOT))
    run(sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py')
    if options.database:
        if not os.getenv('QUICKMART_TEST_DSN'):
            parser.error('--database requires an explicit QUICKMART_TEST_DSN; no application database is used by default.')
        run('php', 'tests/database-integration.php')
        run('php', 'tests/backend-integration.php')
    print('All requested automated checks passed. Physical RFID, camera, and SMTP delivery remain manual checks.')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode) from error
