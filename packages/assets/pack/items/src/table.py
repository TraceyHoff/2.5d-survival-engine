from icons import *
T = {}
def k(name, fn, *a, **kw): T[name] = (lambda c: fn(c, *a, **kw))
# raw
k('cotton', bolls); k('beeswax', beeswax); k('resin', resin); k('salt', salt); k('scrap_metal', scrap)
k('saltpeter', crystals, '#f4f6f8', base='#c9c4ba'); k('sulfur', crystals, '#f7dc2f', base='#b5a27a'); k('lead_ore', ore, '#8a8f98', '#c3c8d0', cubic=True)
k('crude_oil', oil_jug); k('chromite_ore', ore, '#3d3c45', '#1c1c22', sheen='#b8c4d4'); k('bone', bone); k('sinew', sinew); k('animal_fat', fat)
k('feather', feather); k('fur', tuft, M['fur'])
# food
k('honey', jar, '#f2a922', lid='#c8874a', label='#f7ead1', dot='#f7c64e'); k('potato', potato); k('corn', corn); k('wild_onion', onion); k('jerky', jerky)
k('baked_potato', potato, split=True, char=True); k('roasted_corn', corn, husk=False, grilled=True); k('roasted_mushroom', skewer); k('fried_egg', egg); k('omelette', omelette)
k('salted_fish', fishflat); k('berry_pie', pie, '#7b3f9a'); k('meat_pie', pie, '#8a4a30', lattice=False); k('cornbread', cornbread); k('honey_cake', cake)
k('potato_soup', bowl, '#f2e2b4', [(12, 16, '#d9b56a'), (19, 15.5, '#b56fc9'), (16, 17, '#d9b56a')]); k('fish_stew', bowl, '#e0954f', [(12, 16, '#e9edf2'), (19, 16, '#d9b56a'), (16, 15, '#6fbf4e')])
k('trail_mix', trail); k('canned_stew', can, '#c9503f', 'meat'); k('canned_fish', can, '#4f86c6', 'fish'); k('canned_corn', can, '#5aa04a', 'corn')
k('herbal_tea', herbal_tea); k('herbal_poultice', poultice); k('antiseptic', antiseptic); k('medkit', medkit)
# intermediate
k('thread', thread); k('linen', linen); k('padded_cloth', padded); k('waxed_cloth', waxed); k('hardened_leather', hleather); k('fur_pelt', pelt, M['fur'])
k('bowstring', bowstring); k('glue', glue); k('flour', flour); k('gunpowder', gunpowder); k('fuse', fuse); k('lead_ingot', ingot, M['lead'])
k('casings', casings); k('iron_pipe', pipe_, M['iron']); k('gun_barrel', pipe_, '#6d7380', rifled=True); k('spring', spring_, M['steel']); k('mechanism', mechanism)
k('chain_rings', chain, M['iron']); k('glass_bottle', glass_bottle); k('tin_can', tin); k('lamp_oil', lamp_oil); k('polymer_sheet', polymer)
k('aramid_weave', aramid); k('ceramic_plate', ceramic); k('alloy_ingot', ingot, M['alloy']); k('alloy_plate', plate, M['alloy'], rivets='#8fb3c8'); k('salvaged_parts', parts)
# tools
for m in ('bronze', 'iron', 'steel', 'alloy'):
    hf = M['dwood'] if m in ('steel',) else M['black'] if m == 'alloy' else M['wood']
    if m == 'steel' or m == 'alloy': k(f'{m}_axe', axe, M[m], hf); k(f'{m}_pickaxe', pickaxe, M[m], hf)
    k(f'{m}_shovel', shovel, M[m] if m != 'iron' else '#7f8896', hf)
    k(f'{m}_knife', knife, M[m], {'bronze': M['wood'], 'iron': M['leather'], 'steel': M['black'], 'alloy': M['comp']}[m], 0.85, shape={'bronze': 'leaf', 'iron': 'knife', 'steel': 'knife', 'alloy': 'knife'}[m])
# clothing
k('straw_hat', hat, 'straw', M['reed']); k('linen_cap', hat, 'cap', '#efe6d2'); k('rain_hood', hat, 'hood', '#b59b50'); k('fur_hat', hat, 'fur', '#8a6a48')
k('linen_shirt', shirt, '#f1e9d6'); k('padded_jacket', shirt, '#7aa0c8', quilt=True); k('fur_coat', shirt, '#8a5f3e', coat=True, accent='#e9d8b8')
k('raincoat', shirt, '#f5c83a', coat=True, hood=True); k('oilskin_coat', shirt, '#33363f', coat=True, quilt=True, hood=True)
k('linen_trousers', trousers, '#ece2cb'); k('padded_trousers', trousers, '#6f93b8', quilt=True); k('fur_leggings', trousers, '#8a5232', fur='#e9d8b8'); k('waxed_trousers', trousers, '#9b8a52', pocket=True)
k('reed_sandals', boots, M['reed'], sandal=True); k('leather_boots', boots, '#9a5a32', lace='#f1e7cf'); k('fur_boots', boots, '#8a5232', fur='#efe2c8'); k('rubber_boots', boots, '#2f3138', sole='#1c1d22', tall=True)
k('cloth_gloves', gloves, '#d9c9a5', fingerless=True); k('leather_gloves', gloves, '#9a5a32'); k('fur_mittens', gloves, '#c69a6c', kind='mitten', cuff='#efe2c8')
k('fur_cloak', cloak, '#7d5a3e', '#d9bf98'); k('reed_satchel', bag, 'satchel', M['reed']); k('leather_backpack', bag, 'pack', '#9a5a32'); k('frame_pack', bag, 'frame', '#b7a173', acc='#7d5a35'); k('tactical_pack', bag, 'tactical', '#33363f', acc='#6f7884')
# armor
for m in ('bone', 'bronze', 'iron', 'steel', 'composite'):
    for p in ('helmet', 'cuirass', 'greaves', 'boots', 'gauntlets'): k(f'{m}_{p}', armor, p, m)
