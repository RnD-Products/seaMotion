#!/usr/bin/env python3
"""Builds the agent-channel update that gives the Cargora project its motion.

Scenes (11 s): Start 1.5 s, Logo animation 2.5 s, Motion In 6 s, End 1 s. Every scene's motion is a hand-built Interaction plan
(segments + animations), so it shows in the Motion tab and in the timeline's Layer effects lane. The logo splash (a background, the
Cargora mark with its cube drawn by Trim path, and the text) is added to the design as a group inside the Cargora - Logistic Dashboard frame, on top of its other layers.

    python3 cargora-motion.build.py [out.json]       # reads the newest autosave in ~/Documents/seaMotion/Recovered
    node scripts/mo-agent.mjs apply out.json
"""
import base64, copy, json, os, re, sys

HOME = os.path.expanduser("~")
SRC = os.path.join(HOME, "Documents/seaMotion/Recovered/Cargora - Logistic Dashboard.json")
FONT = os.path.join(HOME, "Documents/seaMotion/Fonts/Geist-SemiBold.ttf")
PROJECT = "Cargora - Logistic Dashboard"

SCENE_SECONDS = [("scene-start", "Start", 1.5), ("scene-logo", "Logo animation", 2.5), ("scene-1", "Motion In", 6.0), ("scene-end", "End", 1.0)]

data = json.load(open(SRC))
spec = copy.deepcopy(data["animation"])
block = spec["design"]["blocks"][0]
W, H = spec["design"]["width"], spec["design"]["height"]

# ---- the logo splash: items --------------------------------------------------------------------------------------
CYAN = "#58CFDD"          # the colour of the first reference picture
by_id = {i["id"]: i for i in block["items"]}
box = by_id["fg4-2"]                      # the Container frame: x 80, y 80, 1440 x 1040
CLIPS = copy.deepcopy(by_id["fg4-5"]["clips"])   # what a direct child of Container is clipped by (the frame and the Container)
CX, CY = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
MARK = 116                # the Cargora mark, 2.9x the top bar's 40 px
GAP = 28
TEXT_W, TEXT_H = 206, 70  # "Cargora" in Geist SemiBold 56 px, measured
left = round(CX - (MARK + GAP + TEXT_W) / 2)
mark_x, mark_y = left, round(CY - MARK / 2)
text_x, text_y = left + MARK + GAP, round(CY - TEXT_H / 2)
F = MARK / 40


def scale_path(d):
    return re.sub(r"-?\d+(?:\.\d+)?", lambda m: ("%g" % round(float(m.group(0)) * F, 3)), d)


CUBE = [
    "M19.25 27.2975C19.478 27.4292 19.7367 27.4985 20 27.4985C20.2633 27.4985 20.522 27.4292 20.75 27.2975L26 24.2975C26.2278 24.166 26.417 23.9769 26.5487 23.7491C26.6803 23.5214 26.7497 23.263 26.75 23V17C26.7497 16.737 26.6803 16.4786 26.5487 16.2509C26.417 16.0231 26.2278 15.834 26 15.7025L20.75 12.7025C20.522 12.5709 20.2633 12.5015 20 12.5015C19.7367 12.5015 19.478 12.5709 19.25 12.7025L14 15.7025C13.7722 15.834 13.583 16.0231 13.4513 16.2509C13.3197 16.4786 13.2503 16.737 13.25 17V23C13.2503 23.263 13.3197 23.5214 13.4513 23.7491C13.583 23.9769 13.7722 24.166 14 24.2975L19.25 27.2975Z",
    "M20 27.5V20",
    "M13.475 16.25L20 20L26.525 16.25",
]


def item(**over):
    base = dict(alpha=1, blend="source-over", clips=copy.deepcopy(CLIPS), effects=[], ellipse=False, fills=[], kind="shape", radius=0, rot=0, strokes=[], sw=0)
    base.update(over)
    return base


