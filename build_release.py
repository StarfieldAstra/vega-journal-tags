"""Validate and package the standalone public edition; no browser installation changes."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile

SOURCE = Path(__file__).resolve().parent
EXTENSION = SOURCE / 'extension'
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', type=Path, default=SOURCE / 'release')
OUT = parser.parse_args().output_dir.resolve()
if OUT == SOURCE:
    raise RuntimeError('Output directory must differ from source directory')
OUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((EXTENSION / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise RuntimeError('Invalid release version')
package = OUT / ('vega-journal-tags-v' + version + '.zip')
source_package = OUT / ('vega-journal-tags-source-v' + version + '.zip')
if package.exists() or source_package.exists():
    raise RuntimeError('Archive already exists; increase the version rather than overwrite it.')
if manifest.get('permissions') != ['storage']:
    raise RuntimeError('Unexpected extension permissions')
refs = [manifest['background']['service_worker'], manifest['action']['default_popup']]
for entry in manifest['content_scripts']:
    refs.extend(entry.get('js', []))
    refs.extend(entry.get('css', []))
for entry in manifest['web_accessible_resources']:
    refs.extend(entry['resources'])
for rel in refs:
    file = (EXTENSION / rel).resolve()
    if EXTENSION.resolve() not in file.parents or not file.is_file():
        raise RuntimeError('Missing or invalid extension resource: ' + rel)
for file in EXTENSION.rglob('*'):
    if file.is_symlink():
        raise RuntimeError('Unexpected extension symlink')
    if file.suffix == '.js':
        subprocess.run(['node', '--check', str(file)], check=True)
data = json.loads((EXTENSION / 'data/journals.json').read_text(encoding='utf-8'))
allowed_fields = {'n', 'i', 'j', 'c', 'd', 'b', 'z', 'M', 'W', 'T', 'w', 'y'}
allowed_sources = {'cssci', 'cscd', 'beike', 'cas', 'warning'}
if set(data['meta']['sources']) != allowed_sources:
    raise RuntimeError('Unexpected dataset source')
for record in data['journals'].values():
    if set(record) - allowed_fields:
        raise RuntimeError('Unexpected dataset field')
subprocess.run(['node', str(SOURCE / 'test_judge.js')], check=True)

direct = OUT / '直接可用版'
if direct.exists() and (not direct.is_dir() or direct.is_symlink()):
    raise RuntimeError('Invalid distribution directory')
extension_files = [file for file in EXTENSION.rglob('*') if file.is_file()]
if direct.exists():
    if any(file.is_symlink() for file in direct.rglob('*')):
        raise RuntimeError('Unexpected distribution symlink')
    extras = {file.relative_to(direct) for file in direct.rglob('*') if file.is_file()} - {file.relative_to(EXTENSION) for file in extension_files}
    if extras:
        raise RuntimeError('Unreviewed files in distribution directory')
for file in extension_files:
    rel = file.relative_to(EXTENSION)
    dest = direct / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file, dest)
    if dest.read_bytes() != file.read_bytes():
        raise RuntimeError('Copy mismatch: ' + str(rel))
with zipfile.ZipFile(package, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in extension_files:
        archive.write(file, file.relative_to(EXTENSION).as_posix())
with zipfile.ZipFile(package) as archive:
    if 'manifest.json' not in archive.namelist():
        raise RuntimeError('Manifest missing from archive root')
    for file in extension_files:
        rel = file.relative_to(EXTENSION).as_posix()
        if archive.read(rel) != file.read_bytes():
            raise RuntimeError('Archive mismatch: ' + rel)
with zipfile.ZipFile(source_package, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in SOURCE.rglob('*'):
        if not file.is_file() or any(part in file.parts for part in ['__pycache__', '.git']):
            continue
        if OUT.is_relative_to(SOURCE) and file.is_relative_to(OUT):
            continue
        archive.write(file, file.relative_to(SOURCE).as_posix())
sum_lines = []
for file in [package, source_package]:
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    sum_lines.append(digest + '  ' + file.name)
(OUT / 'SHA256SUMS.txt').write_text('\n'.join(sum_lines) + '\n', encoding='utf-8')
print('Packaged public extension and source; verified', len(extension_files), 'installation files.')
print('\n'.join(sum_lines))
