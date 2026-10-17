# Render-side input hooks (agreed spec, not yet implemented)

These were agreed with the Engine Architect for @engine/input. Exact signatures are pending until it lands.

## Render provides
- `camera.screenToWorld(sx, sy)` and `camera.worldToScreen(x, y, z)`. Both are zoom-aware and handle DPR and interpolation. They're used for aim.
- An injected Picker, `pickAt(sx, sy, { radius })`, which returns `{ entity?, tile?, cell? }`. It tests against sprite bounds in depth order (front to back), honours cutaway and fades, and the radius grows on touch.
- A WorldAnchor feed that gives per-frame screen positions plus visibility for the UI.
- A focus and highlight outline pass driven by `focus.target {kind:'entity'|'ui'|'cell', id}`, styled per device from render_tuning.json.
- A placement ghost from the placement controller, `{cell, rotation, valid, touchOffsetPx}`. It draws a grid overlay with valid and invalid cell tiles.
- A screen-space overlay layer (z above world UI) that draws the VirtualControls layout data from input: joystick, buttons, radial menu, safe-area insets, DPI scaling, and a left-handed mirror. Art & Assets supplies the skins.
- Prompt glyphs swap on `input.onDeviceChange`, using `promptFor(action, deviceClass, layout)` against the glyph atlases.
- Camera actions `Camera.Pan`, `Camera.Zoom`, and `Camera.Rotate` come from input (pinch, two-finger pan, right stick, wheel).

## Rules
- Hit targets are at least 48dp, which covers the 44px floor. UI scale follows DPR and a user UI-scale setting.
- Gestures arrive via `gestures.on(type, fn)`: tap, doubleTap, longPress, drag*, pinch, rotate, twoFingerPan, swipe.