solid = lambda color: [{"type": "SOLID", "opacity": 1, "blendMode": "NORMAL", "color": color}]
logo_items = [
    # The gradient of the reference picture: light cyan at the top (a little to the right), going down to a dark teal at the bottom left.
    item(id="logo-bg", x=box["x"], y=box["y"], w=box["w"], h=box["h"], fills=[{
        "type": "GRADIENT_LINEAR", "opacity": 1, "blendMode": "NORMAL",
        "stops": [{"position": p, "color": c, "alpha": 1} for p, c in [(0, "#84EAF5"), (0.25, "#6FE3F0"), (0.45, "#5ED5E4"), (0.65, "#40BCCE"), (0.85, "#1A9CAD"), (1, "#007A8C")]],
        "transform": [[-0.2269, 0.9456, 0.1407], [0.9456, 0.2269, -0.5]],
    }]),
    item(id="logo-circle", x=mark_x, y=mark_y, w=MARK, h=MARK, ellipse=True, fills=solid("#DDF247")),
    item(id="logo-cube", x=mark_x, y=mark_y, w=MARK, h=MARK, strokes=solid("#0B1214"), sw=round(2 * F, 2), cap="ROUND", join="ROUND", sa="CENTER", paths=[{"d": scale_path(d), "r": "NONZERO"} for d in CUBE]),
    item(
        id="logo-text", x=text_x, y=text_y, w=TEXT_W, h=TEXT_H, kind="text", fills=solid("#0B1214"),
        text={"align": "LEFT", "chars": "Cargora", "family": "Geist", "fonts": [{"family": "Geist", "style": "SemiBold", "weight": 600}], "lh": TEXT_H, "resize": "WIDTH_AND_HEIGHT", "ls": -1.2, "size": 56, "style": "SemiBold", "valign": "TOP", "weight": 600},
    ),
]
have = {i["id"] for i in block["items"]}
block["items"] = [i for i in block["items"] if not i["id"].startswith("logo-")] + logo_items
spec["layers"] = [l for l in spec["layers"] if not l["id"].startswith("logo-")] + [{"id": "logo-bg", "name": "Logo bg"}, {"id": "logo-circle", "name": "Logo circle"}, {"id": "logo-cube", "name": "Logo cube"}, {"id": "logo-text", "name": "Logo text"}]

# the font of the splash text (Geist SemiBold) travels with the project
if not any(f.get("asset") == "font-geist-semibold" for f in spec["fonts"]):
    spec["fonts"].append({"asset": "font-geist-semibold", "family": "Geist", "style": "normal", "weight": "600"})
spec["assets"]["font-geist-semibold"] = "data:font/ttf;base64," + base64.b64encode(open(FONT, "rb").read()).decode()
spec["version"] = int(data["animation"]["version"]) + 1

# ---- the Layers panel: the logo group on top of everything ----------------------------------------------------------
def row(id, name, kind, parent=None, collapsed=False):
    r = {"id": id, "name": name, "visible": True, "collapsed": collapsed, "displayName": name, "kind": kind}
    if parent:
        r["parentGroupId"] = parent
    return r


CONTAINER_ID = "fg4-2"  # the Container frame: all the motion happens inside it, so the logo group is its first child (on top of its other layers)
logo_rows = [
    row("logo-group", "Logo animation", "group", CONTAINER_ID),
    row("logo-text", "Logo text", "layer", "logo-group"),
    row("logo-mark", "Logo mark", "group", "logo-group"),
    row("logo-cube", "Logo cube", "layer", "logo-mark"),
    row("logo-circle", "Logo circle", "layer", "logo-mark"),
    row("logo-bg", "Logo bg", "layer", "logo-group"),
]
rest = [l for l in data["layers"] if not l["id"].startswith("logo-")]
at = next(i for i, l in enumerate(rest) if l["id"] == CONTAINER_ID) + 1
layers = rest[:at] + logo_rows + rest[at:]
names = {l["id"]: (l.get("displayName") or l["name"]) for l in layers}
# every layer the plan names must be one layer (or a group) of the panel
def name_of(layer_id):
    return names[layer_id]


CARDS = ["fg4-6", "fg4-176", "fg4-177", "fg4-178", "fg4-76", "fg4-77", "fg4-78", "fg4-79", "fg4-10", "fg4-11", "fg4-12", "fg4-13"]  # Frame 2, the 3 stats, the cards (marked layers)

# The numbers that count up while their card comes in (the marked texts): (animation name, text layer id, the card's layer id).
COUNT_TEXTS = [("Speed", "fg4-189", "fg4-176"), ("Heading", "fg4-185", "fg4-177"), ("Draft", "fg4-181", "fg4-178"), ("Voyage progress %", "fg4-172", "fg4-76"),
               ("Fuel %", "fg4-118", "fg4-78"), ("Wind", "fg4-28", "fg4-12"), ("Sea state", "fg4-17", "fg4-13")]
texts = {l["id"]: (l.get("displayName") or l["name"]) for l in layers}
name_counts = {}
for l in layers:
    n = l.get("displayName") or l["name"]
    name_counts[n] = name_counts.get(n, 0) + 1
COUNTS = []
for title, text_id, card_id in COUNT_TEXTS:
    card_at = 1.0 + CARDS.index(card_id) * 0.1
    layer = texts[text_id] if name_counts[texts[text_id]] == 1 else text_id   # the layer's name when it is the only one of that name
    COUNTS.append((title + " counts", "count", layer, "in", round(card_at + 0.15, 2), 1.2, {"from": 0}))

