"""Install only the frozen policy core from a verified local source release."""
from pathlib import Path
import hashlib
import json
import sys
from zipfile import ZipFile

source=Path(sys.argv[1]) / '.work/hu-v2-strength-v2.2.2/dist'
archive=source/'hu-bot-v2.2.2-final-r9-source.zip'
expected='14d7fd7605df3063e8df2b18b51d63e185aeeee0fafa534ec4a8a0b1586ffd34'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:
    raise ValueError('Frozen HU source archive hash differs')
target=Path('.data/bots/hu-v2.2.2-m1')
files={}
with ZipFile(archive) as z:
    for name in ['__init__.py','poker.py','v2_contracts.py','v2_policy.py','v2_runtime.py']:
        data=z.read('submission/hu_bot/'+name)
        path=target/'hu_bot'/name
        path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists() and path.read_bytes()!=data:
            raise ValueError('Installed frozen source changed: '+name)
        path.write_bytes(data)
        files['hu_bot/'+name]=hashlib.sha256(data).hexdigest()
manifest={'id':'hu-v2.2.2-experimental','version':'2.2.2-final-r9','contract':'riverline-bot/1','sourceArchiveSha256':expected,'files':files,'strategyStatus':'experimental-model-limited','strengthVerified':False}
(target/'manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest))
