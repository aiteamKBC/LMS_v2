"""Portable runner: two fresh, empty loopback databases; never production."""
import argparse,json,os,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--postgres-config');p.add_argument('--install-config');p.add_argument('--report-path');a=p.parse_args()
root=Path(__file__).resolve().parent
configs=[a.postgres_config,a.install_config]
identities=[]
for config in configs:
 if config:
  c=json.loads(Path(config).read_text(encoding='utf-8-sig'))
  if c.get('host')!='127.0.0.1' or not c.get('dbname','').startswith('kbc_rewards_test_'):raise SystemExit('Only isolated loopback databases are accepted.')
  identities.append((c['host'],str(c['port']),c['dbname']))
if len(identities)==2 and identities[0]==identities[1]:raise SystemExit('Use two different fresh databases.')
jobs=[('facade',root,['-m','unittest','discover','-s','.','-p','test_mobile*contract.py','-q'],None)]
if all(configs):
 jobs += [('rewards',root,['-m','unittest','test_postgres_rewards','-q'],a.postgres_config),('install',root,['-m','unittest','test_install_commands','-q'],a.install_config)]
results=[]
for name,cwd,args,config in jobs:
 env=dict(os.environ)
 for key in list(env):
  if key.startswith('PG') or key in ('DATABASE_URL','DJANGO_SETTINGS_MODULE','KBC_REWARDS_TEST_CONNECTION_FILE'):env.pop(key,None)
 if config:env['KBC_REWARDS_TEST_CONNECTION_FILE']=str(Path(config).resolve())
 r=subprocess.run([sys.executable,*args],cwd=cwd,env=env,capture_output=True,text=True,timeout=180)
 results.append({'suite':name,'exit':r.returncode,'output':r.stdout+r.stderr});print(name,r.returncode,r.stdout+r.stderr)
 if r.returncode:break
receipt={'status':'PASS' if len(results)==3 and all(x['exit']==0 for x in results) else 'INCOMPLETE_OR_FAILED','results':results}
if a.report_path:Path(a.report_path).write_text(json.dumps(receipt,indent=2),encoding='utf-8')
raise SystemExit(0 if receipt['status']=='PASS' else 1)