# ---- the plans -------------------------------------------------------------------------------------------------------
def anim(i, name, effect, layer, seg, delay, duration, **extra):
    return {"id": "fx-%s-%02d" % (seg, i), "name": name, "effect": effect, "layer": layer, "segmentId": seg, "delay": delay, "duration": duration, "enabled": True, **extra}


def plan(seg, title, seconds, anims):
    return {"segments": [{"id": seg, "name": title, "travel": seconds, "hold": 0}], "animations": [anim(i + 1, *a[:6], **(a[6] if len(a) > 6 else {})) for i, a in enumerate(anims)]}


plans = {
    "scene-start": plan("start", "Start", 1.5, [
        ("Logo bg fades in", "fade", "Logo bg", "start", 0.5, 1.0),
        ("Logo mark hidden", "hide", "Logo mark", "start", 0, 1.5),
        ("Logo text hidden", "hide", "Logo text", "start", 0, 1.5),
    ]),
    "scene-logo": plan("logo", "Logo animation", 2.5, [
        ("Frame bg hidden", "hide", "BG", "logo", 0, 2.5),
        ("Top bar hidden", "hide", "Top bar", "logo", 0, 2.5),
        ("Content hidden", "hide", "content", "logo", 0, 2.5),
        ("Circle in", "in", "Logo circle", "logo", 0.0, 0.55, {"blur": 12, "scale": 0}),
        ("Cube trim path", "trim", "Logo cube", "logo", 0.3, 0.5),
        ("Cube turn 3D", "flip", "Logo cube", "logo", 0.8, 0.6, {"angle": 360}),
        ("Cargora letters in", "letters", "Logo text", "logo", 0.5, 0.35, {"blur": 5, "slide": "right", "distance": 75, "stagger": 0.05}),
        ("Mark out", "out", "Logo mark", "logo", 1.75, 0.4, {"blur": 5, "slide": "left", "distance": 85}),
        ("Cargora letters out", "lettersOut", "Logo text", "logo", 1.75, 0.3, {"blur": 5, "slide": "left", "distance": 85, "stagger": 0.04}),
        ("Logo bg mask out", "reveal", "Logo bg", "logo", 2.1, 0.4),
    ]),
    "scene-1": plan("in", "Motion In", 6.0, [
        ("Logo hidden", "hide", "Logo animation", "in", 0, 6.0),
        ("Frame bg in", "in", "BG", "in", 0.1, 1.6, {"blur": 30, "scale": 280}),
        ("Top bar in", "in", "Top bar", "in", 0.7, 0.8, {"blur": 5, "slide": "top", "distance": 75}),
    ] + [(names[c] + " in", "in", names[c], "in", round(1.0 + i * 0.1, 2), 0.8, {"blur": 5, "slide": "bottom", "distance": 75}) for i, c in enumerate(CARDS)] + COUNTS),
    "scene-end": plan("end", "End", 1.0, [
        ("Logo hidden", "hide", "Logo animation", "end", 0, 1.0),
    ]),
}

# ---- the gauge and the loops -------------------------------------------------------------------------------------------
def ref(layer_id):
    """The name the plan uses for a layer: its name when it is the only layer with that name, else its id."""
    n = texts[layer_id]
    return n if name_counts[n] == 1 else layer_id


def add(scene_id, seg, entries):
    p = plans[scene_id]
    for e in entries:
        p["animations"].append(anim(len(p["animations"]) + 1, *e[:6], **(e[6] if len(e) > 6 else {})))


# Fuel gauge (Motion In): the needle swings from the left end of the dial to its place while the ticks and the soft band fill behind it.
NEEDLE = (1165.36, 747.39)   # where the needle starts (the middle of the dial)
NEEDLE_FINAL = 45.4          # the direction it ends at, in degrees (0 = right, 90 = up)
gauge_at = round(1.0 + CARDS.index("fg4-78") * 0.1 + 0.15, 2)
add("scene-1", "in", [
    ("Needle swings", "rotate", ref("fg4-121"), "in", gauge_at, 1.5, {"angle": -(180 - NEEDLE_FINAL), "px": NEEDLE[0], "py": NEEDLE[1]}),
    ("Ticks fill", "sweep", ref("fg4-123"), "in", gauge_at, 1.5, {"angle": NEEDLE_FINAL, "px": NEEDLE[0], "py": NEEDLE[1]}),
    ("Band fills", "sweep", ref("fg4-124"), "in", gauge_at, 1.5, {"angle": NEEDLE_FINAL, "px": NEEDLE[0], "py": NEEDLE[1]}),
])

