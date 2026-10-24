# Camper station panel (SurVivaZ)

Opened on the gameplay `station-opened` event for a camper (`camper_van`, `camper_rv`, `trailer_camper`). Mockup (2x, 720x545 logical):
`/workspace/assets/vehicle_items/preview/camper_station_mockup.png`, made by `packages/assets/pack/vehicle_items/src/mockup.py` from `assets/ui/kit/css` crops and pack item icons.
Skin: `apps/client/src/gameplay-panels.css`, in the "camper station" block plus the shared slot, job, tooltip and `[data-icon]` rules.

## Input
- **Touch:** every target is at least `--cz-hit` (48px, or 56px when `pointer:coarse`). Tap a slot to focus it and show its `[data-tip]` tooltip; tap again to act. Long-press or hold (A) crafts x5.
- **Gamepad:** focus moves through the DOM order (fuel → tabs → recipes → queue → storage) and the D-pad moves within grids. A = act, B = close, X = split, Y = add the focused fuel item to the tank, LB/RB = Craft/Cook tabs. Focus uses the gold `:focus-visible` ring.
- **Mouse:** hover tooltips after 0.25s; click acts; dragging a storage slot onto the fuel slot or a cook input moves it there (optional).

## DOM (data-role / data-key hooks)
```html
<div class="gm-panel" data-panel="camper-station" data-key="<vehicle entity id>">
  <header data-role="title">Camper Station <button data-key="close" data-tip="Close (B)"></button></header>
  <div data-role="body">
    <section data-role="station-fuel">
      <button data-role="slot" data-key="fuel-slot" data-item="<itemId>" data-icon="<icon key>" data-count="6" data-tip="Gasoline ×6 · Y to add"></button>
      <div data-role="fuel-gauge" style="--p:0.62" data-low? aria-valuenow="62" role="progressbar"></div>
      <p data-role="fuel-time">62% · 3m 10s</p>
    </section>
    <nav data-role="station-tabs">
      <button data-key="tab-craft" aria-pressed="true">Craft</button>
      <button data-key="tab-cook" aria-pressed="false">Cook</button>
    </nav>
    <section data-role="station-craft">
      <div class="gm-grid">
        <button data-role="recipe" data-key="recipe-<recipeKey>" data-icon="<output icon key>" data-tip="Patch kit · 2 rubber + 1 cloth" class="alt? (locked/missing)"></button> …
      </div>
      <button data-role="job" data-key="job-<n>" data-icon="<icon key>" style="--p:0.45" data-tip="…">Patch kit · 12s</button> …
    </section>
    <section data-role="station-cook">
      <div data-role="cook-row">
        <div data-role="cook-inputs"><button data-role="slot" data-key="cook-in-0" data-item data-icon data-count></button> ×3</div>
        <button data-role="job" data-key="cook-job" style="--p:0.3"></button>
        <button data-role="slot" data-key="cook-out" data-item data-icon data-count></button>
      </div>
      <div class="gm-grid"><button data-role="recipe" data-key="cook-<recipeKey>" data-icon …></button> …</div>
    </section>
    <section data-role="station-inv">
      <p data-role="section">Camper storage 12/24</p>
      <div class="gm-grid"><button data-role="slot" data-key="inv-<slot>" data-item="<itemId>" data-icon="<icon key>" data-count="18" data-tip="…"></button> … (empty slots: no data-item)</div>
    </section>
  </div>
</div>
```
Sections are shown or hidden in CSS from `[data-key=tab-*][aria-pressed=true]`, so no JS is needed for tab visibility.

## Hooks the panel builder needs (ask to Survival / client)
- `data-item` (item id) and `data-icon` (InventorySlotView.icon / ItemDef.spriteKey) on **every** slot, recipe and job button. The CSS draws the real icon from the generated `[data-icon=…]` block; an unknown key falls back to the bag icon.
- `data-count` on slots for the stack number. A slot with no `data-item` is drawn as empty.
- `style="--p:<0..1>"` on `[data-role=job]` and `[data-role=fuel-gauge]`; `data-low` on the gauge below 15%.
- `data-unlocked` on `[data-role=unlock]` (present = unlocked) — as shipped in 9291c99.
- `data-rank=member|officer|leader` on member rows and `data-role-name` with the custom clan rank name (for future label styling).
- `data-chan=global|local|party|clan|trade|whisper|system` on chat log lines — as shipped.
- Tooltips only via `data-tip` (no `title=`) and `aria-label` for screen readers.
- Vehicle item icons: `vehicle_items.json` has no `sprite` overrides, so `icon` is the bare key (`plant_oil`). The vehicle_items manifest ships both `item_<key>` (ART_KEYS_VEHICLES.md) and a bare-key alias, so either works.
