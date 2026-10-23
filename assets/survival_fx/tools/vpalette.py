"""Canonical palette. Ramps are ordered [highlight, base, shade, deep]. Edit here, then run build_palette.py."""
RAMPS = {
  # ink / outlines / shadow
  "ink":        ["#6b4a5a", "#4a2f3d", "#3b2433", "#2a1b2e"],
  # skin
  "skin_light": ["#ffe6cc", "#ffd2ad", "#eba98a", "#c47a64"],
  "skin_tan":   ["#f2c08f", "#d9975f", "#b06f45", "#7d4a34"],
  "skin_deep":  ["#b97a52", "#8f5636", "#6a3c2a", "#4a2a22"],
  # hair
  "hair_brown": ["#b9784a", "#8a5232", "#643822", "#45261c"],
  "hair_pink":  ["#ffc2d6", "#f48fb1", "#cf6690", "#9c4a72"],
  "hair_black": ["#6a5470", "#43344c", "#2e2338", "#1e1726"],
  "hair_blonde":["#ffe9a0", "#f5c95c", "#d69a3c", "#a8702e"],
  # cloth
  "cloth_red":   ["#ff8c78", "#e85d4f", "#bb3f45", "#862d3b"],
  "cloth_blue":  ["#86c0f2", "#4f8fd6", "#3a66a8", "#2b4780"],
  "cloth_teal":  ["#7fe0cc", "#3fb3a6", "#2b8481", "#1f5e62"],
  "cloth_yellow":["#ffe680", "#f7c844", "#d39a2c", "#9c6a24"],
  "cloth_cream": ["#fffaf0", "#f6ead2", "#d8c4a0", "#a8906e"],
  "cloth_denim": ["#8fa2dc", "#5a6fb0", "#434f88", "#323a66"],
  "cloth_green": ["#b8e07a", "#86b94f", "#5f8f3c", "#40652e"],
  "cloth_purple":["#c9a8f0", "#9b72d6", "#7452ad", "#523a80"],
  "leather":     ["#d69a64", "#a8653c", "#7a4630", "#553025"],
  # nature
  "grass":      ["#c4ec7a", "#8fd15c", "#64b04c", "#3f8a47"],
  "grass_deep": ["#7cc055", "#56a045", "#3d7f43", "#2b6040"],
  "leaf":       ["#b4ea80", "#72c45c", "#479b55", "#2d7050"],
  "leaf_autumn":["#ffd27a", "#f4a74a", "#d7743a", "#a24e34"],
  "pine":       ["#7fd39a", "#4fa37a", "#34806a", "#22605a"],
  "bark":       ["#b88058", "#8a5a3c", "#654130", "#472d26"],
  "berry":      ["#ff9fb2", "#e8475f", "#b8304f", "#7e2140"],
  "berry_blue": ["#a9c8ff", "#6a8ef0", "#4a64c4", "#33458f"],
  "mush_red":   ["#ff9a8c", "#ec5a4d", "#c03d41", "#8a2a38"],
  "mush_glow":  ["#e6fff4", "#9ff5d8", "#5fd1c0", "#3a9a9a"],
  "flower_pink":["#ffd6e8", "#ff9ec4", "#e2709e", "#b24e7c"],
  "flower_yel": ["#fff3b0", "#ffd75e", "#e8a93a", "#b07a2a"],
  "flower_blue":["#d6ecff", "#93c6ff", "#6694e0", "#4a66b0"],
  # terrain
  "dirt":       ["#dca878", "#c08a5a", "#9a6a45", "#74503a"],
  "sand":       ["#fff1c4", "#f6dfa4", "#e6c47e", "#c9a265"],
  "stone":      ["#e4e0d8", "#b8b2b0", "#8a8494", "#5f5a70"],
  "cobble":     ["#d6cfc2", "#a9a094", "#7d7480", "#575064"],
  "water":      ["#bdf2f0", "#5cc6dc", "#3a9ccc", "#2d70a8"],
  "water_deep": ["#5cb8d8", "#3484bc", "#2a62a0", "#244a80"],
  "snow":       ["#ffffff", "#eef4fb", "#cdd9ec", "#9fb0cf"],
  # building
  "wood":       ["#f0b878", "#d08c52", "#a2633a", "#74432c"],
  "wood_dark":  ["#b07850", "#87563a", "#61402e", "#432c24"],
  "thatch":     ["#ffe08a", "#f0c060", "#cc9440", "#94662e"],
  "brick":      ["#f0a080", "#d0705a", "#a24e46", "#743838"],
  "iron":       ["#e8f0f4", "#b4c2cc", "#7e8ea0", "#56637a"],
  "gold":       ["#fff2a8", "#ffd45a", "#e0a032", "#a8702a"],
  "glass":      ["#e8fbff", "#a8e4f4", "#6cbcd8", "#4a8ab0"],
  # zombies (goofy pastel)
  "zomb_mint":  ["#c8f5c8", "#94dca8", "#62b48e", "#3f8676"],
  "zomb_teal":  ["#b4f0e4", "#74d0c4", "#45a8a6", "#2e7a84"],
  "zomb_lilac": ["#e4d4ff", "#bba4f0", "#8f78cc", "#65539e"],
  # fx / glow
  "fire":       ["#fff6c2", "#ffd04a", "#ff8a2a", "#e8492e"],
  "glow":       ["#ffffe0", "#fff3a0", "#d4f07a", "#9fd060"],
  "eerie":      ["#e8fff8", "#9ffff0", "#5ce0d8", "#2fa8b0"],
  "smoke":      ["#f4f0f4", "#d4ccd8", "#a89cb4", "#7a6e8c"],
}
SHADOW = "#2a1b2e"      # contact shadow color, used at ~30% alpha
SHADOW_ALPHA = 0.30
LIGHT_DIR = (-1, -1)    # light comes from top-left (screen space)

def hex2rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def ramp(name): return [hex2rgb(c) for c in RAMPS[name]]
