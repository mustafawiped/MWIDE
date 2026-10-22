"""Prepare one reviewed legacy dependency without running its build backend.

Usage: python scripts/prepare-python-wheels.py ABSOLUTE_WHEEL_DIRECTORY

proxy_tools 0.1.0 has no upstream wheel. Its complete 2,978-byte PyPI sdist
was inspected: setup.py declares one pure-Python package and no dependencies.
This helper only copies the unchanged module and constructs wheel metadata
with the standard library. It never extracts an archive or runs package code.
"""

from __future__ import annotations

import base64
import csv
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import urllib.request
import zipfile


SOURCE_URL = (
    "https://files.pythonhosted.org/packages/f2/cf/"
    "77d3e19b7fabd03895caca7857ef51e4c409e0ca6b37ee6e9f7daa50b642/"
    "proxy_tools-0.1.0.tar.gz"
)
SOURCE_SHA256 = "ccb3751f529c047e2d8a58440d86b205303cf0fe8146f784d1cbcd94f0a28010"
PYPI_URL = "https://pypi.org/pypi/proxy_tools/0.1.0/json"
LICENSE_URL = (
    "https://raw.githubusercontent.com/jtushman/proxy_tools/"
    "db43f1e35d4f90a65c5a4d56d9e9af88212ec6e6/LICENSE.txt"
)
LICENSE_SHA256 = "a428fb8a2e762af3eb0a6edbbb88e9b42ccfee80fd9b423958bcacf9b9abbfe4"
WHEEL_NAME = "proxy_tools-0.1.0-py2.py3-none-any.whl"
DIST_INFO = "proxy_tools-0.1.0.dist-info"
EXPECTED_MEMBERS = {
    "proxy_tools-0.1.0": ("directory", 0),
    "proxy_tools-0.1.0/PKG-INFO": ("file", 437),
    "proxy_tools-0.1.0/proxy_tools": ("directory", 0),
    "proxy_tools-0.1.0/proxy_tools/__init__.py": ("file", 6409),
    "proxy_tools-0.1.0/proxy_tools.egg-info": ("directory", 0),
    "proxy_tools-0.1.0/proxy_tools.egg-info/dependency_links.txt": ("file", 1),
    "proxy_tools-0.1.0/proxy_tools.egg-info/not-zip-safe": ("file", 1),
    "proxy_tools-0.1.0/proxy_tools.egg-info/PKG-INFO": ("file", 437),
    "proxy_tools-0.1.0/proxy_tools.egg-info/SOURCES.txt": ("file", 217),
    "proxy_tools-0.1.0/proxy_tools.egg-info/top_level.txt": ("file", 12),
    "proxy_tools-0.1.0/README.rst": ("file", 1185),
    "proxy_tools-0.1.0/setup.cfg": ("file", 59),
    "proxy_tools-0.1.0/setup.py": ("file", 717),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        raise ValueError("A reviewed package URL redirected unexpectedly.")


def sha256(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def download(url: str, maximum: int) -> bytes:
    if url not in {SOURCE_URL, PYPI_URL, LICENSE_URL}:
        raise ValueError("Only the fixed reviewed source URLs are permitted.")
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": "MWIDE-reviewed-wheel/1.0"})
    with opener.open(request, timeout=30) as response:
        if response.status != 200 or response.url != url:
            raise ValueError("The reviewed source response was unexpected.")
        contents = response.read(maximum + 1)
    if len(contents) > maximum:
        raise ValueError("A reviewed source response exceeded its size limit.")
    return contents


def unpack_reviewed_source(contents: bytes) -> dict[str, bytes]:
    if len(contents) != 2978 or sha256(contents) != SOURCE_SHA256:
        raise ValueError("proxy_tools source does not match the reviewed PyPI archive.")
    with gzip.GzipFile(fileobj=io.BytesIO(contents)) as compressed:
        expanded = compressed.read(64 * 1024 + 1)
    if len(expanded) > 64 * 1024:
        raise ValueError("The source archive exceeds its expanded size limit.")
    files: dict[str, bytes] = {}
    seen: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:") as archive:
        members = archive.getmembers()
        if len(members) != len(EXPECTED_MEMBERS):
            raise ValueError("The reviewed source archive member count changed.")
        for member in members:
            expected = EXPECTED_MEMBERS.get(member.name)
            if expected is None or member.name in seen:
                raise ValueError("Unexpected or duplicate source archive path.")
            seen.add(member.name)
            kind, size = expected
            if member.size != size or not (member.isdir() if kind == "directory" else member.isfile()):
                raise ValueError("Unexpected source member type or size.")
            if member.isfile():
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("A source archive file could not be read.")
                with stream:
                    value = stream.read(size + 1)
                if len(value) != size:
                    raise ValueError("A source archive file was incomplete.")
                files[member.name] = value
    return files


def wheel_contents(source: dict[str, bytes], license_text: bytes) -> bytes:
    if sha256(license_text) != LICENSE_SHA256:
        raise ValueError("The upstream license does not match its reviewed SHA-256.")
    metadata = source["proxy_tools-0.1.0/PKG-INFO"]
    if b"Name: proxy_tools\n" not in metadata or b"Version: 0.1.0\n" not in metadata:
        raise ValueError("Unexpected source package name or version metadata.")
    provenance = {
        "name": "proxy_tools",
        "version": "0.1.0",
        "source": SOURCE_URL,
        "sourceSha256": SOURCE_SHA256,
        "licenseSource": LICENSE_URL,
        "licenseSha256": LICENSE_SHA256,
        "method": "Unchanged module and PKG-INFO copied into a standard pure-Python wheel. No upstream build or package code was executed.",
        "licenseNote": "PyPI PKG-INFO declares MIT; the unchanged source header declares BSD. The original author's pinned BSD license text is included unchanged, retaining both copyright holders. Original metadata is preserved rather than relabeled.",
    }
    files = {
        "proxy_tools/__init__.py": source["proxy_tools-0.1.0/proxy_tools/__init__.py"],
        f"{DIST_INFO}/METADATA": metadata,
        f"{DIST_INFO}/WHEEL": (
            "Wheel-Version: 1.0\n"
            "Generator: mwide-reviewed-wheel 1.0\n"
            "Root-Is-Purelib: true\n"
            "Tag: py2-none-any\n"
            "Tag: py3-none-any\n"
        ).encode("ascii"),
        f"{DIST_INFO}/LICENSE.txt": license_text,
        f"{DIST_INFO}/MWIDE-PROVENANCE.json": (json.dumps(provenance, indent=2) + "\n").encode("utf-8"),
    }
    records = io.StringIO(newline="")
    writer = csv.writer(records, lineterminator="\n")
    for path, contents in files.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(contents).digest()).rstrip(b"=").decode("ascii")
        writer.writerow((path, f"sha256={digest}", len(contents)))
    record_path = f"{DIST_INFO}/RECORD"
    writer.writerow((record_path, "", ""))
    files[record_path] = records.getvalue().encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as wheel:
        for path, contents in files.items():
            info = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            wheel.writestr(info, contents)
    return output.getvalue()


def is_link(metadata: os.stat_result) -> bool:
    return stat.S_ISLNK(metadata.st_mode) or bool(
        getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    )


def safe_directory(path: Path) -> Path:
    if not path.is_absolute():
        raise ValueError("The output wheel directory must be absolute.")
    absolute = Path(os.path.abspath(path))
    for current in reversed((absolute, *absolute.parents)):
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            current.mkdir(mode=0o700)
            metadata = current.lstat()
        if is_link(metadata) or not stat.S_ISDIR(metadata.st_mode):
            raise ValueError("The output wheel directory must not contain filesystem links.")
    if os.path.normcase(str(absolute.resolve(strict=True))) != os.path.normcase(str(absolute)):
        raise ValueError("The output wheel directory resolves to a different location.")
    return absolute


def prepare(output_directory: Path) -> dict[str, object]:
    directory = safe_directory(output_directory)
    metadata = json.loads(download(PYPI_URL, 256 * 1024))
    sources = metadata.get("urls", [])
    if metadata.get("info", {}).get("version") != "0.1.0" or len(sources) != 1:
        raise ValueError("The official PyPI release metadata changed.")
    release = sources[0]
    if release.get("url") != SOURCE_URL or release.get("digests", {}).get("sha256") != SOURCE_SHA256:
        raise ValueError("The PyPI release no longer matches its reviewed artifact.")
    source = unpack_reviewed_source(download(SOURCE_URL, 16 * 1024))
    wheel = wheel_contents(source, download(LICENSE_URL, 16 * 1024))
    target = directory / WHEEL_NAME
    try:
        existing = target.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None:
        if is_link(existing) or not stat.S_ISREG(existing.st_mode) or existing.st_nlink != 1:
            raise ValueError("The output wheel path is not a private regular file.")
        if existing.st_size != len(wheel) or sha256(target.read_bytes()) != sha256(wheel):
            raise ValueError("A different existing wheel was preserved; choose an empty output directory.")
    else:
        descriptor, temporary_name = tempfile.mkstemp(prefix=".mwide-wheel-", suffix=".tmp", dir=directory)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(wheel)
                stream.flush()
                os.fsync(stream.fileno())
            # A concurrently created target is never intentionally overwritten.
            os.link(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    return {"wheel": str(target), "sha256": sha256(wheel), "bytes": len(wheel), "sourceSha256": SOURCE_SHA256, "buildCodeExecuted": False}


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("Usage: prepare-python-wheels.py ABSOLUTE_WHEEL_DIRECTORY")
    print(json.dumps(prepare(Path(sys.argv[1]))))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Reviewed wheel preparation failed: {error}", file=sys.stderr)
        sys.exit(1)
