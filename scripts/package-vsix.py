#!/usr/bin/env python3
"""Create a local unsigned VSIX using only Python's standard library."""
from pathlib import Path
from xml.sax.saxutils import escape
import json
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
pkg = json.loads((root / 'package.json').read_text(encoding='utf-8'))
(root / 'dist').mkdir(exist_ok=True)
output = root / 'dist' / f"{pkg['name']}-{pkg['version']}.vsix"
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{escape(pkg['name'])}" Version="{escape(pkg['version'])}" Publisher="{escape(pkg['publisher'])}" />
    <DisplayName>{escape(pkg['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(pkg['description'])}</Description>
    <Tags>comments,context,diff,agents,mcp</Tags>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(pkg['engines']['vscode'])}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
    </Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
'''
content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="mdc" ContentType="text/plain" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="comment" ContentType="text/plain" />
  <Default Extension="ts" ContentType="text/plain" />
  <Default Extension="tsx" ContentType="text/plain" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Override PartName="/extension/LICENSE" ContentType="text/plain" />
</Types>
'''
ET.fromstring(manifest)
ET.fromstring(content_types)
files = [root / 'package.json', root / 'README.md', root / 'LICENSE']
for folder in ['src', 'media', 'integration']:
    files.extend(path for path in (root / folder).rglob('*') if path.is_file())
files.extend(root / name for name in ['FORMAT.md', 'SECURITY.md'] if (root / name).exists())
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, value in [('extension.vsixmanifest', manifest), ('[Content_Types].xml', content_types)]:
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, value)
    for file in sorted(files):
        if file.is_symlink():
            raise RuntimeError(f'Refusing a symlink in the release: {file}')
        data = file.read_bytes()
        info = zipfile.ZipInfo(
            f"extension/{file.relative_to(root).as_posix()}", date_time=(1980, 1, 1, 0, 0, 0)
        )
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (0o100755 if data.startswith(b'#!') else 0o100644) << 16
        archive.writestr(info, data)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    stored = json.loads(archive.read('extension/package.json'))
    assert f"extension/{stored['main'].removeprefix('./')}" in archive.namelist()
print(f'{output} ({output.stat().st_size:,} bytes; {len(files)} extension files)')
