# item_vehicle_kit_<id>: wooden kit crate with the matching vehicle (rendered from the vehicles sub-manifest atlas, clan-tinted) riding on top.
import json
import numpy as np
from PIL import Image
from draw import C, dk, lt, hx
VDIR = '../../vehicles/'
KITS = {  # kit id -> (vehicle sprite, body colour, crate tag colour)
 'bike_basic': ('bike_road', '#e2504a'), 'bike_road': ('bike_road', '#3f86d8'), 'bike_mountain': ('bike_mountain', '#5aa04a'), 'bike_bmx': ('bike_bmx', '#f2a922'),
 'bike_fat_tire': ('bike_mountain', '#e07a3a'), 'bike_cruiser': ('bike_road', '#5ab3c9'), 'bike_tandem': ('bike_tandem', '#9b5fd0'), 'bike_cargo': ('bike_cargo', '#2f9a7a'),
 'bike_trike': ('bike_cargo', '#e25a8f'), 'car_compact': ('car_hatchback', '#f2c84b'), 'car_sedan': ('car_sedan', '#3f86d8'), 'car_muscle': ('car_sports', '#e2504a'),
 'car_offroad': ('car_suv', '#6f8f3a'), 'car_wagon': ('car_sedan', '#c8874a'), 'truck_pickup': ('car_pickup', '#d9534a'), 'truck_flatbed': ('car_pickup', '#5c8fe0'),
 'truck_box': ('truck_box', '#f2a922'), 'van_cargo': ('van_delivery', '#e9e3d0'), 'van_passenger': ('van_minivan', '#5ab3a0'), 'camper_van': ('van_minivan', '#f0c070'),
 'camper_rv': ('camper_motorhome', '#e9e3d0'), 'semi_tractor': ('truck_semi_cab', '#d9534a'), 'trailer_utility_small': ('trailer_utility', '#8d97a6'),
 'trailer_cargo_medium': ('trailer_box', '#5c8fe0'), 'trailer_flatbed_large': ('trailer_flatbed', '#c8874a'), 'trailer_livestock': ('trailer_box', '#b5743d'),
 'trailer_tanker': ('trailer_tanker', '#dfe5ee'), 'trailer_camper': ('camper_trailer', '#f0e6cc'), 'semi_trailer_box': ('trailer_box', '#e2504a'), 'semi_trailer_flatbed': ('trailer_flatbed', '#4a4f5c')}
_vm = json.load(open(VDIR+'manifest.vehicles.json')); _A = {a['key']: a for a in _vm['atlases']}; _S = {s['key']: s for s in _vm['sprites']}; _cache = {}
def vehicle(key, col, d=1):
    s = _S[key]; a = _A[s['atlas']]
    if a['key'] not in _cache: _cache[a['key']] = (Image.open(VDIR+a['pages'][0]['image']).convert('RGBA'), Image.open(VDIR+a['masks']['tintmask']).convert('RGBA') if a.get('masks', {}).get('tintmask') else None)
    im, mk = _cache[a['key']]; f = s['animations']['idle']['frames'][0]+d; fw, fh = a['frameW'], a['frameH']; cx, cy = f % a['columns'], f//a['columns']
    fr = np.array(im.crop((cx*fw*2, cy*fh*2, (cx+1)*fw*2, (cy+1)*fh*2))).astype(np.float32)
    if mk is not None:
        m = np.array(mk.crop((cx*fw, cy*fh, (cx+1)*fw, (cy+1)*fh)).resize((fw*2, fh*2), Image.BILINEAR)).astype(np.float32)[..., 0:1]/255
        tint = np.array(hx(col), np.float32)/255; lum = fr[..., :3].mean(-1, keepdims=True)/255
        fr[..., :3] = fr[..., :3]*(1-m) + np.clip(lum*1.25*tint*255, 0, 255)*m
    out = Image.fromarray(fr.astype(np.uint8)); return out.crop(out.getbbox())
def kit(kid):
    vk, col = KITS[kid]; c = C(32, 8)
    c.shadow(16, 28.4, 12, 2.2)
    # iso-ish crate: front + side + top with slats and a coloured tag
    W = '#c8874a'
    c.poly([(4, 17), (16, 21), (16, 29), (4, 25)], W, shade=.3); c.poly([(16, 21), (28, 17), (28, 25), (16, 29)], dk(W, .18), shade=.3)
    c.poly([(4, 17), (16, 13), (28, 17), (16, 21)], lt(W, .2), shade=.2)
    for y in (22.5, 25.5): c.line([(4.5, y-2.6), (15.5, y+1.2)], .45, dk(W, .5), 170); c.line([(16.5, y+1.2), (27.5, y-2.6)], .45, dk(W, .55), 170)
    c.poly([(19, 21.5), (25, 19.5), (25, 23), (19, 25)], col, owf=.6)
    # vehicle on top
    v = vehicle(vk, col); S = c.S; maxw, maxh = 30*S, 17*S; r = min(maxw/v.width, maxh/v.height); v = v.resize((max(1, int(v.width*r)), max(1, int(v.height*r))), Image.LANCZOS)
    c.img.alpha_composite(v, (int(16*S - v.width/2), int(19*S - v.height)))
    return c
