
## Native-size pipeline (VEHICLES_RENDER.md)
- `python3 tools/build.py` renders every doc id at true target px (`scaleMode: "native"`); legacy keys are alias sprites (`aliasOf`).
- `python3 tools/split_facings.py` (right after build.py, before assemble) splits any sheet whose 1x page is >1008px into facing-group pages `veh_art_<key>_f{h|v|d}<n>` (h = E/W, v = S/N, d = diagonals; ≤1008 @1x, ≤2016 @2x, dims multiple of 16) and adds per-animation `dirFrames` ([frame*dirs+dir] → {atlas, frame, anchor}). Legacy uniform pages stay until the renderer resolves `dirFrames` (AssetRegistry.dirFrame); then delete them. Page dims are 16-aligned; build tries 1008, then 1024, then 2048. Run with PYTHONHASHSEED=0.
- `python3 tools/lineup.py` → `preview/scale_lineup.png` (player vs bike/sedan/pickup/RV/semi).
- `python3 ../tools/ktx2.py <manifest...> --report out.json` (from packages/assets/pack) writes KTX2 twins: ETC1S colour pages, UASTC masks; manifest fields `ktx2` (atlas + page) and `masksKtx2`. PNG stays the fallback.
