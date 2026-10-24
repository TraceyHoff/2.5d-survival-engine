
## Native-size pipeline (VEHICLES_RENDER.md)
- `python3 tools/build.py` renders every doc id at true target px (`scaleMode: "native"`); legacy keys are alias sprites (`aliasOf`).
- `python3 tools/lineup.py` → `preview/scale_lineup.png` (player vs bike/sedan/pickup/RV/semi).
- `python3 ../tools/ktx2.py <manifest...> --report out.json` (from packages/assets/pack) writes KTX2 twins: ETC1S colour pages, UASTC masks; manifest fields `ktx2` (atlas + page) and `masksKtx2`. PNG stays the fallback.
