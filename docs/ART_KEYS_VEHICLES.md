# Vehicle art keys + texture-compression ask (Render -> Art)

Vehicle art streams through the `veh` page pool (`AtlasManager`, pool class `veh`): one atlas page per vehicle
family, refcounted per live vehicle, LRU-evicted when off screen (`VehicleView.sync({ inView })`).

Art ships grouped `veh_*` atlases (e.g. `veh_cars_0`, which holds `car_compact`); sprites are looked up by Art key,
not by atlas name (`vehicles/artPack.ts`). Any `veh_*` atlas whose source is a file streams; blob/data placeholders
stay resident (they are the debug fallback only when a page is not resident yet).

Optional per-atlas `*.hands.json` (steering/hand anchors) may be absent; the 404s in dev are expected.

Working set: desktop 8 slots, low-memory (<= 256 MB texture budget, mobile / `?gl=lowend`) 6 slots at full res.
Visible vehicles are never stored downscaled to save memory; the pool reserve for vehicles is excluded from the
budget trade-offs (only the wearables pool and cold atlases shrink).

## KTX2 ask

Render has a compressed-texture probe (`probeCompressedTextures`: ETC2 / ASTC / S3TC / BPTC) and a KTX2 loader stub
(`src/assets/ktx2.ts`) behind a feature check with a PNG fallback. No Basis transcoder is installed yet.

Please export, next to every existing PNG (same basename, `.ktx2`, same @2x / 1x pages, mips included):

- **Colour pages: ETC1S** (Basis LZ), quality ~128, sRGB, premultiplied alpha off (same as the PNGs).
- **Masks (tintmask, sheen, sway) and emissive: UASTC** (+ RDO ~1.0 + Zstd), linear, so mask edges and light shapes stay
  sharp under block compression.
- Keep the PNGs: they stay the fallback for GPUs/browsers without a supported target and for `?gl=safe`.

Expected effect on mobile (Mali/Adreno, ASTC or ETC2): colour arrays ~4x smaller (8 bpp ASTC 4x4 / ETC2 RGBA vs 32 bpp)
at the same resolution, i.e. the remaining downscaled cold tier can go back to full res within the ~160 MB budget.
