#!/usr/bin/env python3
"""Author ui/screens/*.json (schema: ui-screen/1, see UI_GUIDE.md §9). Plain JSON is the source of truth at runtime;
this script just keeps the 10 screens consistent. Re-run after edits: python3 tools/build_screens.py"""
import json, os
UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(UI, 'screens')


def W(type_, **kw):
    d = {"type": type_}
    ch = kw.pop('children', None)
    d.update({k.rstrip('_'): v for k, v in kw.items() if v is not None})
    if ch is not None:
        d["children"] = ch
    return d


def text(t, font='body', **kw): return W('text', text=t, font=font, **kw)
def icon(i, size=32, **kw): return W('icon', icon=i, w=size, h=size, **kw)
def btn(label, action, variant='primary', w=160, h=44, icon_=None, **kw):
    return W('button', label=label, variant=variant, w=w, h=h, icon=icon_, action=action, **kw)
def keyhint(key, label, **kw): return W('keyhint', key=key, label=label, **kw)


def window(id_, title, w, h, children, frame='panel_wood_vine', tabs_active=None, close=True, anchor='cc', x=0, y=0):
    kids = []
    if tabs_active:
        kids.append(W('include', src='_partials/journal_tabs.json', params={"active": tabs_active}, anchor='tl', x=28, y=-40))
    kids.append(W('panel', id=f'{id_}_frame', frame=frame, anchor='tl', x=0, y=0, w=w, h=h, pad=24, children=children))
    if not tabs_active:  # with journal tabs, the active tab is the title
        kids.append(W('ribbon', text=title, anchor='tc', x=0, y=-18, w=max(220, 26 * len(title) + 60), h=40))
    if close:
        kids.append(W('button', id='close', variant='close', anchor='tr', x=10, y=-10, w=32, h=32, action={"event": "ui.close", "args": {"screen": id_}}, hotkey='Escape', tooltip='Close (Esc)'))
    return W('box', id=f'{id_}_window', anchor=anchor, x=x, y=y, w=w, h=h, children=kids)


def save(name, screen):
    screen = {"$schema": "./screen.schema.json", "schema": "ui-screen/1", **screen}
    json.dump(screen, open(os.path.join(OUT, name + '.json'), 'w'), indent=1)


LOW = {'health': 0.25, 'hunger': 0.2, 'thirst': 0.2, 'stamina': 0.15}
VITALS = [("health", "player.vitals.health", "player.vitals.healthMax"),
          ("hunger", "player.vitals.hunger", "100"),
          ("thirst", "player.vitals.thirst", "100"),
          ("stamina", "player.vitals.stamina", "player.vitals.staminaMax")]

# ------------------------------------------------------------------ partials
json.dump({"schema": "ui-partial/1", "params": {"active": "inventory"},
           "root": W('tabs', id='journal_tabs', w=560, h=44, bind='{$active}', items=[
               {"id": "inventory", "label": "Backpack", "icon": "ic_bag", "hotkey": "Tab", "action": {"event": "ui.open", "args": {"screen": "inventory"}}},
               {"id": "crafting", "label": "Crafting", "icon": "ic_craft", "hotkey": "C", "action": {"event": "ui.open", "args": {"screen": "crafting"}}},
               {"id": "character", "label": "Me", "icon": "ic_person", "hotkey": "K", "action": {"event": "ui.open", "args": {"screen": "character"}}},
               {"id": "map", "label": "Map", "icon": "ic_map", "hotkey": "M", "action": {"event": "ui.open", "args": {"screen": "world_map"}}}])},
          open(os.path.join(OUT, '_partials', 'journal_tabs.json'), 'w'), indent=1)

json.dump({"schema": "ui-partial/1", "params": {"slot": "slot", "size": 48, "hotkey": None},
           "root": W('slot', w='{$size}', h='{$size}', bind='{$slot}', hotkey='{$hotkey}', draggable=True, foodStage='{$slot.item.food.stage}',
                     tooltip={"template": "_partials/item_tooltip.json", "params": {"item": "{$slot.item}"}},
                     action={"event": "inventory.slotClick", "args": {"container": "{$slot.container}", "index": "{$slot.index}"}})},
          open(os.path.join(OUT, '_partials', 'item_slot.json'), 'w'), indent=1)

json.dump({"schema": "ui-partial/1", "params": {"item": "{hover.item}"},
           "root": W('tooltip', id='item_tooltip', w=260, h='auto', pad=12, layout='col', gap=6, children=[
               W('box', layout='row', gap=8, h=40, align='center', children=[
                   W('slot', w=40, h=40, bind='{$item}', showCount=False),
                   W('box', layout='col', w='fill', h=40, children=[
                       text('{$item.name}', 'heading', h=22),
                       text('{$item.rarityLabel} · {$item.categoryLabel}', 'small', color='{"rarity." + $item.rarity}', h=16)])]),
               W('divider', w='fill', h=14),
               text('{$item.description}', 'small', w='fill', wrap=True, h='auto'),
               W('box', layout='row', gap=6, h=20, w='fill', align='center', visible='{$item.food}', children=[
                   W('foodbadge', stage='{$item.food.stage}', w=16, h=16), text('{$item.food.stageLabel}', 'label', w=70, color='{"food." + $item.food.stage}'),
                   W('bar', vital='hunger', value='{1 - $item.food.spoiled}', max=1, w='fill', h=12, thin=True)]),
               W('repeat', each='{$item.stats}', as_='stat', layout='col', gap=2, w='fill', h='auto', template=
                 W('box', layout='row', gap=6, h=20, w='fill', children=[icon('{stat.icon}', 20), text('{stat.label}', 'small', w='fill'), text('{stat.value}', 'label', color='{stat.color}')])),
               W('box', layout='row', h=18, w='fill', children=[icon('ic_weight', 16), text('{$item.weight|fixed1} kg', 'tiny', w='fill'),
                                                                 text('{$item.count}/{$item.maxStack}', 'tiny')])])},
          open(os.path.join(OUT, '_partials', 'item_tooltip.json'), 'w'), indent=1)

# ------------------------------------------------------------------ HUD
vit_rows = []
for k, v, m in VITALS:
    vit_rows.append(W('box', layout='row', gap=6, h=30, w='fill', align='center', children=[
        W('icon', icon=f'vital_{k}', w=32, h=32, iconLow=f'vital_{k}_low', lowWhen=f'{{{v} / {m} < {LOW[k]}}}', pulseWhenLow=True),
        W('bar', vital=k, value=f'{{{v}}}', max=f'{{{m}}}', w='fill', h=20, delta=True, tooltip=k.capitalize()),
        text(f'{{{v}|int}}', 'hudSmall', w=30, h=20, align='right')]))
