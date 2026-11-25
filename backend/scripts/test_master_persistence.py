"""Reuse the reviewed persistence harness with fresh database names/output files.

The original safety checks, PostgreSQL fixture adapters and assertions are kept.
The harness verifies its configured cluster directory before any CREATE DATABASE.
"""
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
source_path = ROOT / '.local/backend-verification-20261124/run_cleanup_persistence.py'
source = source_path.read_text(encoding='utf-8')
source = source.replace("name = 'persistence_cleanup_' + args.group",
                        "name = 'master_persistence_" + uuid4().hex[:12] + "_' + args.group")
source = source.replace("(directory/('cleanup-'+args.group+'-result.json'))",
    "(directory.parents[1]/'specs/lms-master-completion'/('persistence-'+args.group+'.json'))")
exec(compile(source, str(source_path), 'exec'), {'__name__': '__main__', '__file__': str(source_path)})
