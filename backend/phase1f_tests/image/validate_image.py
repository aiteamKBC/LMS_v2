"""Verify installed application versions against reviewed constraints, offline."""
import json
from pathlib import Path
import re
import subprocess

def canonical(name):
    return re.sub(r'[-_.]+', '-', name).lower()

pins = dict(line.split('==') for line in Path(__file__).with_name('constraints.txt').read_text().splitlines() if line.strip())
pins = {canonical(name): version for name, version in pins.items()}
base = ['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL',
        'lms-phase1f-python:3.14.3','-I']
subprocess.run([*base,'-m','pip','check'], check=True)
code = "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name']:d.version for d in m.distributions()}))"
result = subprocess.run([*base,'-c',code], capture_output=True, text=True, check=True)
installed = json.loads(result.stdout)
packages = {name:version for name,version in installed.items() if canonical(name) not in {'pip','setuptools'}}
assert all(pins.get(canonical(name)) == version for name,version in packages.items()), packages
assert all(canonical(name) in {canonical(n) for n in installed} for name in
           ('azure-core','azure-storage-blob','httpx','lxml','Django','psycopg','pymupdf'))
print('PASS:',len(packages),'application packages match project pins')
