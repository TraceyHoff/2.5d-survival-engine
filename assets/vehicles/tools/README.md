# SurVivaZ vehicles generator
Procedural 3D->2:1 dimetric renderer (8 authored facings, E..NE, no mirroring) for the vehicles sub-manifest.

    O=packages/assets/pack/vehicles P=assets/vehicles/preview
    python3 paint.py $O && python3 build.py $O $P && python3 interiors.py $O $P && python3 sounds.py $O
    python3 assemble.py $O packages/assets/pack/manifest.json && python3 preview.py $O $P && rm $O/_*.json
    pnpm --filter @engine/assets lock:ids:pack

build.py writes /tmp/veh_frames.pkl that preview.py reads. Needs numpy, Pillow, ffmpeg (libvorbis).
