#!/usr/bin/env python3
"""Rebuild the whole survival_fx pack: atlases, textures, LUTs, preview masks, tuning, manifest fragment + main-pack patch, previews.

Flags:
  Flame light colours are natural (campfire #ff9a4a, torch #ffa54f, ...) since engine d30cdda; --natural-flame-light is
  accepted as a no-op for old scripts.
  --skip-previews         Skip preview sheets/GIFs.
Mask pages for the MAIN pack are not written here (the main-pack worker runs make_sheen_mask.py / make_sway_mask.py, which
default to writing next to each atlas); this build writes preview copies into survival_fx/sheen and survival_fx/sway only.
"""
import argparse, glob, os, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__)); A = "/workspace/assets/atlases"
ap = argparse.ArgumentParser(); ap.add_argument("--natural-flame-light", action="store_true", help="no-op (natural is the default)"); ap.add_argument("--skip-previews", action="store_true")
args = ap.parse_args()
env = dict(os.environ)
def run(*a): print("+", " ".join(a)); subprocess.run([sys.executable, *a], cwd=H, check=True, env=env)
for g in ("heat", "status", "wind", "weather", "food", "daynight"): run(f"gen_{g}.py")
chars = [p for p in sorted(glob.glob(f"{A}/*.png")) if os.path.basename(p).startswith(("characters", "zombies")) and not p.endswith(("_emissive.png", "_sheen.png", "_2x.png"))]
if chars: run("make_sheen_mask.py", *chars, "--out-dir", "../sheen")
nature = [p for p in (f"{A}/resources_tall.png", f"{A}/resources.png") if os.path.exists(p)]
if nature: run("make_sway_mask.py", *nature, "--out-dir", "../sway")
run("tuning.py"); run("build_manifest.py")
if not args.skip_previews: run("previews.py")