vit_rows.append(W('box', layout='row', gap=6, h=30, w='fill', align='center', children=[
    W('icon', icon='vital_temp', w=32, h=32, iconCold='vital_cold', iconHot='vital_hot', bindTemp='{player.vitals.bodyTemp}'),
    W('bar', vital='temperature', value='{player.vitals.bodyTemp}', min=25, max=45, marker=True, comfort=[36, 38], w='fill', h=20, tooltip='Body temperature'),
    text('{player.vitals.bodyTemp|int}°', 'hudSmall', w=30, h=20, align='right')]))

hud_root = W('box', id='hud', w='fill', h='fill', children=[
    W('panel', id='vitals', visible='{!ui.windowOpen}', frame='panel_hud', anchor='tl', x=14, y=14, w=290, h='auto', pad=[10, 12, 10, 10], layout='col', gap=2, children=[
        W('box', layout='row', h=24, w='fill', gap=6, align='center', children=[
            text('{player.name}', 'hud', w='fill'),
            W('badge', text='Lv {player.xp.level}', color='plum-500', h=20, w=52)]),
        *vit_rows]),
    W('repeat', id='status_effects', visible='{!ui.windowOpen}', each='{player.effects}', as_='fx', anchor='tl', x=16, y=232, layout='row', gap=6, w=290, h=44,
      template=W('status', icon='{fx.icon}', w=40, h=40, remaining='{fx.remaining}', tone='{fx.tone}', tooltip='{fx.label}: {fx.description}')),
    W('minimap', id='minimap', anchor='tr', x=14, y=12, w=176, h=176, bind='{map.minimap}', markers='{map.markers}', memberPins='{map.memberPins}', heading='{player.facing}',
      action={"event": "ui.open", "args": {"screen": "world_map"}}, hotkey='M'),
    W('panel', id='clock', visible='{!ui.windowOpen}', frame='panel_hud', anchor='tr', x=30, y=192, w=144, h=40, pad=[4, 10, 4, 6], layout='row', gap=4, align='center', children=[
        W('icon', icon='{world.time.phaseIcon}', w=28, h=28),
        text('Day {world.time.day}', 'hudSmall', w='fill'),
        text('{world.time.hours|time}', 'hud', w=46, align='right')]),
    W('panel', id='weather', visible='{!ui.windowOpen}', frame='panel_hud', anchor='tr', x=178, y=192, w=40, h=40, pad=4, children=[W('icon', icon='{world.weather.icon}', w=32, h=32, anchor='cc', tooltip='{world.weather.label}')]),
    W('box', id='net_badge', anchor='tr', x=200, y=14, w=100, h=28, layout='row', gap=4, align='center', justify='end', visible='{net.connected}', children=[
        W('icon', icon='ic_players', w=24, h=24), text('{session.players.length}', 'hudSmall', w=18),
        W('icon', icon='ic_signal', w=24, h=24), text('{net.rtt|int}ms', 'hudSmall', w=44)]),
    # hotbar + xp
    W('box', id='hotbar_dock', visible='{!ui.buildMode}', anchor='bc', x=0, y=12, w=8 * 56 + 24, h=100, children=[
        W('bar', id='xp', vital='xp', value='{player.xp.value}', max='{player.xp.next}', anchor='tc', x=0, y=0, w=8 * 56 - 40, h=14, thin=True, tooltip='XP {player.xp.value}/{player.xp.next}'),
        W('panel', frame='panel_hud', anchor='bc', x=0, y=0, w=8 * 56 + 24, h=76, pad=[12, 12, 12, 12], children=[
            W('repeat', each='{hotbar.slots}', as_='slot', layout='row', gap=4, w='fill', h=52, template=
              W('include', src='_partials/item_slot.json', params={"slot": "{slot}", "size": 52, "hotkey": "{slot.hotkey}"}))])]),
    W('box', id='craft_queue_mini', anchor='bc', x=330, y=24, w=150, h=56, visible='{crafting.queue.length > 0 && !ui.buildMode}', layout='col', gap=4, children=[
        text('Crafting {crafting.queue.0.name}', 'hudSmall', h=18),
        W('bar', vital='xp', value='{crafting.queue.0.progress}', max='{crafting.queue.0.total}', w='fill', h=16, style='stamina')]),
    # interaction prompt (world-anchored; screen position from renderer via worldToScreen)
    W('box', id='interact', anchor='cc', x=40, y=-70, w=170, h=36, worldAnchor='{interact.screenPos}', visible='{interact.visible && !ui.windowOpen && !ui.buildMode}', layout='row', gap=6, align='center', children=[
        W('keyhint', key='{input.bindings.interact}', label=''), text('{interact.verb} {interact.targetName}', 'hud', w='fill')]),
    W('bar', id='gather_progress', anchor='cc', x=40, y=-36, w=120, h=16, vital='stamina', value='{interact.progress}', max=1, visible='{interact.progress > 0 && !ui.windowOpen && !ui.buildMode}'),
    # chat (compact)
    W('include', src='chat.json#compact', visible='{!ui.windowOpen && !ui.buildMode}', anchor='bl', x=14, y=14),
    # toasts
    W('repeat', id='toasts', visible='{!ui.windowOpen}', each='{toasts}', as_='t', anchor='cr', x=14, y=-40, layout='col', gap=8, w=300, h='auto', template=
      W('toast', kind='{t.kind}', title='{t.title}', text='{t.text}', icon='{t.icon}', w=300, h=56, ttl='{t.ttl}')),
    W('box', id='keyhints', visible='{!ui.windowOpen && !ui.buildMode}', anchor='br', x=14, y=14, w=180, h=128, layout='col', gap=4, children=[
        keyhint('Tab', 'Backpack', w='fill'), keyhint('C', 'Crafting', w='fill'), keyhint('B', 'Build', w='fill'), keyhint('M', 'Map', w='fill')]),
])
save('hud', {"id": "hud", "title": "HUD", "layer": "hud", "modal": False, "design": [1280, 720], "root": hud_root,
             "hotkeys": {"Digit1..Digit8": {"event": "hotbar.select", "args": {"index": "$n-1"}}, "Wheel": {"event": "hotbar.cycle"}}})

