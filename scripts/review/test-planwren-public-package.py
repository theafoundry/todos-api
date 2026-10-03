"""Exercise ZIP safety and reproducible public-package delivery offline."""

import hashlib
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[2] / "plugins" / "planwren-public"
UTILITY = Path(__file__).resolve().parents[1] / "build-planwren-public-package.py"
SPEC = importlib.util.spec_from_file_location("planwren_package", UTILITY)
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


def entry(name, size=0, mode=stat.S_IFREG | 0o644, flags=0, compression=zipfile.ZIP_DEFLATED):
    member = zipfile.ZipInfo(name)
    member.file_size = size
    member.external_attr = mode << 16
    member.flag_bits = flags
    member.compress_type = compression
    return member


class FakeArchive:
    def __init__(self, members):
        self.members = members

    def infolist(self):
        return self.members


class ArchiveSafetyTests(unittest.TestCase):
    def inspect(self, *members):
        return PACKAGE.safe_archive_members(FakeArchive([entry("plugin.json"), entry("mcp.json"), *members]))

    def test_valid_root(self):
        self.assertEqual(len(self.inspect(entry("assets/logo.png"))), 3)

    def test_archive_comments_and_extra_metadata(self):
        archive = FakeArchive([entry("plugin.json"), entry("mcp.json")])
        archive.comment = b"unneeded hidden payload"
        with self.assertRaisesRegex(ValueError, "hidden metadata"):
            PACKAGE.safe_archive_members(archive)
        for attribute in ("extra", "comment"):
            member = entry("additional")
            setattr(member, attribute, b"unneeded hidden payload")
            with self.subTest(attribute=attribute), self.assertRaisesRegex(ValueError, "hidden metadata"):
                self.inspect(member)

    def test_archive_compressed_size_limit(self):
        with tempfile.TemporaryDirectory(prefix="planwren-zip-size-") as directory:
            archive = Path(directory) / "oversize.zip"
            with archive.open("wb") as output:
                output.truncate(PACKAGE.MAX_COMPRESSED + 1)
            with self.assertRaisesRegex(ValueError, "100 MB"):
                PACKAGE.verify_archive(SOURCE, archive)

    def test_traversal_and_nonportable_paths(self):
        for name in ("../outside", "a/../outside", "a//b", "a/./b", "/absolute", "C:/absolute", "a\\b", " padded ", "a\nfile", ""):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.inspect(entry(name))

    def test_case_and_unicode_collisions(self):
        for left, right in (("assets/A.png", "assets/a.png"), ("assets/é.png", "assets/e\u0301.png"), ("assets/STRASSE.png", "assets/straße.png")):
            with self.subTest(left=left), self.assertRaisesRegex(ValueError, "normalization collision"):
                self.inspect(entry(left), entry(right))

    def test_duplicate_names(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.inspect(entry("plugin.json"))

    def test_file_directory_conflicts(self):
        for parent, child in (("skills", "skills/today/SKILL.md"), ("Skills", "skills/today/SKILL.md")):
            with self.subTest(parent=parent), self.assertRaisesRegex(ValueError, "path conflict"):
                self.inspect(entry(parent), entry(child))

    def test_null_byte_filename(self):
        with self.assertRaisesRegex(ValueError, "null byte"):
            self.inspect(entry("hidden\x00suffix"))

    def test_archive_link_or_special_file(self):
        for mode in (stat.S_IFLNK | 0o644, stat.S_IFIFO | 0o644, stat.S_IFDIR | 0o755):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "regular files"):
                self.inspect(entry("linked", mode=mode))

    def test_executable_files(self):
        with self.assertRaisesRegex(ValueError, "executable"):
            self.inspect(entry("skills/run", mode=stat.S_IFREG | 0o755))

    def test_encrypted_and_unsupported_compression(self):
        for member in (entry("secret", flags=1), entry("unsupported", compression=zipfile.ZIP_BZIP2)):
            with self.subTest(name=member.filename), self.assertRaisesRegex(ValueError, "encrypted/unsupported"):
                self.inspect(member)

    def test_depth_and_local_path_length_limits(self):
        for name in ("/".join(["a"] * 21), "a" * 1025):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "length/depth"):
                self.inspect(entry(name))

    def test_archive_entry_size_limit(self):
        with self.assertRaisesRegex(ValueError, "100 MiB"):
            self.inspect(entry("oversized", size=PACKAGE.MAX_ENTRY + 1))

    def test_archive_total_size_limit(self):
        with self.assertRaisesRegex(ValueError, "512 MiB"):
            self.inspect(*(entry(f"part-{index}", size=PACKAGE.MAX_ENTRY) for index in range(6)))

    def test_archive_entry_count_limit(self):
        with self.assertRaisesRegex(ValueError, "5000"):
            self.inspect(*(entry(f"part-{index}") for index in range(PACKAGE.MAX_ENTRIES)))

    def test_ambiguous_root(self):
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.inspect(entry("second/plugin.json"))

    def test_wrapped_root_rejected_for_this_package(self):
        with self.assertRaisesRegex(ValueError, "archive root"):
            PACKAGE.safe_archive_members(FakeArchive([entry("wrapper/plugin.json"), entry("wrapper/mcp.json")]))


