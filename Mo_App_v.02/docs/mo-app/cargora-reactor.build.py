#!/usr/bin/env python3
"""Adds the cursor interaction (Reactor + sfx) to the Motion In scene of the Cargora project, as an agent-channel update.

The cursor comes in from outside the screen, hovers the route's marker (the label "36.2N 151.8W" shows), goes to the CO2 chart and hovers
the three columns before the highlighted one: while it rests on one, the label "CO2 today" reads "CO2 Yesterday" / "CO2 Wed" / "CO2 Tue"
and the number 412 t counts to that day's value; then it leaves the screen. No tap or click: the cursor only moves and rests (Cursor items);
each rest has a minimal hover tick (sound.ts). Motion In gets 10 s.

It only adds what is missing and changes nothing else: everything the user changed in the app since is kept, because the scenes, their
overlap (lead), the layers and the plans are read from the newest autosave. Run it only after the autosave is at least 12 s old.

    python3 cargora-reactor.build.py [out.json]
    node scripts/mo-agent.mjs apply out.json
"""
import copy, json, os, sys, time

HOME = os.path.expanduser("~")
SRC = os.path.join(HOME, "Documents/Mo_App/Recovered/Cargora - Logistic Dashboard.json")
PROJECT = "Cargora - Logistic Dashboard"
OUT = next((a for a in sys.argv[1:] if not a.startswith("--")), "cargora-reactor.json")
SCENE = "scene-1"        # Motion In
SECONDS = 10.0           # its new length
OLD_SECONDS = 9.0        # what it has now (6 s at first, 9 s with the first version of this script)

while time.time() - os.path.getmtime(SRC) < 12:
    time.sleep(1)        # the autosave may be up to 10 s old: wait until it has caught up with the app
data = json.load(open(SRC))
spec = copy.deepcopy(data["animation"])
block = spec["design"]["blocks"][0]
by_id = {i["id"]: i for i in block["items"]}
layers = copy.deepcopy(data["layers"])
panel = {l["id"]: l for l in layers}

# ---- the first version added three tip layers over the chart: the words now show in the card's own label, so they go -------------
TILE = "fg4-79"          # Tile / Emissions
for tid in ("tip-yesterday", "tip-wed", "tip-tue"):
    block["items"] = [i for i in block["items"] if i["id"] != tid]
    spec["layers"] = [l for l in spec["layers"] if l["id"] != tid]
    layers = [l for l in layers if l["id"] != tid]
# ---- the hovered column takes the active colour: a copy of the highlighted column (c 12) laid over each of the three ----------------------
COLUMNS = "fg4-81"       # the group the columns are in (its first children come on top of them)
ACTIVE = {"active-yesterday": ("Active Yesterday", 1425, 687, 85), "active-wed": ("Active Wed", 1418, 676, 96), "active-tue": ("Active Tue", 1411, 701, 71)}
for aid, (aname, ax, ay, ah) in ACTIVE.items():
    if aid in by_id:
        continue
    col = copy.deepcopy(by_id["fg4-96"])          # the highlighted column: #ddf247, 3 px wide, rounded
    col.update(id=aid, x=ax, y=ay, h=ah)
    block["items"].append(col)
    by_id[aid] = col
    spec["layers"] = [l for l in spec["layers"] if l["id"] != aid] + [{"id": aid, "name": aname}]
    at = next(i for i, l in enumerate(layers) if l["id"] == COLUMNS) + 1
    layers.insert(at, {"id": aid, "name": aname, "visible": True, "collapsed": False, "displayName": aname, "kind": "layer", "parentGroupId": COLUMNS})

# the lit columns are softer than the highlighted one
ACTIVE_OPACITY = 0.45
for aid in ACTIVE:
    for fill in by_id[aid]["fills"]:
        fill["opacity"] = ACTIVE_OPACITY

# the label sits in its own little frame (88 px wide) that cuts the text: wide enough for "CO2 Yesterday"
for c in by_id["fg4-114"]["clips"]:
    if c["f"] == "fg4-80":
        c["w"] = max(c["w"], 160)
spec["version"] = int(data["animation"]["version"]) + 1
names = {l["id"]: (l.get("displayName") or l["name"]) for l in layers}
counts = {}
for l in layers:
    counts[names[l["id"]]] = counts.get(names[l["id"]], 0) + 1
ref = lambda layer_id: names[layer_id] if counts[names[layer_id]] == 1 else layer_id   # the layer's name when it is the only one of that name

# ---- the scenes: Motion In gets 9 s; the live scene's values are the truth for the scene on show -------------------------
scenes = copy.deepcopy(data["values"]["scenes.items"])
live_id = scenes.get("activeId")
motion = next(s for s in scenes["items"] if s["id"] == SCENE)
motion["duration"] = SECONDS
params = copy.deepcopy(data["params"])           # the live params (the scene on show)
live_values = {}                                  # live scene targets to send when Motion In is the scene on show


def plan_of(holder):
    return holder["animation.params"]["plan"]