# Loops: the wind dial turns and the waves run all through the motion. They are in step with the whole motion (the phase is where the scene
# starts), and their periods divide the 11 s, so the end meets the start and the loop does not jump.
TOTAL = sum(sec for _, _, sec in SCENE_SECONDS)
SPIN_PERIOD = TOTAL / 2   # two whole turns in the whole motion
WAVE_PERIOD = TOTAL / 5   # five wave lengths in the whole motion
WIND_CENTER = (1157.0, 962.0)
starts = {}
at = 0.0
for sid, _, sec in SCENE_SECONDS:
    starts[sid] = at
    at += sec
for sid, seg in (("scene-start", "start"), ("scene-1", "in"), ("scene-end", "end")):
    sec = dict((a, c) for a, _, c in SCENE_SECONDS)[sid]
    add(sid, seg, [
        ("Wind dial spins", "spin", ref("fg4-31"), seg, 0, sec, {"period": SPIN_PERIOD, "phase": starts[sid], "px": WIND_CENTER[0], "py": WIND_CENTER[1]}),
        ("Wave runs", "wave", ref("fg4-19"), seg, 0, sec, {"period": WAVE_PERIOD, "phase": starts[sid], "distance": 90}),
        ("Soft wave runs", "wave", ref("fg4-20"), seg, 0, sec, {"period": WAVE_PERIOD, "phase": starts[sid], "distance": 90}),
    ])

# ---- keep what the user changed ------------------------------------------------------------------------------------------
# The plans above are what this script wants; the project may have been edited in the app since (an effect changed, a bar moved, an animation
# added). An animation that is already in the project (same id, or same name in the same scene) is kept as the user left it; only the ones
# the project does not have yet are added. `--force name,name` takes the script's version of those animations instead.
FORCE = set()
for i, arg in enumerate(sys.argv):
    if arg == "--force" and i + 1 < len(sys.argv):
        FORCE = {n.strip() for n in sys.argv[i + 1].split(",") if n.strip()}
OUT = next((a for a in sys.argv[1:] if not a.startswith("--") and a not in (sys.argv[sys.argv.index("--force") + 1] if "--force" in sys.argv else None,)), "cargora-motion.json")
old_scenes_items = (data["values"].get("scenes.items") or {}).get("items", [])
live_id = (data["values"].get("scenes.items") or {}).get("activeId")
for scene in old_scenes_items:
    mine = plans.get(scene.get("id"))
    if not mine:
        continue
    slice_ = scene.get("slice") or {}
    existing = (slice_.get("animation.params") or {}).get("plan")
    if scene.get("id") == live_id:
        existing = (data.get("params") or {}).get("plan") or existing   # the scene on show: its live plan is the newest
    if not isinstance(existing, dict):
        continue
    have = existing.get("animations") or []
    by_id = {a.get("id"): a for a in have}
    by_name = {a.get("name"): a for a in have}
    merged = []
    for wanted in mine["animations"]:
        kept = by_id.get(wanted["id"]) or by_name.get(wanted["name"])
        merged.append(wanted if (wanted["name"] in FORCE or kept is None) else kept)
    keep_ids = {a["id"] for a in merged}
    merged += [a for a in have if a.get("id") not in keep_ids and a.get("name") not in {m["name"] for m in merged}]  # animations the user added
    mine["animations"] = merged
    if existing.get("segments"):
        mine["segments"] = existing["segments"]

# ---- the scenes and the live values ------------------------------------------------------------------------------------
old_scenes = data["values"].get("scenes.items") or {}
base_slice = {}
for it in old_scenes.get("items", []):
    if it.get("slice"):
        base_slice = it["slice"]
        break
shared = {k: v for k, v in (data.get("params") or {}).items() if k.startswith("__")}
items = []
for sid, name, seconds in SCENE_SECONDS:
    s = copy.deepcopy(base_slice)
    s["animation.params"] = {"plan": plans[sid]}
    items.append({"id": sid, "name": name, "duration": seconds, "motion": False, "slice": s, "start": "design"})
scenes_value = {"activeId": SCENE_SECONDS[0][0], "items": items, "preview": False}
live_params = {**shared, "plan": plans[SCENE_SECONDS[0][0]]}

update = {
    "project": PROJECT,
    "animation": spec,
    "layers": layers,
    "params": live_params,
    "values": {"scenes.items": scenes_value},
    "durationSeconds": sum(s for _, _, s in SCENE_SECONDS),
}
json.dump(update, open(OUT, "w"))
print("wrote", OUT, "spec version", spec["version"], "duration", update["durationSeconds"], "animations", sum(len(p["animations"]) for p in plans.values()))