# ------------------------------------------------------------------ chat (+ compact variant)
compact = W('box', id='chat_compact', w=400, h=150, layout='col', gap=6, children=[
    W('panel', frame='panel_hud', w='fill', h='fill', pad=[8, 12, 8, 12], opacity=0.85, children=[
      W('repeat', each='{chat.recent}', as_='m', layout='col', gap=4, w='fill', h='fill', justify='end', template=
        W('chatline', channel='{m.channel}', channelId='{m.channelId}', from_='{m._vm.fromName}', fromPlayer='{m.fromPlayer}', text='{m.text}', emote='{m.emote}', mentions='{m.mentions}', kind='{m._vm.kind}', highlight='{m._vm.mentionsMe}', w='fill', h=20, fadeAfterTicks=200, tick='{m.tick}'))]),
    W('box', layout='row', gap=6, h=28, align='center', children=[keyhint('Enter', 'Chat'), keyhint('P', 'Players')])])
full_chat = window('chat', 'Camp Chat', 560, 460, [
    W('panel', frame='panel_inset', anchor='tl', x=0, y=0, w=512, h=340, pad=10, children=[
        W('list', id='chat_log', w='fill', h='fill', scroll='{chat.scroll}', stickToBottom=True, children=[
            W('repeat', each='{chat.history}', as_='m', layout='col', gap=6, w='fill', h='auto', template=
              W('chatline', channel='{m.channel}', channelId='{m.channelId}', from_='{m._vm.fromName}', fromPlayer='{m.fromPlayer}', text='{m.text}', emote='{m.emote}', mentions='{m.mentions}', kind='{m._vm.kind}', highlight='{m._vm.mentionsMe}', time='{m.tick|tickclock}', w='fill', h=22, dark=False,
                contextMenu={"player": "{m.fromPlayer}", "messageTick": "{m.tick}", "items": ["whisper", "mute", "block", "report"]}))])]),
    W('box', anchor='bl', x=0, y=0, w=512, h=48, layout='row', gap=8, align='center', children=[
        W('button', id='chat_channel', variant='secondary', label='{chat.channel|channel|upper}', w=96, h=44, tooltip='Channel (Tab to cycle): global, local, party, clan, trade, /w name',
          action={"event": "chat.cycleChannel"}),
        W('input', id='chat_input', w='fill', h=44, bind='{chat.draft}', placeholder='Say something nice...', maxLength=200, focus=True,
          action={"event": "chat.send", "args": {"channel": "{chat.channel}", "text": "{chat.draft}", "to": "$whisperTarget", "mentions": "$resolvedMentions", "emote": "$emote"}, "maps": "client.chat.send(channel, text, {to?, mentions?, emote?})"}),
        btn('Send', {"event": "chat.send", "args": {"text": "{chat.draft}"}}, 'primary', w=96, h=44)])], anchor='cc', x=-190)
member_row = lambda src: W('repeat', each=src, as_='p', layout='col', gap=6, w='fill', h='auto', template=
  W('panel', frame='panel_inset', w='fill', h=56, pad=[6, 8, 6, 8], layout='row', gap=8, align='center', opacity='{p._vm.online ? 1 : 0.6}', children=[
      W('avatar', color='{p.playerId}', online='{p._vm.online}', w=36, h=36),
      W('box', layout='col', w='fill', h=44, gap=2, children=[
          W('box', layout='row', gap=6, h=20, w='fill', align='center', children=[text('{p._vm.name}', 'label', w=76), W('rank', role='{p.role}', w=54, h=18)]),
          W('bar', vital='health', value='{p._vm.hpPct}', max=1, w='fill', h=14, thin=True, visible='{p._vm.online && p._vm.hpPct != null}'),
          text('{p._vm.inView ? "" : "far away"}', 'tiny', h=14, visible='{p._vm.online && p._vm.hpPct == null}'),
          text('offline', 'tiny', h=14, visible='{!p._vm.online}')]),
      W('button', variant='secondary', icon='ic_chat', w=32, h=32, tooltip='Whisper / mute / block / report...', action={"event": "ui.contextMenu", "args": {"player": "{p.playerId}", "items": ["whisper", "mute", "block", "report", "party.kick", "clan.promote"]}}, visible='{p.playerId != me.playerId}')]))
players = window('players', 'Campers', 340, 460, [
    W('tabs', w='fill', h=40, bind='{social.tab}', small=True, items=[
        {"id": "party", "label": "Party", "action": {"event": "social.tab", "args": {"tab": "party"}}},
        {"id": "clan", "label": "Clan", "action": {"event": "social.tab", "args": {"tab": "clan"}}},
        {"id": "server", "label": "Here", "action": {"event": "social.tab", "args": {"tab": "server"}}}]),
    W('panel', frame='panel_parchment', anchor='tl', x=0, y=40, w='fill', h=372, pad=10, layout='col', gap=6, children=[
        W('box', layout='row', h=24, w='fill', gap=6, align='center', visible='{social.tab == "party"}', children=[
            text('Party {groups._vm.party.members.length}/{groups._vm.party.max}', 'label', w='fill'),
            W('button', variant='primary', icon='ic_plus', w=32, h=28, tooltip='Invite', action={"event": "party.invite"}),
            W('button', variant='danger', icon='ic_cross', w=32, h=28, tooltip='Leave party', action={"event": "party.leave"})]),
        W('box', layout='row', h=24, w='fill', gap=6, align='center', visible='{social.tab == "clan"}', children=[
            W('banner', bind='{groups._vm.clan.banner}', w=24, h=24), text('[{groups._vm.clan.tag}] {groups._vm.clan.name} {groups._vm.clan.members.length}/{groups._vm.clan.max}', 'label', w='fill')]),
        W('list', w='fill', h='fill', children=[
            W('box', layout='col', w='fill', h='auto', visible='{social.tab == "party"}', children=[member_row('{groups._vm.party.members}')]),
            W('box', layout='col', w='fill', h='auto', visible='{social.tab == "clan"}', children=[member_row('{groups._vm.clan.members}')])])]),
], frame='panel_wood', anchor='cc', x=290, close=False)
save('chat', {"contextMenu": {"whisper": {"event": "chat.whisper", "args": {"to": "$player"}}, "mute": {"event": "social.mute", "args": {"player": "$player"}}, "block": {"event": "social.block", "args": {"player": "$player"}}, "report": {"opens": "reportPicker", "reasons": "theme.report.reasons (1 Spam, 2 Abuse, 3 Cheating, 4 Other)"}}, "reportCommand": {"event": "net.reportPlayer", "args": {"targetPlayerId": "$player", "reason": "$reason", "messageTick": "$messageTick"}, "maps": "client.reportPlayer(targetPlayerId, reason, messageTick?)"}, "id": "chat", "setsState": {"ui.windowOpen": True}, "title": "Chat + player list", "layer": "window", "modal": False, "openWith": ["Enter", "KeyP"],
              "variants": {"compact": compact}, "root": W('box', w='fill', h='fill', children=[W('scrim', alpha=0.25), full_chat, players])})

