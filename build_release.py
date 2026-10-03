"""Build the single edition with school grades; runtime and source are verified."""
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
SOURCE_NAMES = ['README.md', 'INSTALL.md', 'PRIVACY.md', 'RELEASE_NOTES.md',
                'HANDOVER.md', 'LICENSE', 'validate.js', 'test_judge.js',
                'test_sites.js', 'test_extension.js', 'test_settings.js',
                'test_background.js', 'build_release.py', 'build_release.js',
                'tools/build_themes.js']

def selected_source_files():
    return sorted([file for file in EXTENSION.rglob('*') if file.is_file()] +
                  [SOURCE / name for name in SOURCE_NAMES], key=lambda file: file.as_posix())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=SOURCE / 'release')
    out = parser.parse_args().output_dir.resolve()
    if out == SOURCE or out.is_relative_to(EXTENSION):
        raise RuntimeError('Output must not overwrite source or extension')
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((EXTENSION / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+', version)
    packages = [out / f'vega-journal-tags-v{version}.zip',
                out / f'vega-journal-tags-source-v{version}.zip']
    if any(package.exists() for package in packages):
        raise RuntimeError('Version archives already exist; increase the version or select a new output directory.')
    assert manifest['permissions'] == ['storage', 'activeTab', 'scripting']
    assert 'default_popup' not in manifest['action']
    data = json.loads((EXTENSION / 'data/journals.json').read_text(encoding='utf-8'))
    assert data['meta']['version'] == version
    assert set(data['meta']['sources']) == {'cssci', 'cscd', 'beike', 'cas', 'warning', 'sxufe'}
    allowed = {'n', 'i', 'j', 'c', 'd', 'b', 'z', 'M', 'W', 'T', 'w', 'y', 's'}
    assert all(not (set(record) - allowed) for record in data['journals'].values())
    assert len(data['journals']) == 24354
    assert sum(bool(record.get('s')) for record in data['journals'].values()) == 2261
    for name in ['validate.js', 'test_judge.js', 'test_sites.js', 'test_background.js']:
        subprocess.run(['node', str(SOURCE / name)], check=True)
    runtime_files = sorted([file for file in EXTENSION.rglob('*') if file.is_file()])
    source_files = selected_source_files()
    assert all(file.is_file() and not file.is_symlink() for file in source_files)
    direct = out / '直接可用版'
    if direct.exists():
        assert direct.is_dir() and not direct.is_symlink()
        assert not any(file.is_symlink() for file in direct.rglob('*'))
        extras = {file.relative_to(direct) for file in direct.rglob('*') if file.is_file()} - {file.relative_to(EXTENSION) for file in runtime_files}
        assert not extras, 'Unreviewed files in distribution'
    for file in runtime_files:
        if file.suffix == '.js':
            subprocess.run(['node', '--check', str(file)], check=True)
        dest = direct / file.relative_to(EXTENSION)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, dest)
        assert dest.read_bytes() == file.read_bytes()
    for package, files, base in [(packages[0], runtime_files, EXTENSION), (packages[1], source_files, SOURCE)]:
        with zipfile.ZipFile(package, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for file in files:
                archive.write(file, file.relative_to(base).as_posix())
        with zipfile.ZipFile(package) as archive:
            assert len(archive.namelist()) == len(files)
            for file in files:
                assert archive.read(file.relative_to(base).as_posix()) == file.read_bytes()
    sums = '\n'.join(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name for file in packages) + '\n'
    (out / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8')
    print('Unified school-grade edition packaged and verified:', version, len(runtime_files), 'runtime files.')
    print(sums, end='')

if __name__ == '__main__':
    main()