class DeliveryTests(unittest.TestCase):
    def test_archive_is_reproducible_and_safely_extractable(self):
        with tempfile.TemporaryDirectory(prefix="planwren-zip-test-") as directory:
            first = Path(directory) / "first.zip"
            second = Path(directory) / "second.zip"
            report = PACKAGE.build_archive(SOURCE, first)
            PACKAGE.build_archive(SOURCE, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(report["sha256"], hashlib.sha256(first.read_bytes()).hexdigest())
            self.assertTrue(report["extractedPackageValidated"])
            self.assertEqual(PACKAGE.verify_archive(SOURCE, second)["files"], report["files"])
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(len(archive.namelist()), 8)
                self.assertEqual(archive.namelist(), sorted(archive.namelist()))
                self.assertTrue(all(member.date_time == PACKAGE.ZIP_DATE for member in archive.infolist()))

    def test_valid_source_does_not_accept_changed_zip_bytes(self):
        with tempfile.TemporaryDirectory(prefix="planwren-zip-tamper-") as directory:
            original = Path(directory) / "original.zip"
            tampered = Path(directory) / "tampered.zip"
            PACKAGE.build_archive(SOURCE, original)
            with zipfile.ZipFile(original) as source, zipfile.ZipFile(tampered, "w") as target:
                for member in source.infolist():
                    content = source.read(member)
                    target.writestr(member, content + b" " if member.filename == "plugin.json" else content)
            with self.assertRaisesRegex(ValueError, "archive bytes differ"):
                PACKAGE.verify_archive(SOURCE, tampered)

    def test_valid_source_does_not_accept_extra_zip_file(self):
        with tempfile.TemporaryDirectory(prefix="planwren-zip-extra-") as directory:
            archive = Path(directory) / "extra.zip"
            PACKAGE.build_archive(SOURCE, archive)
            with zipfile.ZipFile(archive, "a") as output:
                output.writestr("unexpected.txt", "extra")
            with self.assertRaisesRegex(ValueError, "contents differ"):
                PACKAGE.verify_archive(SOURCE, archive)

    def test_corrupted_zip_fails(self):
        with tempfile.TemporaryDirectory(prefix="planwren-zip-corrupt-") as directory:
            archive = Path(directory) / "broken.zip"
            archive.write_bytes(b"not a zip")
            with self.assertRaises(zipfile.BadZipFile):
                PACKAGE.verify_archive(SOURCE, archive)

    def test_directory_output_cannot_pollute_package(self):
        with self.assertRaisesRegex(ValueError, "outside the plugin root"):
            PACKAGE.build_archive(SOURCE, SOURCE / "plugin.zip")


if __name__ == "__main__":
    unittest.main(verbosity=2)