# ------------------------------------------------------------------ inventory
eq = [("head", 0, 0), ("back", 2, 0), ("chest", 0, 1), ("mainhand", 2, 1), ("legs", 0, 2), ("offhand", 2, 2), ("feet", 0, 3), ("hands", 2, 3), ("trinket", 1, 3)]
eq_slots = [W('slot', id=f'eq_{k}', anchor='tl', x=6 + cx * 104, y=4 + cy * 60, w=52, h=52, bind=f'{{equipment.{k}}}', placeholderIcon=f'eq_{k}', tooltip=k.capitalize(),
              accepts=f'equip:{k}', action={"event": "equipment.slotClick", "args": {"slot": k}}) for k, cx, cy in eq]
inv = window('inventory', 'Backpack', 820, 400, [
    W('panel', id='paperdoll', frame='panel_inset', anchor='tl', x=0, y=0, w=272, h=352, pad=10, children=[
        W('portrait', bind='{player.appearance}', anchor='tl', x=64, y=8, w=96, h=176),
        *eq_slots,
        W('box', anchor='bl', x=0, y=0, w='fill', h=24, layout='row', gap=6, align='center', children=[
            W('icon', icon='st_cold', w=24, h=24), text('Warmth +{player.stats.insulation|int}°', 'small', w='fill'),
            ])]),
    W('box', anchor='tl', x=296, y=0, w=476, h=300, children=[
        W('box', layout='row', h=28, w='fill', gap=8, align='center', children=[
            text('Pockets', 'heading', w='fill'),
            W('button', variant='secondary', icon='ic_star', w=36, h=32, tooltip='Sort', action={"event": "inventory.sort"}),
            W('button', variant='danger', icon='ic_trash', w=36, h=32, tooltip='Drop selected', action={"event": "inventory.drop", "args": {"index": "{inventory.selected}"}})]),
        W('repeat', id='inv_grid', each='{inventory.slots}', as_='slot', layout='grid', cols=8, cell=[52, 52], gap=6, y=38, w='fill', h=110,
          template=W('include', src='_partials/item_slot.json', params={"slot": "{slot}", "size": 52, "hotkey": "{slot.hotkey}"})),
        W('panel', frame='panel_parchment', anchor='tl', x=0, y=162, w='fill', h=100, pad=[12, 16, 12, 16], layout='col', gap=6, children=[
            W('box', layout='row', gap=8, h=24, w='fill', align='center', children=[icon('ic_info', 20), text('Row 1 is your hotbar (keys 1-8).', 'small', w='fill')]),
            W('box', layout='row', gap=8, h=28, w='fill', align='center', children=[keyhint('LMB', 'Move'), keyhint('RMB', 'Use / eat'), keyhint('Shift', 'Split')])]),
        W('box', anchor='bl', x=0, y=0, w='fill', h=24, layout='row', gap=6, align='center', children=[
            icon('ic_weight', 20), text('Carry weight', 'label', w='fill'), text('{inventory.weight|fixed1} / {inventory.maxWeight|int} kg', 'label', w=120, align='right')])]),
    W('bar', id='weight_bar', vital='stamina', value='{inventory.weight}', max='{inventory.maxWeight}', anchor='bl', x=296, y=10, w=476, h=20),
    W('include', src='_partials/item_tooltip.json', params={"item": "{hover.item}"}, worldAnchor='{hover.screenPos}', anchor='tl', x=560, y=110, visible='{hover.item}')],
    tabs_active='inventory')
save('inventory', {"id": "inventory", "setsState": {"ui.windowOpen": True}, "title": "Inventory + equipment", "layer": "window", "modal": False, "pauses": False, "openWith": ["Tab", "KeyI"],
                   "root": W('box', w='fill', h='fill', children=[W('scrim', alpha=0.35), inv]),
                   "drag": {"source": "slot", "targets": ["slot", "eq_*", "world"], "events": ["inventory.move", "inventory.split(shift)", "inventory.drop(world)"]}})

