"""Build every pvp_clan atlas + manifest.fragment.json (engine manifest v1, typed pages/masks/sway/tints).
Run: python3 tools/build_all.py   (from /workspace/assets/pvp_clan)"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT
import fx_combat, loot, clan, buildings_clan, raid, worldui

SPRITE_KEYS = ("key", "category", "atlas", "anchor", "animations", "building", "rotationArt", "sway", "tints", "attach", "autotile")
ANIM_KEYS = ("frames", "fps", "directions", "dirStride", "loop", "rotations")

def clean(s):
    o = {k: s[k] for k in SPRITE_KEYS if k in s}
    o["animations"] = {n: {k: a[k] for k in ANIM_KEYS if k in a} for n, a in s["animations"].items()}
    return o

def vfx_entries():
    P = lambda rate, count, sp, spread, g, fade, sc: {"rate": rate, "count": count, "speed": sp, "spread": spread, "gravity": g, "fade": fade, "scaleCurve": sc}
    v = [
        ("pvp_hit_spark", "fx_hit_spark", 0.21, "additive", None),
        ("pvp_bonk", "fx_bonk_stars", 0.34, "normal", None),
        ("pvp_crit", "fx_crit_burst", 0.34, "additive", P(0, 8, [1.2, 2.8], 6.283, 0.4, True, [1, 0.6, 0])),
        ("pvp_parry", "fx_parry_spark", 0.25, "additive", P(0, 6, [1.5, 3.4], 2.2, 0.8, True, [1, 0.4])),
        ("pvp_block", "fx_block_shield", 0.32, "normal", None),
        ("pvp_dodge", "fx_dodge_dust", 0.43, "normal", None),
        ("pvp_impact_puff", "fx_impact_puff", 0.38, "normal", None),
        ("pvp_impact_flash", "fx_impact_flash", 0.13, "additive", None),
        ("pvp_ko", "fx_ko_puff", 1.0, "normal", P(0, 5, [0.6, 1.5], 6.283, -0.3, True, [0.6, 1, 0])),
        ("pvp_ko_ghost", "fx_ko_ghost", 2.5, "normal", None),
        ("pvp_downed", "fx_downed_overlay", 0.8, "normal", None),
        ("pvp_downed_ring", "fx_downed_ring", 1.0, "normal", None),
        ("pvp_respawn", "fx_respawn_sparkle", 0.72, "additive", P(0, 10, [0.5, 1.4], 6.283, -0.5, True, [1, 0.5, 0])),
        ("pvp_swing_blade", "fx_swing_blade", 0.25, "normal", None),
        ("pvp_swing_blunt", "fx_swing_blunt", 0.25, "normal", None),
        ("pvp_swing_axe", "fx_swing_axe", 0.25, "normal", None),
        ("pvp_swing_spear", "fx_swing_spear", 0.25, "normal", None),
        ("loot_drop_bounce", "fx_item_drop_bounce", 0.43, "additive", None),
        ("loot_beam", "fx_loot_beam", 0.75, "additive", None),
        ("raid_hit_wood", "fx_hit_wood", 0.4, "normal", P(0, 6, [1.2, 2.8], 2.4, 1.6, True, [1, 0.8])),
        ("raid_hit_stone", "fx_hit_stone", 0.4, "normal", P(0, 6, [1.2, 2.5], 2.4, 1.8, True, [1, 0.8])),
        ("raid_hit_dust", "fx_hit_dust", 0.5, "normal", None),
        ("raid_embers", "fx_raid_ember", 1.4, "additive", P(6, 0, [0.3, 0.9], 1.2, -0.6, True, [1, 0.7, 0])),
        ("raid_smoke", "fx_raid_smoke", 2.5, "normal", P(2.5, 0, [0.2, 0.45], 0.8, -0.25, True, [0.5, 1, 1.4])),
        ("raid_fire_small", "fx_fire_small", 0.67, "normal", None),
        ("raid_fire_large", "fx_fire_large", 0.67, "normal", None),
        ("raid_collapse", "fx_collapse_poof", 0.72, "normal", P(0, 12, [0.9, 2.2], 6.283, 1.2, True, [1, 0.6])),
        ("raid_repair", "fx_repair_sparkle", 0.6, "additive", None),
        ("raid_rubble_smolder", "rubble_smoldering", 1.0, "normal", None),
    ]
    out = []
    for key, sp, life, blend, parts in v:
        e = {"key": key, "sprite": sp, "lifetime": life, "blend": blend}   # looping fx: lifetime = one anim cycle; gameplay respawns/keeps them while the state lasts (speeds in tiles/s like the base pack)
        if parts: e["particles"] = parts
        out.append(e)
    return out

def tint_sets():
    cp = json.load(open(os.path.join(ROOT, "clan_palettes.json"))); rp = json.load(open(os.path.join(ROOT, "rarity_palette.json")))
    oc = json.load(open(os.path.join(ROOT, "outline_colors.json")))
    pals = cp["palettes"]; rar = rp["rarity"]; order = sorted(rar, key=lambda k: rar[k]["index"])
    return [{"key": "clan_primary", "tints": [p["primary"] for p in pals]},
            {"key": "clan_secondary", "tints": [p["secondary"] for p in pals]},
            {"key": "rarity_color", "tints": [rar[k]["color"] for k in order]},
            {"key": "rarity_beam", "tints": [rar[k]["beam"] for k in order]},
            {"key": "outline_roles", "tints": [oc["colors"][k]["color"] for k in ("self", "party", "clan", "neutral", "enemy")]}]

# ---- engine schema batch ADR-077/078 (16b0f8f): clanPalettes, anim rotations, crackOverlay, stateVfx, vfx stretch, decal autotile ----
def clan_palettes():
    """clan_palettes.json -> manifest clanPalettes (index = order = BuildPiece.tint u8; tintmask R <- primary, G <- secondary)."""
    pals = sorted(json.load(open(os.path.join(ROOT, "clan_palettes.json")))["palettes"], key=lambda p: p["index"])
    assert [p["index"] for p in pals] == list(range(len(pals)))
    return [{"key": p["key"], "primary": p["primary"], "secondary": p["secondary"]} for p in pals]

# legacy <anim>_r1 anims (kept as fallback aliases) -> rotations rows [r0, r1] (rotations 2/3 mirror rows 0/1)
ROT_ANIMS = {"banner_wall": "flap", "raid_bell": "ring"}
# pieces drawn without bespoke damage stages -> crack overlay by footprint
CRACK_BY_FP = {(1, 1): "crack_1x1", (2, 1): "crack_2x1", (1, 2): "crack_2x1", (2, 2): "crack_2x2"}
# vfx sockets, px from the pivot at 1x (y up = negative): by frame height
SOCKETS = {128: {"fire": {"x": 0, "y": -24}, "ember": {"x": 0, "y": -40}, "smoke": {"x": 0, "y": -64}},
           256: {"fire": {"x": 0, "y": -48}, "ember": {"x": 0, "y": -80}, "smoke": {"x": 0, "y": -128}}}
SOCKET_OVERRIDE = {"watchtower": {"ember": {"x": 0, "y": -120}, "smoke": {"x": 0, "y": -180}}}
NON_FLAMMABLE = {"wall_clan_stone"}
TRAILS = {"trail_arrow": 4, "trail_spear": 3, "trail_stone": 2}   # sprite -> stretchMax
# territory: 8-neighbor autotile over the 9 diamond pieces (bits N1 E2 S4 W8 NE16 SE32 SW64 NW128; grid N = screen NE side)
TERRITORY_PIECES = ("ne", "se", "sw", "nw", "in_n", "in_e", "in_s", "in_w", "fill")
TERRITORY_RULES = [("fill", 0xFF, 0xFF), ("ne", 0, 1), ("se", 0, 2), ("sw", 0, 4), ("nw", 0, 8),
                   ("in_n", 0, 128), ("in_e", 0, 16), ("in_s", 0, 32), ("in_w", 0, 64), ("fill", 0, 0)]   # (piece, mask, care); last = care 0 fallback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools"))
from finalize_manifest import fix_rotation_art
MIRROR_OK = {"raid_bell", "watchtower", "storage_box_locked"}

def schema11(frag):
    """Apply the ADR-077/078 fields to a fragment dict (idempotent)."""
    A = {a["key"]: a for a in frag["atlases"]}; S = {s["key"]: s for s in frag["sprites"]}
    frag["clanPalettes"] = clan_palettes()
    frag["tintSets"] = [t for t in frag.get("tintSets", []) if t["key"] not in ("clan_primary", "clan_secondary")]
    for k, an in ROT_ANIMS.items():
        a = S[k]["animations"]; a[an]["rotations"] = [list(a[an]["frames"]), list(a[an + "_r1"]["frames"])]
    vfx = {v["key"]: v for v in frag["vfx"]}
    for sp, mx in TRAILS.items():
        key = "pvp_" + sp
        if key not in vfx: frag["vfx"].append({"key": key, "sprite": sp, "lifetime": 0.25, "blend": "normal"}); vfx[key] = frag["vfx"][-1]
        vfx[key].update(stretch="velocity", stretchMax=mx)
    for s in frag["sprites"]:
        b = s.get("building")
        if not b: continue
        fp = (b["footprint"]["w"], b["footprint"]["h"])
        if all(len(set(row)) == 1 for row in b["frames"]): b["crackOverlay"] = CRACK_BY_FP[fp]
        if s["key"] in NON_FLAMMABLE: continue
        sock = {n: dict(p) for n, p in SOCKETS[A[s["atlas"]]["frameH"]].items()}; sock.update(SOCKET_OVERRIDE.get(s["key"], {}))
        s["attach"] = {**s.get("attach", {}), **sock}
        fire = "raid_fire_small" if fp == (1, 1) else "raid_fire_large"
        sv = {"burning": [{"vfx": fire, "attach": "fire"}, {"vfx": "raid_embers", "attach": "ember"}, {"vfx": "raid_smoke", "attach": "smoke"}]}
        if "breached" in b.get("states", {}): sv["breached"] = [{"vfx": "raid_embers", "attach": "ember"}, {"vfx": "raid_smoke", "attach": "smoke"}]
        b["stateVfx"] = sv
    # rotationArt: r1 here is a pixel mirror of r0, so a runtime flip is equivalent. Only pieces that are square, free-standing and
    # read the same from behind keep 'mirror' with 2 rows; edge walls/gates/doors (axis must survive rot 2/3), spiked barricade and
    # wall banner (face one side) ship 4 rows as 'unique4'.
    fix_rotation_art(frag["sprites"], MIRROR_OK)
    for n in TERRITORY_PIECES: S["territory_" + n]["category"] = "decal"
    first = {n: S["territory_" + n]["animations"]["idle"]["frames"][0] for n in TERRITORY_PIECES}
    edge = {"key": "territory_edge", "category": "decal", "atlas": "clan_territory", "anchor": dict(S["territory_fill"]["anchor"]),
            "animations": {"idle": {"frames": [first[n] for n in TERRITORY_PIECES], "fps": 1}},
            "autotile": {"neighbors": 8, "group": "territory", "rules": [{"mask": m, "care": c, "frame": first[n]} for n, m, c in TERRITORY_RULES]}}
    frag["sprites"] = [s for s in frag["sprites"] if s["key"] != "territory_edge"] + [edge]
    return frag

def main():
    t = time.time(); sheets = []
    for mod in (fx_combat, loot, clan, buildings_clan, raid, worldui):
        o = mod.build()
        for k, s in o.items():
            if not hasattr(s, "save"): continue
            if not s.frames: continue
            s.save(); sheets.append(s)
            if s.warnings: print(s.key, "warnings:", s.warnings[:3])
    atlases = [s.atlas_json() for s in sheets]
    sprites = [clean(sp) for s in sheets for sp in s.sprites]
    frag = {"version": 1, "name": "pvp_clan", "atlases": atlases, "sprites": sprites, "vfx": vfx_entries(), "tintSets": tint_sets()}
    schema11(frag)
    json.dump(frag, open(os.path.join(ROOT, "manifest.fragment.json"), "w"), indent=1)
    print(f"{len(atlases)} atlases, {len(sprites)} sprites, {len(frag['vfx'])} vfx in {time.time() - t:.1f}s")

if __name__ == "__main__":
    if "--migrate" in sys.argv:   # re-apply schema11 to the existing fragment without redrawing art
        f = os.path.join(ROOT, "manifest.fragment.json"); frag = schema11(json.load(open(f)))
        json.dump(frag, open(f, "w"), indent=1); print("migrated", len(frag["sprites"]), "sprites,", len(frag["vfx"]), "vfx")
    else: main()
