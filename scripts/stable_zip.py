"""Zip entries with fixed timestamps and permissions, so unchanged rebuilds are byte-identical."""
import zipfile


def write_entry(archive, name, data):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    executable = isinstance(data, bytes) and data.startswith(b'#!')
    info.external_attr = (0o100755 if executable else 0o100644) << 16
    archive.writestr(info, data)