# melee
k('bronze_mace', mace, M['bronze']); k('iron_mace', mace, M['iron'], spikes=True, flange=False); k('steel_mace', mace, M['steel'], haft=M['dwood']); k('alloy_warhammer', hammer, M['alloy'], M['black'])
k('steel_sword', sword, M['steel']); k('alloy_sword', sword, M['alloy'], M['black'], '#8fd0ea', 1.05); k('bone_dagger', knife, M['bone'], M['leather'], .8, guard=False, shape='blade')
k('bronze_dagger', knife, M['bronze'], M['wood'], .75, shape='blade'); k('iron_dagger', knife, M['iron'], M['leather'], .9, shape='stiletto'); k('steel_dagger', knife, M['steel'], M['black'], .8, shape='blade')
k('iron_machete', machete, M['iron'], M['wood']); k('steel_machete', machete, '#4a4f5a'); k('stone_maul', maul, M['stone'], M['wood']); k('iron_sledgehammer', maul, M['iron'], M['wood'], lashed=False, longh=True)
k('steel_sledgehammer', maul, M['steel'], '#e2504a', lashed=False, longh=True); k('nail_bat', bat)
# ammo
k('sling_stone', stones); k('flint_arrow', arrow, M['flint']); k('iron_arrow', arrow, M['iron']); k('fire_arrow', arrow, M['iron'], fire=True, n=1)
k('iron_bolt', arrow, M['iron'], '#c9503f', bolt=True); k('steel_bolt', arrow, M['steel'], '#3c3f49', bolt=True)
k('musket_ball', cartridge, paper=True, n=2); k('pistol_round', cartridge); k('rifle_round', cartridge, long=1.5, n=2); k('ap_rifle_round', cartridge, tip=M['black'], long=1.5, n=2)
k('shotgun_shell', shell); k('slug_shell', shell, slug=True); k('incendiary_shell', shell, inc=True)
# ranged
k('sling', sling); k('short_bow', bow); k('recurve_bow', bow, M['dwood'], tips=M['bone'], recurve=True); k('longbow', bow, '#c58a4a', scale=1.15)
k('laminated_bow', bow, M['dwood'], tips=M['steel'], recurve=True, back=M['steel']); k('compound_bow', compound)
k('light_crossbow', crossbow); k('crossbow', crossbow, M['wood'], M['iron'], stirrup=True); k('steel_crossbow', crossbow, M['dwood'], M['steel'], stirrup=True, crank=True)
k('flintlock_pistol', gun, 'flintlock', M['wood'], M['iron']); k('revolver', gun, 'revolver', M['dwood'], M['steel']); k('semi_auto_pistol', gun, 'semi')
k('pipe_shotgun', gun, 'pipe', M['wood'], M['iron']); k('pump_shotgun', gun, 'pump', M['dwood'], M['steel']); k('hunting_rifle', gun, 'hunting', M['wood'], '#5a6370')
k('marksman_rifle', gun, 'marks', M['comp'], M['black']); k('auto_rifle', gun, 'auto', '#2f3138', M['black'])
# hybrid
k('bronze_spear', spear, M['bronze']); k('iron_spear', spear, M['iron']); k('steel_spear', spear, M['steel'], M['dwood'], tip='point')
k('bronze_throwing_axe', throwaxe, M['bronze']); k('iron_throwing_axe', throwaxe, M['iron'], M['dwood']); k('steel_throwing_axe', throwaxe, '#4a4f5a', M['black'])
k('bayonet_musket', gun, 'musket', M['wood'], M['iron']); k('bayonet_rifle', gun, 'brifle', M['wood'], '#5a6370'); k('bayonet_carbine', gun, 'carbine', M['comp'], M['alloy'])
# explosive
k('molotov', molotov); k('incendiary_grenade', grenade_, inc=True); k('black_powder_bomb', bomb); k('pipe_bomb', pipebomb); k('grenade', grenade_); k('satchel_charge', satchel); k('breaching_charge', breach)
HELD = [x for x in T if any(x.endswith(s) for s in ('_axe', '_pickaxe', '_shovel', '_knife', '_mace', '_warhammer', '_sword', '_dagger', '_machete', '_maul', '_sledgehammer', '_bat', '_spear'))
        or x in ('sling', 'short_bow', 'recurve_bow', 'longbow', 'laminated_bow', 'compound_bow', 'light_crossbow', 'crossbow', 'steel_crossbow', 'flintlock_pistol', 'revolver', 'semi_auto_pistol',
                 'pipe_shotgun', 'pump_shotgun', 'hunting_rifle', 'marksman_rifle', 'auto_rifle', 'bayonet_musket', 'bayonet_rifle', 'bayonet_carbine')]
