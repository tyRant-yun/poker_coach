"""Install the pinned core from the standalone Bot repository or legacy archive."""
from pathlib import Path
import hashlib
import json
import sys
from zipfile import ZipFile

source=Path(sys.argv[1])
pinned=json.loads((Path(__file__).resolve().parents[1]/'engines/bot/source.json').read_text(encoding='utf-8'))
expected=pinned['sourceArchiveSha256']
target=Path('.data/bots/hu-v2.2.2-m1')
archive=source/'.work/hu-v2-strength-v2.2.2/dist/hu-bot-v2.2.2-final-r9-source.zip'
if archive.is_file():
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:
        raise ValueError('Frozen HU source archive hash differs')
    with ZipFile(archive) as z:
        payload={name:z.read('submission/'+name) for name in pinned['files']}
else:
    payload={name:(source/'submission'/name).read_bytes() for name in pinned['files']}
# Verify everything before writing, including the standalone repository path.
for name,data in payload.items():
    if hashlib.sha256(data).hexdigest()!=pinned['files'][name]:
        raise ValueError('Pinned HU core hash differs: '+name)
    path=target/name
    if path.exists() and path.read_bytes()!=data:
        raise ValueError('Installed frozen source changed: '+name)
for name,data in payload.items():
    path=target/name
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(data)
manifest=pinned
(target/'manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest))
