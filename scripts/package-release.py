#!/usr/bin/env python3
"""Build and cross-check matching source/VSIX archives. No network or Git required."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
RELEASE = f"{PACKAGE['name']}-{PACKAGE['version']}"
DIST = ROOT / 'dist'
FOLDERS = ('.vscode', 'src', 'media', 'integration', 'examples', 'scripts', 'test')
ROOT_FILES = ('.gitignore', '.vscodeignore', 'package.json', 'LICENSE')


def source_files():
    paths = [ROOT / name for name in ROOT_FILES]
    paths.extend(ROOT.glob('*.md'))
    for folder in FOLDERS:
        paths.extend((ROOT / folder).rglob('*'))
    result = []
    for file in sorted(set(paths)):
        if '__pycache__' in file.parts or file.suffix in ('.pyc', '.pyo'):
            continue
        if file.is_symlink():
            raise RuntimeError(f'Release inputs may not be symlinks: {file}')
        if file.is_file():
            result.append(file)
    return result


def package_source(files):
    target = DIST / f'{RELEASE}-source.zip'
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for file in files:
            # Stable timestamps make unchanged rebuilds byte-identical.
            name = f'{RELEASE}/{file.relative_to(ROOT).as_posix()}'
            data = file.read_bytes()
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100755 if data.startswith(b'#!') else 0o100644) << 16
            archive.writestr(info, data)
    return target


def validate(vsix, source, files):
    with ZipFile(vsix) as extension, ZipFile(source) as code:
        if extension.testzip() or code.testzip():
            raise RuntimeError('An archive failed its CRC integrity check.')
        names = set(extension.namelist())
        shipped = json.loads(extension.read('extension/package.json'))
        if shipped != PACKAGE:
            raise RuntimeError('VSIX package.json differs from source.')
        xml = ET.fromstring(extension.read('extension.vsixmanifest'))
        identity = xml.find('{*}Metadata/{*}Identity')
        if identity is None or identity.attrib['Version'] != PACKAGE['version']:
            raise RuntimeError('VSIX manifest version differs from package.json.')
        expected = {f'{RELEASE}/{file.relative_to(ROOT).as_posix()}' for file in files}
        if set(code.namelist()) != expected:
            raise RuntimeError('Source archive contains unexpected or missing files.')
        for file in files:
            relative = file.relative_to(ROOT).as_posix()
            original = file.read_bytes()
            if code.read(f'{RELEASE}/{relative}') != original:
                raise RuntimeError(f'Source byte mismatch: {relative}')
            if relative.startswith(('src/', 'media/', 'integration/')):
                if f'extension/{relative}' not in names:
                    raise RuntimeError(f'Runtime file missing from VSIX: {relative}')
                if extension.read(f'extension/{relative}') != original:
                    raise RuntimeError(f'Runtime byte mismatch: {relative}')
        for name in names:
            if name.startswith('extension/'):
                relative = name[len('extension/'):]
                if relative.startswith(('test/', 'scripts/', 'examples/', 'dist/', 'reports/')):
                    raise RuntimeError(f'Development/build file leaked into VSIX: {relative}')
            if not name.startswith('extension/src/') or not name.endswith('.js'):
                continue
            text = extension.read(name).decode('utf-8')
            for dependency in re.findall(r"require\(['\"](\.{1,2}/[^'\"]+)['\"]\)", text):
                resolved = (ROOT / name[len('extension/'):]).parent.joinpath(dependency).resolve()
                candidates = (resolved, Path(str(resolved) + '.js'), Path(str(resolved) + '.json'), resolved / 'index.js')
                if not any(
                    candidate.is_relative_to(ROOT)
                    and f'extension/{candidate.relative_to(ROOT).as_posix()}' in names
                    for candidate in candidates
                ):
                    raise RuntimeError(f'Unpackaged local import: {name} -> {dependency}')
        return len(files), len([name for name in names if name.startswith('extension/')])


def main():
    DIST.mkdir(exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / 'scripts/package-vsix.py')], cwd=ROOT, check=True)
    files = source_files()
    vsix = DIST / f'{RELEASE}.vsix'
    source = package_source(files)
    source_count, extension_count = validate(vsix, source, files)
    checksums = DIST / 'SHA256SUMS'
    checksums.write_text(''.join(
        f'{sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in (vsix, source)
    ), encoding='utf-8')
    print(f'{source} ({source.stat().st_size:,} bytes; {source_count} source files)')
    print(f'Validated: {extension_count} VSIX files, source/runtime byte equality, local imports, manifest, ZIP integrity.')
    print(f'Checksums: {checksums}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Release failed: {error}', file=sys.stderr)
        sys.exit(1)