# ------------------------------------------------------------------ crafting
craft = window('crafting', 'Crafting', 900, 500, [
    W('box', id='recipe_col', anchor='tl', x=0, y=4, w=300, h=430, layout='col', gap=8, children=[
        W('input', w='fill', h=40, bind='{crafting.filter}', placeholder='Search recipes...', icon='ic_info'),
        W('box', layout='row', gap=4, h=36, w='fill', children=[
            W('repeat', each='{crafting.categories}', as_='cat', layout='row', gap=4, w='fill', h=36, template=
              W('button', variant='{cat.active ? "gold" : "secondary"}', icon='{cat.icon}', w=44, h=36, tooltip='{cat.label}', action={"event": "crafting.filterCategory", "args": {"id": "{cat.id}"}}))]),
        W('panel', frame='panel_inset', w='fill', h='fill', pad=8, children=[
            W('list', id='recipe_list', w='fill', h='fill', scroll='{crafting.scroll}', children=[
                W('repeat', each='{recipes}', as_='r', layout='col', gap=4, w='fill', h='auto', template=
                  W('listitem', w='fill', h=46, selected='{r.id == crafting.selected}', disabled='{r.locked}', action={"event": "crafting.select", "args": {"recipe": "{r.id}"}}, children=[
                      W('slot', w=38, h=38, bind='{r.output}', showCount=False, anchor='cl', x=4),
                      text('{r.name}', 'label', anchor='cl', x=50, y=-8, w=170),
                      text('{r.stationLabel}', 'tiny', anchor='cl', x=50, y=10, w=170),
                      W('icon', icon='{r.craftable ? "ic_check" : r.locked ? "ic_lock" : "ic_cross"}', w=24, h=24, anchor='cr', x=8)]))])])]),
    W('panel', id='recipe_detail', frame='panel_parchment', anchor='tl', x=316, y=4, w=318, h=430, pad=16, layout='col', gap=8, children=[
        W('box', layout='row', gap=12, h=68, w='fill', align='center', children=[
            W('slot', w=64, h=64, bind='{crafting.current.output}', rarityFrame=True),
            W('box', layout='col', w='fill', h=60, gap=2, children=[
                text('{crafting.current.name}', 'heading', h=24),
                text('Makes {crafting.current.output.count} · {crafting.current.seconds}s', 'small', h=18),
                W('badge', icon='{crafting.current.stationIcon}', text='{crafting.current.stationLabel}', color='{crafting.current.stationOk ? "leaf-500" : "berry-500"}', h=22, w=140)])]),
        text('{crafting.current.description}', 'small', w='fill', h=36, wrap=True),
        W('divider', w='fill', h=14),
        text('Needs', 'label', h=20),
        W('repeat', each='{crafting.current.ingredients}', as_='ing', layout='col', gap=6, w='fill', h=150, template=
          W('box', layout='row', gap=8, h=42, w='fill', align='center', children=[
              W('slot', w=40, h=40, bind='{ing}', showCount=False),
              W('box', layout='col', w='fill', h=40, children=[text('{ing.name}', 'label', h=20), text('You have {ing.have}', 'tiny', h=16, color='{ing.have >= ing.count ? "text.success" : "text.danger"}')]),
              text('×{ing.count}', 'heading', w=50, align='right', color='{ing.have >= ing.count ? "text.primary" : "text.danger"}')])),
        W('box', layout='row', gap=8, h=48, w='fill', align='center', children=[
            W('stepper', bind='{crafting.quantity}', min=1, max='{crafting.current.maxCraftable}', w=120, h=40),
            btn('Craft!', {"event": "crafting.craft", "args": {"recipe": "{crafting.selected}", "count": "{crafting.quantity}"}}, 'primary', w='fill', h=48, icon_='ic_craft',
                disabled='{!crafting.current.craftable}', hotkey='Enter')])]),
    W('panel', id='craft_queue', frame='panel_inset', anchor='tl', x=650, y=4, w=202, h=430, pad=10, layout='col', gap=8, children=[
        text('Queue', 'label', h=20),
        W('repeat', each='{crafting.queue}', as_='q', layout='col', gap=8, w='fill', h='fill', template=
          W('box', layout='row', gap=6, h=48, w='fill', align='center', children=[
              W('slot', w=44, h=44, bind='{q.output}'),
              W('box', layout='col', w='fill', h=40, gap=4, children=[text('{q.name}', 'small', h=16), W('bar', vital='stamina', value='{q.progress}', max='{q.total}', w='fill', h=16)]),
              W('button', variant='close', w=24, h=24, action={"event": "crafting.cancel", "args": {"index": "{q.index}"}}, tooltip='Cancel')])),
        text('{crafting.queue.length}/{crafting.queueMax} slots', 'tiny', h=16, align='center')])],
    tabs_active='crafting')
save('crafting', {"id": "crafting", "setsState": {"ui.windowOpen": True}, "title": "Crafting", "layer": "window", "modal": False, "openWith": ["KeyC"],
                  "root": W('box', w='fill', h='fill', children=[W('scrim', alpha=0.35), craft])})

# ------------------------------------------------------------------ building
build = W('box', id='build', w='fill', h='fill', children=[
    W('box', id='build_ghost_hint', anchor='cc', x=0, y=-150, w=380, h=44, children=[
        W('panel', frame='panel_hud', w='fill', h='fill', pad=[6, 12, 6, 12], layout='row', gap=8, align='center', children=[
            W('icon', icon='{build.ghost.valid ? "ic_check" : "ic_cross"}', w=28, h=28),
            text('{build.ghost.message}', 'hud', w='fill')])]),
    W('box', id='build_panel', anchor='bc', x=0, y=8, w=960, h=250, children=[
        W('panel', frame='panel_wood', anchor='bl', x=0, y=0, w=960, h=228, pad=18, children=[
            W('box', id='build_categories', anchor='tl', x=0, y=8, w=140, h='fill', layout='col', gap=4, children=[
                W('repeat', each='{build.categories}', as_='cat', layout='grid', cols=3, cell=[44, 40], gap=4, w=140, h='fill', template=
                  W('button', variant='{cat.active ? "gold" : "secondary"}', icon='{cat.icon}', w=44, h=40, tooltip='{cat.label}', action={"event": "build.category", "args": {"id": "{cat.id}"}}))]),
            W('panel', frame='panel_inset', anchor='tl', x=152, y=0, w=508, h='fill', pad=8, children=[
                W('repeat', id='piece_grid', each='{build.pieces}', as_='p', layout='grid', cols=6, cell=[78, 70], gap=4, w='fill', h='fill', template=
                  W('card', w=78, h=70, icon='{p.icon}', label='{p.name}', selected='{p.key == build.selected}', disabled='{!p.affordable}', action={"event": "build.select", "args": {"piece": "{p.key}"}}))]),
            W('panel', id='piece_detail', frame='panel_parchment', anchor='tr', x=0, y=0, w=240, h='fill', pad=12, layout='col', gap=6, children=[
                text('{build.current.name}', 'heading', h=24),
                text('{build.current.description}', 'tiny', h=30, w='fill', wrap=True),
                W('repeat', each='{build.current.cost}', as_='c', layout='row', gap=6, w='fill', h=44, template=
                  W('slot', w=44, h=44, bind='{c}', countText='{c.have}/{c.count}', missing='{c.have < c.count}')),
                W('box', layout='row', gap=6, h=22, w='fill', children=[W('icon', icon='ic_home', w=20, h=20), text('HP {build.current.hp} · {build.current.footprint}', 'tiny', w='fill')])])])]),
    W('panel', id='build_hints', frame='panel_hud', anchor='bc', x=0, y=270, w=700, h=46, pad=[8, 16, 8, 16], layout='row', gap=22, justify='center', children=[
        keyhint('LMB', 'Place'), keyhint('R', 'Rotate {build.rotation|deg}'), keyhint('RMB', 'Cancel'), keyhint('Q/E', 'Cycle'), keyhint('B', 'Close')]),
    W('ribbon', text='Build Mode', anchor='bc', x=0, y=218, w=240, h=40),
])
save('building', {"id": "building", "setsState": {"ui.buildMode": True}, "title": "Building menu", "layer": "window", "modal": False, "passThroughWorld": True, "openWith": ["KeyB"],
                  "root": build, "hotkeys": {"KeyR": {"event": "build.rotate", "args": {"dir": 1}}, "KeyQ": {"event": "build.cycle", "args": {"dir": -1}}, "KeyE": {"event": "build.cycle", "args": {"dir": 1}}}})

