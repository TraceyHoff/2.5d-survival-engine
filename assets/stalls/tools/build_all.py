"""Rebuild everything: python3 tools/build_all.py  (then validate: cd /workspace/engine && npx tsx /workspace/assets/stalls/tools/validate_fragment.ts)"""
import subprocess, os, sys
H = os.path.dirname(os.path.abspath(__file__)); U = os.path.join(H, "..", "ui", "tools")
for cwd, f in [(H, "stall_art.py"), (H, "props_art.py"), (H, "build_manifest.py"), (H, "previews.py"), (U, "build_screens.py"), (U, "mock_state.py"), (U, "render_mockups.py")]:
    subprocess.run([sys.executable, f], cwd=cwd, check=True)
