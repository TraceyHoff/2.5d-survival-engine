"""Scale lineup: player next to bike, sedan, pickup, RV, semi + box trailer (1x E/SE views, true size). python3 lineup.py <pack_dir> <preview_dir>"""
import sys, json, pickle, numpy as np
from PIL import Image, ImageDraw, ImageFont
PACK = sys.argv[1]; PREV = sys.argv[2]
man = json.load(open(PACK + "/manifest.json")); A = {a["key"]: a for a in man["atlases"]}; S = {s["key"]: s for s in man["sprites"]}
part = json.load(open(PACK + "/vehicles/_vehicles_part.json")); frames = pickle.load(open("/tmp/veh_frames.pkl", "rb"))
VS = {s["key"]: s for s in part["sprites"]}; VA = {a["key"]: a for a in part["atlases"]}
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 12)
except Exception: font = ImageFont.load_default()
def player():
    s = S["player"]; a = A[s["atlas"]]; im = Image.open(PACK + "/" + a["image"]).convert("RGBA")
    f = list(s["animations"].values())[0]["frames"][0]; c, r = f % a["columns"], f // a["columns"]
    fr = im.crop((c * a["frameW"], r * a["frameH"], (c + 1) * a["frameW"], (r + 1) * a["frameH"]))
    return fr, (s["anchor"]["x"] * a["frameW"], s["anchor"]["y"] * a["frameH"])
def veh(key, d=0):
    s = VS[key]; a = VA[s["atlas"]]; i1 = frames[(s["atlas"], s["animations"]["intact"]["frames"][0] + d)][1]
    return Image.fromarray(i1), (s["anchor"]["x"] * a["frameW"], s["anchor"]["y"] * a["frameH"])
items = [("player", *player()), ("bike_road", *veh("bike_road")), ("car_sedan", *veh("car_sedan")), ("truck_pickup", *veh("truck_pickup")),
         ("camper_rv", *veh("camper_rv")), ("semi_trailer_box", *veh("semi_trailer_box")), ("semi_tractor", *veh("semi_tractor"))]
def bbox(im): return im.getbbox() or (0, 0, im.width, im.height)
GY = 260; x = 20; W = 20 + sum(bbox(im)[2] - bbox(im)[0] + 24 for _, im, _ in items)
sheet = Image.new("RGBA", (W, GY + 60), (238, 228, 204, 255)); dr = ImageDraw.Draw(sheet)
for y in range(GY - 200, GY + 1, 37): dr.line([(0, y), (W, y)], fill=(222, 210, 186))
dr.line([(0, GY), (W, GY)], fill=(150, 130, 120), width=1)
for i, (name, im, piv) in enumerate(items):
    b = bbox(im); crop = im.crop(b); px = piv[0] - b[0]; py = piv[1] - b[1]
    if name == "semi_tractor": x -= 90  # hitched look: tractor's fifth wheel under the trailer nose
    sheet.alpha_composite(crop, (int(x), int(GY - py))); h = int(py); l = crop.width
    dr.text((int(x), GY + 6), name, fill=(52, 36, 60), font=font); dr.text((int(x), GY + 22), f"{l}x{h}px", fill=(110, 90, 100), font=font)
    x += crop.width + 24
sheet.save(PREV + "/scale_lineup.png"); sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST).save(PREV + "/scale_lineup@2x.png")
print(PREV + "/scale_lineup.png", sheet.size)