# ------------------------------------------------------------------ world map
wm = window('world_map', 'World Map', 1060, 580, [
    W('panel', frame='panel_inset', anchor='tl', x=0, y=0, w=760, h=520, pad=6, children=[
        W('mapview', id='map', w='fill', h='fill', bind='{map.texture}', center='{map.center}', zoom='{map.zoom}', markers='{map.markers}', memberPins='{map.memberPins}', fog='{map.explored}',
          action={"event": "map.ping", "args": {"at": "$cursorWorld"}}),
        W('box', anchor='tr', x=8, y=8, w=40, h=88, layout='col', gap=6, children=[
            W('button', variant='secondary', icon='ic_plus', w=40, h=40, action={"event": "map.zoom", "args": {"delta": 1}}),
            W('button', variant='secondary', icon='ic_minus', w=40, h=40, action={"event": "map.zoom", "args": {"delta": -1}})]),
        W('panel', frame='panel_hud', anchor='bl', x=8, y=8, w=210, h=34, pad=[4, 10, 4, 8], layout='row', gap=6, align='center', children=[
            W('icon', icon='ic_pin', w=24, h=24), text('{map.cursor.x|int}, {map.cursor.y|int} · {map.cursor.biome}', 'hudSmall', w='fill')])]),
    W('panel', frame='panel_parchment', anchor='tr', x=0, y=0, w=236, h=520, pad=14, layout='col', gap=8, children=[
        text('Legend', 'heading', h=24),
        W('repeat', each='{map.legend}', as_='l', layout='col', gap=6, w='fill', h=260, template=
          W('box', layout='row', gap=8, h=32, w='fill', align='center', children=[W('icon', icon='{l.icon}', w=28, h=28), text('{l.label}', 'label', w='fill'), W('checkbox', bind='{l.visible}', w=28, h=28)])),
        W('divider', w='fill', h=14),
        btn('Center on me', {"event": "map.center", "args": {"on": "player"}}, 'info', w='fill', h=40, icon_='ic_person'),
        btn('Ping here', {"event": "map.ping"}, 'secondary', w='fill', h=40, icon_='ic_pin'),
        keyhint('M', 'Close map')])],
    tabs_active='map')
save('world_map', {"id": "world_map", "setsState": {"ui.windowOpen": True}, "title": "World map", "layer": "window", "modal": True, "openWith": ["KeyM"], "root": W('box', w='fill', h='fill', children=[W('scrim', alpha=0.5), wm])})

# ------------------------------------------------------------------ character sheet
stat_rows = [("ic_weight", "Carry weight", "{inventory.weight|fixed1} / {inventory.maxWeight} kg"), ("vital_temp", "Body temperature", "{player.vitals.bodyTemp|fixed1} °C"),
             ("vital_cold", "Feels like", "{player.vitals.feltTemp|int} °C"), ("st_wet", "Wetness", "{player.vitals.wetness|pct}"),
             ("st_cold", "Insulation", "+{player.stats.insulation|int} °C"), ("ic_zombie", "Zombies poofed", "{player.stats.kills}"), ("ic_day", "Days survived", "{player.stats.days}")]
char = window('character', 'About Me', 900, 500, [
    W('panel', frame='panel_inset', anchor='tl', x=0, y=4, w=250, h=430, pad=12, layout='col', gap=8, align='center', children=[
        W('portrait', bind='{player.appearance}', w=120, h=200),
        text('{player.name}', 'heading', h=26, align='center', w='fill'),
        W('badge', text='Level {player.xp.level} Camper', color='plum-500', w=160, h=24),
        W('bar', vital='xp', value='{player.xp.value}', max='{player.xp.next}', w='fill', h=20, showText=True),
        text('{player.xp.value} / {player.xp.next} XP', 'tiny', h=16, align='center', w='fill')]),
    W('panel', frame='panel_parchment', anchor='tl', x=266, y=4, w=300, h=430, pad=16, layout='col', gap=6, children=[
        text('Vitals', 'heading', h=24),
        *[W('box', layout='row', gap=8, h=32, w='fill', align='center', children=[W('icon', icon=f'vital_{k}', w=28, h=28), W('bar', vital=k, value=f'{{{v}}}', max=f'{{{m}}}', w='fill', h=20), text(f'{{{v}|int}}/{{{m}|int}}', 'small', w=56, align='right')]) for k, v, m in VITALS],
        W('divider', w='fill', h=14),
        W('repeat', each='{statRows}', as_='s', layout='col', gap=2, w='fill', h='auto', template=W('statrow', icon='{s.icon}', label='{s.label}', value='{s.value}', w='fill', h=24)),
    ]),
    W('panel', frame='panel_inset', anchor='tl', x=582, y=4, w=270, h=430, pad=12, layout='col', gap=8, children=[
        text('Feeling', 'heading', h=24),
        W('repeat', each='{player.effects}', as_='fx', layout='col', gap=6, w='fill', h=200, template=
          W('box', layout='row', gap=8, h=44, w='fill', align='center', children=[W('status', icon='{fx.icon}', w=40, h=40, tone='{fx.tone}'),
                                                                               W('box', layout='col', w='fill', h=40, children=[text('{fx.label}', 'label', h=20), text('{fx.description}', 'tiny', h=16)])])),
        W('divider', w='fill', h=14),
        text('Skills', 'heading', h=24),
        W('repeat', each='{player.skills}', as_='sk', layout='col', gap=4, w='fill', h='auto', template=
          W('box', layout='row', gap=6, h=26, w='fill', align='center', children=[W('icon', icon='{sk.icon}', w=24, h=24), text('{sk.label}', 'small', w=80), W('pips', value='{sk.level}', max=5, w='fill', h=16)]))])],
    tabs_active='character')
save('character', {"id": "character", "setsState": {"ui.windowOpen": True}, "title": "Player status / character sheet", "layer": "window", "modal": False, "openWith": ["KeyK"],
                   "derive": {"statRows": [{"icon": i, "label": l, "value": v} for i, l, v in stat_rows]},
                   "root": W('box', w='fill', h='fill', children=[W('scrim', alpha=0.35), char])})

