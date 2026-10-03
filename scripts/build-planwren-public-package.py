"""Build and verify the isolated public Planwren ZIP without uploading it.

No third-party Python packages, credentials, HTTP requests or server connections.
Archive safety limits follow OpenAI's submission error reference; the root-level
portable layout and exclusion of executable files are this package's policy.
"""

import argparse
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
import zlib

REPOSITORY = Path(__file__).resolve().parent.parent
DEFAULT_PACKAGE = REPOSITORY / "plugins" / "planwren-public"
VALIDATOR = REPOSITORY / "scripts" / "validate-planwren-public-package.mjs"
MAX_COMPRESSED = 100_000_000
MAX_ENTRY = 100 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_ENTRIES = 5000
ZIP_DATE = (1980, 1, 1, 0, 0, 0)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def image_dimensions(filename):
    """Validate the package's PNG/SVG assets, including PNG CRC and payload."""
    source = Path(filename)
    data = source.read_bytes()
    require(len(data) <= 5 * 1024 * 1024, f"{source.name}: image exceeds 5 MiB")
    if source.suffix.lower() == ".png":
        require(data.startswith(b"\x89PNG\r\n\x1a\n"), f"{source.name}: invalid PNG signature")
        offset, chunks, compressed = 8, [], bytearray()
        width = height = depth = color = None
        while offset < len(data):
            require(offset + 12 <= len(data), "truncated PNG chunk")
            size = struct.unpack_from(">I", data, offset)[0]
            require(offset + 12 + size <= len(data), "truncated PNG data")
            kind = data[offset + 4 : offset + 8]
            payload = data[offset + 8 : offset + 8 + size]
            crc = struct.unpack_from(">I", data, offset + 8 + size)[0]
            require(binascii.crc32(kind + payload) & 0xFFFFFFFF == crc, "PNG CRC mismatch")
            chunks.append(kind)
            if kind == b"IHDR":
                require(len(chunks) == 1 and size == 13, "invalid PNG IHDR")
                width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
                require(compression == filtering == interlace == 0, "package PNG must use standard, non-interlaced encoding")
                permitted = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
                require(color in permitted and depth in permitted[color], "invalid PNG color encoding")
                require(48 <= width <= 4096 and 48 <= height <= 4096 and width == height, "PNG icon must be square and 48–4096 pixels")
            elif kind == b"IDAT":
                compressed.extend(payload)
            elif kind == b"IEND":
                require(size == 0 and offset + 12 == len(data), "invalid PNG end/trailing data")
            elif kind[0] & 32 == 0:
                require(kind == b"PLTE", "unsupported critical PNG chunk")
            offset += size + 12
        require(chunks and chunks[0] == b"IHDR" and chunks[-1] == b"IEND" and compressed, "incomplete PNG")
        channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
        row_bytes = (width * depth * channels + 7) // 8
        expected = height * (row_bytes + 1)
        inflater = zlib.decompressobj()
        decoded = inflater.decompress(compressed, expected + 1)
        require(len(decoded) == expected and inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail, "PNG payload has invalid dimensions or compression")
        require(all(decoded[row * (row_bytes + 1)] <= 4 for row in range(height)), "PNG scanline filter is invalid")
    elif source.suffix.lower() == ".svg":
        contents = data.decode("utf-8", errors="strict")
        require(not re.search(r"<!DOCTYPE|<!ENTITY", contents, re.I), "SVG external entities are prohibited")
        require(not re.search(r"<\?(?!xml\s)[\s\S]*?\?>", contents, re.I), "SVG processing instructions are prohibited")
        element = ET.fromstring(contents)
        require(element.tag == "{http://www.w3.org/2000/svg}svg" or element.tag == "svg", "SVG root must be svg")
        for child in element.iter():
            local = child.tag.rsplit("}", 1)[-1]
            require(local in ("svg", "g", "rect", "path", "title", "desc"), "SVG active/external or unsupported content is prohibited")
            for key, value in child.attrib.items():
                attribute = key.rsplit("}", 1)[-1]
                require(not attribute.lower().startswith("on") and attribute not in ("href", "src"), "SVG active/external attribute is prohibited")
                require(not re.search(r"url\s*\(|javascript:", value, re.I), "SVG external resource reference is prohibited")
        numeric = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
        if "viewBox" in element.attrib:
            pieces = re.split(r"[\s,]+", element.attrib["viewBox"].strip())
            require(len(pieces) == 4 and all(re.fullmatch(numeric, piece) for piece in pieces), "SVG viewBox must contain four numeric values")
            _, _, width, height = map(float, pieces)
        else:
            require(all(re.fullmatch(numeric, element.attrib.get(key, "")) for key in ("width", "height")), "SVG must have numeric dimensions or viewBox")
            width, height = (float(element.attrib[key]) for key in ("width", "height"))
        require(48 <= width == height and width < float("inf"), "SVG icon must be square and at least 48 pixels")
    else:
        raise ValueError("this package permits only PNG and SVG icons")
    return {"file": source.name, "width": width, "height": height, "bytes": len(data)}