plan = plan_of(motion["slice"] if live_id != SCENE else {"animation.params": params})
# the plan's own length and the animations that ran the whole scene run the new whole scene
for seg in plan["segments"]:
    if abs(seg["travel"] + seg["hold"] - OLD_SECONDS) < 0.01:
        seg["travel"], seg["hold"] = SECONDS, 0
for a in plan["animations"]:
    if abs(a["delay"]) < 1e-6 and abs(a["duration"] - OLD_SECONDS) < 0.01:
        a["duration"] = SECONDS

# ---- the cursor's times (Motion In's own seconds) -------------------------------------------------------------------------
W, H = spec["design"]["width"], spec["design"]["height"]
pct = lambda x, y: (round(x / W * 100, 2), round(y / H * 100, 2))
MARKER = pct(487.5, 998.5)                 # the route's marker ("Indicators 2")
BAR_Y = 735                                # inside the columns (they span y 652 - 772)
BARS = [pct(1425 + 1.5, BAR_Y), pct(1418 + 1.5, BAR_Y), pct(1411 + 1.5, BAR_Y)]   # the three columns before the highlighted one (x 1432): yesterday, Wed, Tue
OUTSIDE_IN, OUTSIDE_OUT = (104.0, 56.0), (106.0, 42.0)
T0 = 3.2                                   # the cards are in by 2.9 s
HOVER = 0.7                                # how long it rests on a column
steps = [
    # (type, from, to, duration, hold): only Cursor items, no tap or click; an item whose from and to are the same is a rest (a hover)
    ("cursor", OUTSIDE_IN, MARKER, 1.2, 0.0),     # comes in from outside the screen
    ("cursor", MARKER, MARKER, 0.9, 0.0),         # hovers the marker: the label shows
    ("cursor", MARKER, BARS[0], 0.9, 0.0),        # to the chart
    ("cursor", BARS[0], BARS[0], HOVER, 0.0),     # yesterday
    ("cursor", BARS[0], BARS[1], 0.25, 0.0),
    ("cursor", BARS[1], BARS[1], HOVER, 0.0),     # Wed
    ("cursor", BARS[1], BARS[2], 0.25, 0.0),
    ("cursor", BARS[2], BARS[2], HOVER, 0.0),     # Tue
    ("cursor", BARS[2], OUTSIDE_OUT, 0.9, 0.0),   # leaves the screen
]
items, at = [], T0
marks = []
for n, (kind, a, b, dur, hold) in enumerate(steps):
    items.append({
        "color": "#FFFFFF", "device": "desktop", "direction": "out", "duration": dur, "hold": hold, "id": "it-cargora-%02d" % (n + 1),
        "linked": n > 0, "loading": "spinner", "size": 40, "start": round(at, 3), "text": "Hello Mo_App", "toX": b[0], "toY": b[1],
        "type": kind, "x": a[0], "y": a[1],
    })
    marks.append((round(at, 3), round(at + dur + hold, 3)))
    at += dur + hold
END_AT = at
assert END_AT < SECONDS - 0.05, END_AT
hover_marker, hover_bar1, hover_bar2, hover_bar3, leave = marks[1], marks[3], marks[5], marks[7], marks[8]

# ---- the label and the tips show while the cursor is on them ---------------------------------------------------------------
SEG = plan["segments"][0]["id"]


def fx(i, name, effect, layer, delay, duration, **extra):
    return {"id": "fx-%s-hover-%02d" % (SEG, i), "name": name, "effect": effect, "layer": layer, "segmentId": SEG, "delay": round(delay, 3), "duration": round(duration, 3), "enabled": True, **extra}


LABEL, NUMBER = ref("fg4-114"), ref("fg4-83")          # "CO2 today" and "412 t"
VALUES = [(hover_bar1, "Yesterday", 292), (hover_bar2, "Wed", 330), (hover_bar3, "Tue", 244)]   # a column's value follows its height (412 t = the highlighted one, 120 high)
wanted = [
    fx(1, "Coordinates show", "in", ref("fg4-70"), hover_marker[0] + 0.05, 0.3),
    fx(2, "Coordinates hide", "out", ref("fg4-70"), hover_marker[1], 0.25),
]
previous = 412
for n, (mark, day, value) in enumerate(VALUES):
    wanted.append(fx(3 + n * 2, day + " in the label", "swap", LABEL, mark[0], mark[1] - mark[0], text="CO\u2082 " + day))
    wanted.append(fx(4 + n * 2, day + " count", "count", NUMBER, mark[0], 0.5, **{"from": previous, "to": value}))
    previous = value
wanted.append(fx(9, "Count back", "count", NUMBER, leave[0], 0.6, **{"from": previous, "to": 412}))
ACTIVE_NAMES = ["Active Yesterday", "Active Wed", "Active Tue"]
for n, (mark, day, value) in enumerate(VALUES):
    wanted.append(fx(10 + n * 2, day + " column lights", "in", ACTIVE_NAMES[n], mark[0], 0.12))
    wanted.append(fx(11 + n * 2, day + " column dims", "out", ACTIVE_NAMES[n], mark[1] - 0.12, 0.12))