# ------------------------------------------------------------------ main menu / connect
menu = W('box', id='main_menu', w='fill', h='fill', children=[
    W('backdrop', src='{menu.backdrop}', w='fill', h='fill'),
    W('logo', text='{app.title}', subtitle='{app.tagline}', anchor='tc', x=0, y=40, w=640, h=150),
    W('box', id='connect_window', anchor='cc', x=0, y=70, w=460, h=360, children=[
        W('panel', frame='panel_wood_vine', w=460, h=360, pad=26, layout='col', gap=10, children=[
            text('Server', 'label', h=20),
            W('input', id='server_url', bind='{net.serverUrl}', placeholder='ws://localhost:8080', w='fill', h=44, icon='ic_signal', disabled='{net.connecting}'),
            text('Your name', 'label', h=20),
            W('box', layout='row', gap=8, w='fill', h=44, children=[
                W('input', id='player_name', bind='{player.name}', placeholder='Camper', maxLength=16, w='fill', h=44, disabled='{net.connecting}'),
                W('repeat', each='{menu.colors}', as_='c', layout='row', gap=4, w=124, h=44, template=W('swatch', color='{c.hex}', selected='{c.selected}', w=28, h=28, action={"event": "player.setColor", "args": {"index": "{c.index}"}}))]),
            W('box', layout='row', gap=10, w='fill', h=56, children=[
                btn("{net.connecting ? 'Connecting…' : 'Connect'}", {"event": "net.connect", "args": {"url": "{net.serverUrl}", "name": "{player.name}"}}, 'primary', w='fill', h=56, icon_='ic_arrow_right', disabled='{net.connecting}', hotkey='Enter'),
                btn('Solo', {"event": "net.hostLocal"}, 'secondary', w=110, h=56, icon_='ic_home')]),
            W('panel', id='net_status', frame='panel_inset', w='fill', h=44, pad=[6, 10, 6, 10], layout='row', gap=8, align='center', children=[
                W('icon', icon='{net.statusIcon}', w=28, h=28, spin='{net.connecting}'),
                text('{net.statusText}', 'small', w='fill'),
                W('icon', icon='ic_signal', w=24, h=24, visible='{net.connected}'), text('{net.rtt|int} ms', 'label', w=56, align='right', visible='{net.connected}')]),
            text('{net.error}', 'small', color='text.danger', h=18, visible='{net.error}')])]),
    W('box', anchor='bc', x=0, y=24, w=520, h=44, layout='row', gap=12, justify='center', children=[
        btn('Settings', {"event": "ui.open", "args": {"screen": "pause_settings"}}, 'secondary', w=150, h=44, icon_='ic_gear'),
        btn('Credits', {"event": "ui.open", "args": {"screen": "credits"}}, 'secondary', w=150, h=44, icon_='ic_star'),
        btn('Quit', {"event": "app.quit"}, 'danger', w=120, h=44)]),
    text('v{app.version} · {net.protocol}', 'tiny', anchor='br', x=12, y=10, color='text.onDarkMuted', w=200, align='right'),
])
save('main_menu', {"id": "main_menu", "title": "Connect / main menu (replaces the netcode debug overlay)", "layer": "modal", "modal": True, "root": menu,
                   "replaces": "apps/client net connect overlay (server URL, name, Connect, status/RTT)"})

# ------------------------------------------------------------------ pause / settings
row = lambda label, widget: W('box', layout='row', gap=10, h=40, w='fill', align='center', children=[text(label, 'label', w=200), widget])
settings = W('box', id='pause', w='fill', h='fill', children=[
    W('scrim', alpha=0.55),
    W('box', anchor='cl', x=110, y=0, w=250, h=380, children=[
        W('ribbon', text='Paused', anchor='tc', x=0, y=0, w=240, h=40),
        W('box', anchor='tl', x=5, y=60, w=240, h=320, layout='col', gap=12, children=[
            btn('Resume', {"event": "ui.close", "args": {"screen": "pause_settings"}}, 'primary', w='fill', h=52, icon_='ic_arrow_right', hotkey='Escape'),
            btn('Settings', {"event": "settings.tab", "args": {"tab": "audio"}}, 'gold', w='fill', h=52, icon_='ic_gear'),
            btn('Invite friends', {"event": "session.copyInvite"}, 'info', w='fill', h=52, icon_='ic_players'),
            btn('Leave camp', {"event": "net.disconnect"}, 'danger', w='fill', h=52, icon_='ic_home')])]),
    window('pause_settings', 'Settings', 640, 470, [
        W('tabs', w='fill', h=44, bind='{settings.tab}', small=True, items=[
            {"id": "game", "label": "Game"}, {"id": "video", "label": "Video"}, {"id": "audio", "label": "Audio"}, {"id": "controls", "label": "Keys"}, {"id": "access", "label": "Comfort"}]),
        W('panel', frame='panel_parchment', anchor='tl', x=0, y=44, w=592, h=356, pad=18, layout='col', gap=4, children=[
            row('Master volume', W('slider', bind='{settings.audio.master}', min=0, max=1, step=0.05, w='fill', h=32, valueText='{settings.audio.master|pct}')),
            row('Music', W('slider', bind='{settings.audio.music}', min=0, max=1, step=0.05, w='fill', h=32, valueText='{settings.audio.music|pct}')),
            row('Sound effects', W('slider', bind='{settings.audio.sfx}', min=0, max=1, step=0.05, w='fill', h=32, valueText='{settings.audio.sfx|pct}')),
            W('divider', w='fill', h=14),
            row('UI scale', W('slider', bind='{settings.ui.scale}', min=1, max=2, step=0.25, w='fill', h=32, valueText='{settings.ui.scale}x')),
            row('Big text', W('toggle', bind='{settings.access.largeText}', w=48, h=28)),
            row('Reduce motion', W('toggle', bind='{settings.access.reduceMotion}', w=48, h=28)),
            row('Colour-blind icons', W('checkbox', bind='{settings.access.shapeCues}', w=32, h=32, label='Shapes + patterns on bars')),
        ]),
    ], frame='panel_wood', anchor='cc', x=150)])
save('pause_settings', {"id": "pause_settings", "setsState": {"ui.windowOpen": True}, "title": "Pause + settings", "layer": "modal", "modal": True, "openWith": ["Escape"], "root": settings,
                        "note": "Multiplayer: the sim does not pause; 'Paused' only captures input locally."})

