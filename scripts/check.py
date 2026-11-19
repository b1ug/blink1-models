"""Verify all declared model content, and optionally build the Pages site or release ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "models/mk2"


def verified_files():
    manifest = json.loads((MODEL / "manifest.json").read_text())
    package = json.loads((ROOT / "package.json").read_text())
    if package["version"] != manifest["version"] or manifest["model"] != "mk2":
        raise ValueError("Model identity does not match package")
    incoming = {p.relative_to(MODEL).as_posix() for p in MODEL.rglob("*") if p.is_file()}
    if incoming != set(manifest["files"]) | {"manifest.json"}:
        raise ValueError("Model inventory differs from manifest")
    for name, expected in manifest["files"].items():
        path = MODEL / name
        if not path.resolve().is_relative_to(MODEL) or path.is_symlink():
            raise ValueError(f"Invalid file path: {name}")
        content = path.read_bytes()
        if {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} != expected:
            raise ValueError(f"File differs from manifest: {name}")
    return manifest


def archive(version, names):
    target = ROOT / "dist" / f"blink1-mk2-v{version}.zip"
    target.parent.mkdir(exist_ok=True)
    files = [(name, MODEL / name) for name in [*names, "manifest.json"]]
    files.append(("LICENSE", ROOT / "LICENSE"))
    with ZipFile(target, "w") as bundle:
        for name, path in sorted(files):
            info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    checksum = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix(".sha256").write_text(f"{checksum}  {target.name}\n")


def website(names):
    target = ROOT / "dist/site"
    site = ROOT / "site"
    three = site / "node_modules/three"
    vendor = target / "vendor"
    vendor.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "viewer.js", "viewer.css"):
        shutil.copyfile(site / name, target / name)
    for name in ("build/three.module.js", "build/three.core.js", "examples/jsm/controls/OrbitControls.js",
                 "examples/jsm/loaders/STLLoader.js", "LICENSE"):
        shutil.copyfile(three / name, vendor / Path(name).name)
    for name in [*names, "manifest.json"]:
        dest = target / "models/mk2" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(MODEL / name, dest)
    shutil.copyfile(ROOT / "LICENSE", target / "LICENSE")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", action="store_true")
    parser.add_argument("--bundle", action="store_true")
    options = parser.parse_args()
    manifest = verified_files()
    if options.site:
        website(manifest["files"])
    if options.bundle:
        archive(manifest["version"], manifest["files"])
    print(f"Verified {len(manifest['files'])} mk2 files for v{manifest['version']}")