# the animations of the first version that are not wanted any more go; the ones above are this script's own, so they take its times
gone = {"fx-%s-hover-%02d" % (SEG, i) for i in range(1, 20)}
plan["animations"] = [a for a in plan["animations"] if a["id"] not in gone]
plan["animations"] += wanted

# ---- the coordinates and the lit columns are shown by the hover only: the Start and End scenes (the design as it is drawn) hide them -----
for scene_id in ("scene-start", "scene-end"):
    other = next((sc for sc in scenes["items"] if sc["id"] == scene_id), None)
    if not other:
        continue
    holder = params if live_id == scene_id else other["slice"]["animation.params"]
    other_plan = holder["plan"]
    seg = other_plan["segments"][0]["id"]
    hides = [("fx-%s-hover-01" % seg, "Coordinates hidden", ref("fg4-70"))] + [("fx-%s-hover-%02d" % (seg, 2 + k), nm + " hidden", nm) for k, nm in enumerate(["Active Yesterday", "Active Wed", "Active Tue"])]
    ids = {h[0] for h in hides}
    other_plan["animations"] = [a for a in other_plan["animations"] if a["id"] not in ids]
    other_plan["animations"] += [{"id": i, "name": n, "effect": "hide", "layer": l, "segmentId": seg, "delay": 0, "duration": other["duration"], "enabled": True} for i, n, l in hides]

# ---- the loops (wind dial, waves) carry on from scene to scene: each scene's phase is where it starts on the timeline -------------------
starts, end, previous = {}, 0.0, None
for scene in scenes["items"]:
    lead = min(scene.get("lead", 0) or 0, (previous["duration"] if previous else 0) - 0.1, scene["duration"] - 0.1) if previous else 0
    start = (end - max(0, lead)) if previous else 0.0
    starts[scene["id"]] = round(start, 3)
    end = start + scene["duration"]
    previous = scene
# the project loops: the last frame must be where the first one starts, so the loops make a whole number of turns / waves in the whole
# project (the number nearest to the speed they have now)
project_end = max(starts[sc_["id"]] + sc_["duration"] for sc_ in scenes["items"])
for scene in scenes["items"]:
    holder = params if live_id == scene["id"] else scene["slice"]["animation.params"]
    for a in holder["plan"]["animations"]:
        if a["effect"] in ("spin", "wave") and "phase" in a:
            a["phase"] = starts[scene["id"]]
            a["period"] = round(project_end / max(1, round(project_end / a["period"])), 4) if a.get("period") else a.get("period")

# ---- the fuel gauge: the revealed ticks follow the needle ----------------------------------------------------------------------------
# The ring (Ellipse 6 / 7) is a half circle of radius 76.15 around (1158.1, 753); the needle turns about its base (1165.36, 747.39), a little
# off the ring's centre, so the reveal grows along the ring (a wedge from the ring's centre) and ends under the needle's tip.
RING_CENTRE, NEEDLE_BASE, NEEDLE_LENGTH = (1158.1, 753.0), (1165.36, 747.39), 87.0
for a in plan["animations"]:
    if a["effect"] == "sweep":
        a.update(px=RING_CENTRE[0], py=RING_CENTRE[1], bx=NEEDLE_BASE[0], by=NEEDLE_BASE[1], reach=NEEDLE_LENGTH)

# ---- the Reactor and the sound of Motion In ---------------------------------------------------------------------------------
reactor = {"items": items, "seeded": True, "selected": None}
if live_id == SCENE:
    live_values = {"interactions.enabled": True, "interactions.list": reactor, "sound.sfx": True, "sound.sfxStyle": "soft"}
motion["slice"]["interactions.enabled"] = True
motion["slice"]["interactions.list"] = reactor
motion["slice"]["sound.sfx"] = True
motion["slice"]["sound.sfxStyle"] = "soft"
if live_id == SCENE:
    motion["slice"]["animation.params"] = params

# ---- the length of the project: the scenes follow one another, each starting `lead` seconds before the one ahead ends ------
end, total, previous = 0.0, 0.0, None
for scene in scenes["items"]:
    lead = min(scene.get("lead", 0) or 0, (previous["duration"] if previous else 0) - 0.1, scene["duration"] - 0.1) if previous else 0
    end = (end - max(0, lead) if previous else 0) + scene["duration"]
    total = max(total, end)
    previous = scene

update = {
    "project": PROJECT,
    "animation": spec,
    "layers": layers,
    "params": params,
    "values": {"scenes.items": scenes, **live_values},
    "durationSeconds": round(total, 3),
    "version": "Cursor interaction",
}
json.dump(update, open(OUT, "w"))
print("wrote", OUT, "| Motion In", SECONDS, "s | cursor", T0, "-", round(END_AT, 2), "| total", round(total, 2), "| hover animations", len(wanted), "| live scene", live_id)
