"""ADR-138 helper for art tools: load()/save() a manifest that may be a v2 shard index.
load(path) returns the merged v1 manifest; save(path, m) writes it and re-shards via `pnpm art:shard-manifest`."""
import json, os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.normpath(os.path.join(HERE, "../../.."))
def load(path):
    j = json.load(open(path))
    if not (isinstance(j, dict) and j.get("version") == 2 and isinstance(j.get("shards"), list)): return j
    d = os.path.dirname(path); out = {}
    for s in j["shards"]:
        for k, v in json.load(open(os.path.join(d, s["file"]))).items():
            if isinstance(v, list) and all(isinstance(x, dict) and "key" in x for x in v): out.setdefault(k, []).extend(v)
            elif isinstance(v, dict): out.setdefault(k, {}).update(v)
            elif k not in out or not isinstance(v, list): out.setdefault(k, v)
    return out
def save(path, m):
    json.dump(m, open(path, "w"), indent=1); open(path, "a").write("\n")
    subprocess.run(["npx", "tsx", os.path.join(HERE, "shard-manifest.ts"), os.path.abspath(path)], cwd=ROOT, check=True)
