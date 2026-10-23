"""Renders stalls/preview/ui_*.png by reusing the Cozy Camp reference renderer (ui/tools/render_previews.py, imported read-only)
with stall screens + mock state, plus stall icons and a rarity-border post pass."""
import sys, os, json, copy
sys.path.insert(0, "/workspace/assets/ui/tools")
import render_previews as RP
from PIL import Image, ImageDraw, ImageFilter
UI = os.path.abspath(os.path.join(os.path.dirname(__file__), "..")); OUT = "/workspace/assets/stalls/preview"
RP.SCREENS = os.path.join(UI, "screens"); RP.STATE = json.load(open(os.path.join(UI, "screens", "mock", "state.json")))
_lp = RP.load_partial
def load_partial(src):
    p = os.path.join(UI, "screens", src.partition("#")[0])
    if os.path.exists(p): return _lp(src)
    RP.SCREENS, old = "/workspace/assets/ui/screens", RP.SCREENS
    try: return _lp(src)
    finally: RP.SCREENS = old
RP.load_partial = load_partial
ICONS = os.path.join(UI, "icons")
_ii = RP.icon_img
def own(name, size):
    p1 = os.path.join(ICONS, name + ".png")
    if not os.path.exists(p1): return None
    im = Image.open(os.path.join(ICONS, name + ("@2x" if size > 34 else "") + ".png")).convert("RGBA")
    k = im.width // 48; im = im.crop((6 * k, 6 * k, 42 * k, 42 * k))
    return im.resize((size, size), Image.LANCZOS)
def icon_img(name, size):
    if not name: return None
    alias = {"ui_maker_mark": "maker_mark", "item_coin": "coin"}
    n2 = alias.get(name, name[8:] if name.startswith("ui_stall") else name)
    if name.startswith("ui_stall_"): n2 = "ic_" + name[9:]
    r = own(n2, size)
    return r if r is not None else _ii(name, size)
RP.icon_img = icon_img
_pi = RP.PH.item_icon
RP.PH.item_icon = lambda key, size=32: own("coin", size) if key == "coin" else _pi(key, size)
def rarity_post(img, n, x, y, w, h):
    r = n.get("rarityBorder")
    if not r or r == "common": return
    col = tuple(RP.color("rarity." + r))[:3]; d = ImageDraw.Draw(img)
    d.rounded_rectangle((x + 3, y + 3, x + w - 4, y + h - 4), 10, outline=col + (255,), width=3)
    for cx, cy in ((x + 10, y + 10), (x + w - 11, y + 10)):
        d.polygon([(cx, cy - 6), (cx + 6, cy), (cx, cy + 6), (cx - 6, cy)], fill=col + (255,), outline=RP.hexc(RP.PAL["ink"]))
for t in ("tooltip", "panel"):
    prev = RP.POST.get(t)
    RP.POST[t] = (lambda pv: (lambda img, n, x, y, w, h: (pv(img, n, x, y, w, h) if pv else None, rarity_post(img, n, x, y, w, h))))(prev)
_card_draw = RP.WIDGETS["panel"]
def w_panel(img, n, x, y, w, h):
    f = n.get("frame") or "panel_parchment"
    RP.paste_nine(img, f, x, y, w, h)
    if n.d.get("focusable") and f == "slot_selected":   # gamepad focus ring
        ImageDraw.Draw(img).rounded_rectangle((x - 3, y - 3, x + w + 2, y + h + 2), 10, outline=RP.hexc(RP.THEME["color"]["focus"]), width=3)
RP.WIDGETS["panel"] = w_panel
_btn = RP.WIDGETS["button"]
def w_button(img, n, x, y, w, h):
    _btn(img, n, x, y, w, h)
    if n.d.get("id") == "confirm" and not RP.truthy(n.get("disabled")):
        ImageDraw.Draw(img).rounded_rectangle((x - 4, y - 4, x + w + 3, y + h + 3), 12, outline=RP.hexc(RP.THEME["color"]["focus"]), width=3)
RP.WIDGETS["button"] = w_button
bg = Image.open("/tmp/_bg_market_day.png").convert("RGBA").filter(ImageFilter.GaussianBlur(1.2))
bgn = Image.open("/tmp/_bg_market_night.png").convert("RGBA").filter(ImageFilter.GaussianBlur(1.2))
def phone_pre(img):
    d = ImageDraw.Draw(img); d.rectangle((0, 0, 1280, 720), fill=(196, 226, 160, 255))
    d.rounded_rectangle((440, 6, 840, 714), 36, fill=(42, 27, 46, 255)); d.rounded_rectangle((450, 14, 830, 706), 28, fill=(120, 170, 100, 255))
    img.alpha_composite(bg.resize((380, 214)).crop((0, 0, 380, 214)), (450, 30))
    d.text((40, 40), "Phone / touch layout\n(portrait, 2-col cards,\n48px+ targets,\nbottom action bar)", fill=(59, 36, 51, 255), font=RP.font("heading")[0] if isinstance(RP.font("heading"), tuple) else None)
jobs = [
    ("ui_browse", "stall_browse", dict(bg=bg)),
    ("ui_browse_phone", "stall_browse_phone", dict(bg=None, pre=phone_pre)),
    ("ui_buy", "stall_buy", dict(bg=bg, also=["stall_browse"])),
    ("ui_buy_insufficient", "stall_buy", dict(bg=bg, also=["stall_browse"], extra_state={"buy": dict(RP.STATE["buy"], listing=RP.STATE["stall"]["listings"][3], qty=1, maxQty=1, total=2, have=0, haveAfter=0, canAfford=False, state="funds", message="You need 2 iron. You have 0.")})),
    ("ui_buy_bagfull", "stall_buy", dict(bg=bg, also=["stall_browse"], extra_state={"buy": dict(RP.STATE["buy"], state="space", message="Your bag is full. Make room for 2 Stone Axes.")})),
    ("ui_manage", "stall_manage", dict(bg=bgn)),
    ("ui_manage_owner", "stall_manage", dict(bg=bgn, extra_state={"stall": dict(RP.STATE["stall"], header=dict(RP.STATE["stall"]["header"], ownerKind=1, ownerName="Mabel", clanTag=None, stallName="Mabel's Pantry"),
                                                                                     viewer={"role": 9, "roleLabel": "Owner", "canBuy": True, "perms": {k: True for k in ("list", "price", "stock", "collect", "remove")}, "lockReason": {}})})),
    ("ui_manage_perms", "stall_manage_perms", dict(bg=bgn)),
    ("ui_market_board", "market_board", dict(bg=bg)),
    ("ui_inspect_tooltip", "item_inspect", dict(bg=bg)),
    ("ui_toasts", "stall_toasts", dict(bg=bg)),
]
only = sys.argv[1:]
for out, sid, kw in jobs:
    if only and out not in only: continue
    RP.render_screen(sid, out=os.path.join(OUT, out + ".png"), **kw); print("wrote", out)
