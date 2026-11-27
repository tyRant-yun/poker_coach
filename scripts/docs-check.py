"""Check current repository docs and immutable archive manifests; no network."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
from urllib.parse import unquote

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
names = set(subprocess.check_output(
    ['git', 'ls-files', '-c', '-o', '--exclude-standard'], cwd=root, text=True
).splitlines())
names = {n for n in names if (root / n).is_file()}
errors = []
links = 0
documents = 0
commands = set()
inline = re.compile(r'!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\)')

for name in sorted(names):
    if not name.endswith('.md'):
        continue
    historical = (name.startswith('docs/archive/') and not name.endswith('/README.md')) or (
        name.startswith('reports/') and name != 'reports/README.md'
    )
    if historical:
        continue
    documents += 1
    text = (root / name).read_text(encoding='utf-8-sig')
    commands.update(re.findall(r'\bnpm run ([\w:-]+)', text))
    text = re.sub(r'```[\s\S]*?```', '', text)
    for match in inline.finditer(text):
        target = match[1].strip('<>')
        if not target or target.startswith(('#', '//')) or re.match(r'^[a-zA-Z][\w+.-]*:', target):
            continue
        part = unquote(target.split('#')[0].split('?')[0])
        resolved = (root / name).parent / part if not part.startswith('/') else root / part.lstrip('/')
        resolved = resolved.resolve()
        links += 1
        if not resolved.is_relative_to(root):
            errors.append(f'{name}: link escapes repository: {target}')
            continue
        dest = resolved.relative_to(root).as_posix()
        if dest not in names and not any(n.startswith(dest.rstrip('/') + '/') for n in names):
            errors.append(f'{name}: missing tracked/local document target: {target}')

package = root / 'package.json'
if package.exists():
    scripts = json.loads(package.read_text())['scripts']
    for command in commands:
        if command not in scripts:
            errors.append(f'unknown npm script in current docs: {command}')

archives = 0
for manifest in sorted((root / 'docs/archive').glob('*/manifest.json')):
    record = json.loads(manifest.read_text(encoding='utf-8'))
    for item in record['records']:
        archived = (root / item['archivePath']).resolve()
        if not archived.is_relative_to(root) or not archived.is_file():
            errors.append(f'missing/unsafe archive: {item["archivePath"]}')
            continue
        if hashlib.sha256(archived.read_bytes()).hexdigest() != item['archiveSha256']:
            errors.append(f'archive changed after inventory: {item["archivePath"]}')
        original = subprocess.check_output(
            ['git', 'show', item['sourceCommit'] + ':' + item['oldPath']], cwd=root
        )
        if hashlib.sha256(original).hexdigest() != item['originalGitSha256']:
            errors.append(f'original Git provenance differs: {item["oldPath"]}')
        archives += 1

print(json.dumps({'repository': root.name, 'currentDocumentsAndIndexes': documents,
                  'localLinksChecked': links, 'archiveRecordsVerified': archives,
                  'npmCommandsChecked': len(commands) if package.exists() else 0,
                  'errors': errors}, ensure_ascii=False))
raise SystemExit(bool(errors))
