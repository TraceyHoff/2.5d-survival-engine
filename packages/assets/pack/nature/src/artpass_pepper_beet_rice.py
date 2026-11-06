"""Dedicated pepper / beetroot / rice world art (+ pepper & beetroot icons). Paint unused cells only."""
import os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from artpass_lettuce_hay import (
    SPROUT, CROP, ICON, ATLAS, MAN, PREV,
    render_world, blit_world, blit_icon, paint_sway,
    set_idle_frame, sprite_block, extract,
)
from itemicons import _icon

FRAMES = {
    "crop_pepper_0": ("sprout", 57),
    "crop_pepper_1": ("sprout", 58),
    "crop_beetroot_0": ("sprout", 59),
    "crop_beetroot_1": ("sprout", 60),
    "crop_rice_0": ("sprout", 61),
    "crop_rice_1": ("sprout", 62),
    "crop_pepper_2": ("crop", 97),
    "crop_pepper_3": ("crop", 98),
    "crop_pepper": ("crop", 99),
    "wild_pepper": ("crop", 100),
    "wild_pepper_dep": ("crop", 101),
    "crop_beetroot_2": ("crop", 102),
    "crop_beetroot_3": ("crop", 103),
    "crop_beetroot": ("crop", 104),
    "wild_beetroot": ("crop", 105),
    "wild_beetroot_dep": ("crop", 106),
    "crop_rice_2": ("crop", 107),
    "crop_rice_3": ("crop", 108),
    "crop_rice": ("crop", 109),
    "wild_rice": ("crop", 110),
    "wild_rice_dep": ("crop", 111),
    "pepper": ("icon", 103),
    "pepper_seeds": ("icon", 104),
    "beetroot": ("icon", 105),
    "beetroot_seeds": ("icon", 106),
}


def update_manifest():
    raw = open(MAN).read()
    for key, frame in (("pepper", 103), ("pepper_seeds", 104), ("beetroot", 105), ("beetroot_seeds", 106)):
        raw = set_idle_frame(raw, key, frame)

    if '"key": "crop_pepper_0"' in raw:
        open(MAN, "w").write(raw)
        print("manifest already has new sprites; icon frames refreshed")
        return

    new_sprites = [
        sprite_block("crop_pepper_0", "nature_sprouts", 57, 0.5385),
        sprite_block("crop_pepper_1", "nature_sprouts", 58, 0.5385),
        sprite_block("crop_pepper_2", "nature_crops", 97, 0.8125),
        sprite_block("crop_pepper_3", "nature_crops", 98, 0.8125),
        sprite_block("crop_pepper", "nature_crops", 99, 0.8125),
        sprite_block("wild_pepper", "nature_crops", 100, 0.8125, extra_anim=101),
        sprite_block("crop_beetroot_0", "nature_sprouts", 59, 0.5385),
        sprite_block("crop_beetroot_1", "nature_sprouts", 60, 0.5385),
        sprite_block("crop_beetroot_2", "nature_crops", 102, 0.8125),
        sprite_block("crop_beetroot_3", "nature_crops", 103, 0.8125),
        sprite_block("crop_beetroot", "nature_crops", 104, 0.8125),
        sprite_block("wild_beetroot", "nature_crops", 105, 0.8125, extra_anim=106),
        sprite_block("crop_rice_0", "nature_sprouts", 61, 0.5385),
        sprite_block("crop_rice_1", "nature_sprouts", 62, 0.5385),
        sprite_block("crop_rice_2", "nature_crops", 107, 0.8125),
        sprite_block("crop_rice_3", "nature_crops", 108, 0.8125),
        sprite_block("crop_rice", "nature_crops", 109, 0.8125),
        sprite_block("wild_rice", "nature_crops", 110, 0.8125, extra_anim=111),
    ]
    insert = ",\n" + ",\n".join(new_sprites) + "\n"
    close = raw.rfind("\n ]\n}")
    if close < 0:
        raise SystemExit("could not find sprites array close")
    raw = raw[:close] + insert + raw[close:]
    open(MAN, "w").write(raw)
    print("manifest updated")


def previews():
    os.makedirs(PREV, exist_ok=True)
    bg = (36, 28, 40, 255)
    label = (255, 250, 240, 255)

    def strip(title, cells, path, cell_w=88, cell_h=128):
        w = 16 + len(cells) * (cell_w + 12)
        h = cell_h + 48
        canvas = Image.new("RGBA", (w, h), bg)
        dr = ImageDraw.Draw(canvas)
        dr.text((8, 4), title, fill=label)
        for i, (name, im) in enumerate(cells):
            x = 12 + i * (cell_w + 12)
            canvas.paste(im, (x, 22), im)
            dr.text((x, 22 + cell_h - 8), name, fill=label)
        canvas.save(path)
        print("preview", path)

    def stages(crop, s0, s1, c2, c3, ripe, wild, dep, icon=None, seed=None, extra=None):
        cells = [
            ("_0", extract("nature_sprouts", s0)),
            ("_1", extract("nature_sprouts", s1)),
            ("_2", extract("nature_crops", c2)),
            ("_3", extract("nature_crops", c3)),
            ("ripe", extract("nature_crops", ripe)),
            ("wild", extract("nature_crops", wild)),
            ("depl", extract("nature_crops", dep)),
        ]
        if icon is not None:
            cells.append(("icon", extract("nature_icons", icon)))
        if seed is not None:
            cells.append(("seed", extract("nature_icons", seed)))
        if extra:
            cells.extend(extra)
        strip(f"{crop}: stages + wild + icons", cells, os.path.join(PREV, f"{crop}_unique.png"))

    stages("pepper", 57, 58, 97, 98, 99, 100, 101, 103, 104,
           extra=[("tomato", extract("nature_icons", 65))])
    stages("beetroot", 59, 60, 102, 103, 104, 105, 106, 105, 106,
           extra=[("onion", extract("nature_icons", 69)), ("carrot", extract("nature_crops", 41))])
    stages("rice", 61, 62, 107, 108, 109, 110, 111, 101, 102,
           extra=[("wheat", extract("nature_crops", 38)), ("flax", extract("nature_crops", 50))])


def main():
    crop_frames, sprout_frames = [], []
    for key, (kind, frame) in FRAMES.items():
        if kind == "icon":
            imgs = _icon(key)
            blit_icon(frame, imgs)
            print("icon", key, frame)
        else:
            imgs = render_world(key)
            spec = SPROUT if kind == "sprout" else CROP
            blit_world(spec, frame, imgs)
            (sprout_frames if kind == "sprout" else crop_frames).append(frame)
            print("world", key, kind, frame, imgs[0].size)

    paint_sway(SPROUT, sprout_frames)
    paint_sway(CROP, crop_frames)
    update_manifest()
    previews()
    print("artpass pepper/beetroot/rice generate done")


if __name__ == "__main__":
    main()