# ------------------------------------------------------------------ death / respawn
death = W('box', id='death', w='fill', h='fill', children=[
    W('scrim', alpha=0.7, color='choc-800', vignette=True),
    W('ghost', anchor='tc', x=0, y=50, w=150, h=130),
    text('Oh no... you poofed!', 'hero', anchor='tc', x=0, y=190, w=900, h=70, align='center'),
    text('{death.causeText}', 'title', anchor='tc', x=0, y=262, w=900, h=40, align='center', color='parchment-300'),
    W('panel', frame='panel_parchment', anchor='cc', x=0, y=70, w=520, h=120, pad=16, layout='row', gap=8, justify='between', children=[
        W('repeat', each='{death.stats}', as_='s', layout='row', gap=8, w='fill', h='fill', justify='between', template=
          W('stat', icon='{s.icon}', value='{s.value}', label='{s.label}', w=110, h=88))]),
    W('box', anchor='bc', x=0, y=110, w=700, h=56, layout='row', gap=14, justify='center', children=[
        btn('Respawn at camp', {"event": "player.respawn", "args": {"at": "bed"}}, 'primary', w=240, h=56, icon_='ic_campfire', disabled='{!death.canRespawnAtCamp}'),
        btn('Somewhere new', {"event": "player.respawn", "args": {"at": "random"}}, 'gold', w=220, h=56, icon_='ic_map'),
        btn('Watch friends', {"event": "player.spectate"}, 'secondary', w=200, h=56, icon_='ic_players')]),
    W('box', anchor='bc', x=0, y=64, w=420, h=36, layout='row', gap=8, align='center', children=[
        text('Respawn ready in', 'hudSmall', w=130),
        W('bar', vital='stamina', value='{death.cooldownLeft}', max='{death.cooldown}', w='fill', h=18, invert=True),
        text('{death.cooldownLeft|int}s', 'hud', w=40, align='right')]),
])
save('death', {"id": "death", "title": "Death / respawn", "layer": "modal", "modal": True, "root": death, "trigger": "gameplay.Died (owned entity)"})
def offer_grid(src, side_locked, editable):
    return W('panel', frame='panel_inset', w='fill', h=196, pad=8, children=[
        W('repeat', each=src, as_='o', layout='grid', cols=6, cell=[44, 44], gap=4, w='fill', h='fill', template=
          W('slot', w=44, h=44, bind='{o}', draggable=editable, foodStage='{o.food.stage}', action={"event": "trade.offer", "args": {"id": "{trade.current.id}", "remove": {"slot": "{o.slot}"}}} if editable else None)),
        W('lockstamp', anchor='cc', visible=side_locked, w=120, h=48)])


trade_win = window('trade', 'Trade', 760, 520, [
    W('box', layout='row', gap=16, anchor='tl', x=0, y=0, w='fill', h=280, children=[
        W('box', layout='col', gap=6, w='fill', h='fill', children=[
            W('box', layout='row', gap=6, h=28, w='fill', align='center', children=[W('avatar', color='{me.playerId}', w=28, h=28), text('You offer', 'heading', w='fill'),
                W('badge', icon='{trade.current.myLock ? "ic_lock" : "ic_info"}', text='{trade.current.myConfirm ? "Confirmed!" : trade.current.myLock ? "Locked in" : "Editing"}', color='{trade.current.myLock ? "leaf-500" : "slate-500"}', w=120, h=24)]),
            offer_grid('{trade._vm.mine}', '{trade.current.myLock}', True),
            text('{trade._vm.mine.length}/{trade._vm.maxLines} lines · rev {trade.current.myOfferRevision} · drag from your bag', 'tiny', h=16)]),
        W('box', layout='col', w=40, h='fill', justify='center', align='center', children=[icon('ic_arrow_right', 32), icon('ic_arrow_left', 32)]),
        W('box', layout='col', gap=6, w='fill', h='fill', children=[
            W('box', layout='row', gap=6, h=28, w='fill', align='center', children=[W('avatar', color='{trade.current.partner}', w=28, h=28), text('{trade._vm.partnerName} offers', 'heading', w='fill'),
                W('badge', icon='{trade.current.theirLock ? "ic_lock" : "ic_info"}', text='{trade.current.theirConfirm ? "Confirmed!" : trade.current.theirLock ? "Locked in" : "Editing..."}', color='{trade.current.theirLock ? "leaf-500" : "slate-500"}', w=132, h=24)]),
            offer_grid('{trade._vm.theirs}', '{trade.current.theirLock}', False),
            text('rev {trade.current.theirOfferRevision} · any change unlocks both sides!', 'tiny', h=16, color='text.warning')])]),
    W('panel', frame='panel_parchment', anchor='tl', x=0, y=290, w='fill', h=86, pad=[10, 12, 10, 12], children=[
        text('Your bag', 'label', anchor='tl', x=0, y=0, w=200, h=18),
        W('repeat', each='{inventory.slots}', as_='slot', anchor='tl', x=0, y=20, layout='row', gap=3, w='fill', h=40, limit=16, template=
          W('slot', w=38, h=38, bind='{slot}', draggable=True, foodStage='{slot.item.food.stage}', action={"event": "trade.offer", "args": {"id": "{trade.current.id}", "add": {"slot": "{slot.index}", "count": "$all|shift=half"}}}))]),
    W('box', anchor='bl', x=0, y=0, w='fill', h=52, layout='row', gap=12, align='center', children=[
        W('box', layout='col', w=220, h=44, gap=4, children=[text('Idle timeout in {trade._vm.idleSecondsLeft}s', 'small', h=18),
                                                           W('bar', vital='stamina', value='{trade._vm.idleSecondsLeft}', max='{trade._vm.idleSeconds}', w='fill', h=16)]),
        btn('{trade.current.myLock ? "Locked" : "Lock offer"}', {"event": "trade.lock", "args": {"id": "{trade.current.id}"}}, 'gold', w=170, h=48, icon_='ic_lock', disabled='{trade.current.myLock || trade.current.status != 1}'),
        btn('Confirm', {"event": "trade.confirm", "args": {"id": "{trade.current.id}", "version": "{trade.current.version}"}}, 'primary', w=160, h=48, icon_='ic_check', disabled='{!(trade.current.myLock && trade.current.theirLock) || trade.current.myConfirm}'),
        btn('Cancel', {"event": "trade.cancel", "args": {"id": "{trade.current.id}"}}, 'danger', w=120, h=48)])])
save('trade', {"id": "trade", "setsState": {"ui.windowOpen": True}, "title": "Player trade", "layer": "window", "modal": False,
               "opens": "tradeUpdated status 1 (Open)",
               "binds": "trade.current = net TradeView verbatim (client.trade.current / client.trade.on). trade._vm (adapter): partnerName, mine/theirs = myOffer/theirOffer lines resolved to item view-models (+food stage from createdTick), maxLines (16), idleSecondsLeft (120 s since last tradeUpdated)",
               "requestPrompt": "status 0 && !iRequested -> toast with Accept (trade.accept{id}) / Decline (trade.decline{id}); status 0 && iRequested -> 'Waiting for {partner}...' (30 s)",
               "ends": "status 2|3 -> close; toast theme.trade.endReasons[reason] (reason >= 100 -> hook)",
               "root": W('box', w='fill', h='fill', children=[W('scrim', alpha=0.35), trade_win])})
print('screens written:', sorted(f for f in os.listdir(OUT) if f.endswith('.json')))