def validate_package(directory):
    result = subprocess.run(["node", str(VALIDATOR), str(directory)], capture_output=True, text=True, check=False)
    require(result.returncode == 0, result.stderr.strip() or "package validator failed")
    return json.loads(result.stdout)


def safe_archive_members(archive):
    members = archive.infolist()
    require(not getattr(archive, "comment", b""), "public archive must not contain comments or hidden metadata")
    require(0 < len(members) <= MAX_ENTRIES, "archive must contain 1–5000 entries")
    seen, normalized, total = set(), set(), 0
    for entry in members:
        name = entry.filename
        require(not entry.comment and not entry.extra, "archive entry must not contain comments or hidden metadata")
        require(entry.orig_filename == name, "archive filename contains unsupported normalization or a null byte")
        require(name and name == name.strip(), "archive path is empty or has outer whitespace")
        require("\\" not in name and not name.startswith("/") and not re.match(r"^[A-Za-z]:", name), "archive path must be relative and use forward slashes")
        require(not re.search(r"[\x00-\x1f\x7f]", name), "archive path contains control characters")
        parts = name.split("/")
        require(all(part and part not in (".", "..") for part in parts), "archive path contains traversal or empty segments")
        require(len(parts) <= 20 and len(name.encode("utf-8")) <= 1024, "archive path exceeds local length/depth policy")
        require(name not in seen, "archive contains duplicate entry")
        key = unicodedata.normalize("NFC", name).casefold()
        require(key not in normalized, "archive contains case/Unicode normalization collision")
        seen.add(name)
        normalized.add(key)
        mode = entry.external_attr >> 16
        file_type = stat.S_IFMT(mode)
        require(not entry.is_dir() and file_type in (0, stat.S_IFREG), "public archive entries must be regular files")
        require(mode & 0o111 == 0, "archive contains executable files")
        require(not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "encrypted/unsupported archive compression")
        require(entry.file_size <= MAX_ENTRY, "archive entry exceeds 100 MiB")
        total += entry.file_size
        require(total <= MAX_TOTAL, "archive exceeds 512 MiB uncompressed")
    for name in seen:
        parts = name.split("/")
        require(all(unicodedata.normalize("NFC", "/".join(parts[:index])).casefold() not in normalized for index in range(1, len(parts))), "archive file/directory path conflict")
    require("plugin.json" in seen and "mcp.json" in seen, "portable manifest and MCP configuration must be at archive root")
    require(not any(name.endswith("/plugin.json") for name in seen), "archive contains ambiguous plugin roots")
    return members


def verify_archive(package, filename):
    package = Path(package).resolve()
    filename = Path(filename)
    require(filename.stat().st_size <= MAX_COMPRESSED, "archive exceeds 100 MB compressed")
    expected = validate_package(package)
    expected_files = {entry["path"]: entry for entry in expected["files"]}
    with zipfile.ZipFile(filename) as archive, tempfile.TemporaryDirectory(prefix="planwren-zip-verify-") as temporary:
        members = safe_archive_members(archive)
        require({entry.filename for entry in members} == set(expected_files), "archive contents differ from validated source files")
        for entry in members:
            content = archive.read(entry)  # zipfile verifies CRC while reading.
            reference = expected_files[entry.filename]
            require(len(content) == reference["bytes"] and hashlib.sha256(content).hexdigest() == reference["sha256"], f"archive bytes differ: {entry.filename}")
            destination = Path(temporary).joinpath(*entry.filename.split("/"))
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            destination.chmod(0o644)
        extracted = validate_package(temporary)
        require(extracted["files"] == expected["files"], "extracted package validation differs from source")
    return {"valid": True, "archive": str(filename.resolve()), "bytes": filename.stat().st_size, "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(), "packageName": expected["packageName"], "version": expected["version"], "files": expected["files"], "extractedPackageValidated": True, "scope": expected["scope"]}


def build_archive(package, output):
    package = Path(package).resolve()
    output = Path(output).resolve()
    require(output != package and package not in output.parents, "archive output must be outside the plugin root")
    validation = validate_package(package)
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".planwren-package-", suffix=".zip", dir=output.parent)
    os.close(descriptor)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=True) as archive:
            for entry in validation["files"]:
                content = package.joinpath(*entry["path"].split("/")).read_bytes()
                require(hashlib.sha256(content).hexdigest() == entry["sha256"], "package changed during archive build")
                info = zipfile.ZipInfo(entry["path"], ZIP_DATE)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        report = verify_archive(package, temporary)
        os.replace(temporary, output)
        report["archive"] = str(output)
        return report
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "inspect-images":
        print(json.dumps([image_dimensions(filename) for filename in sys.argv[2:]]))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=DEFAULT_PACKAGE)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--output", type=Path, help="build and verify a deterministic ZIP")
    mode.add_argument("--verify", type=Path, help="verify ZIP safety, exact source bytes and extracted package")
    arguments = parser.parse_args()
    report = build_archive(arguments.package, arguments.output) if arguments.output else verify_archive(arguments.package, arguments.verify)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile, ET.ParseError, UnicodeDecodeError, zlib.error) as error:
        print(f"Public package archive failed: {error}", file=sys.stderr)
        sys.exit(1)
