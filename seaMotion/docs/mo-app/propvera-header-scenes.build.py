# Builds PropVera_Header's scene update (v_09): fills docs/mo-app/propvera-header-motion.template.js with the data the current
# project's motion script already carries (numbers, bars, gauge, dot charts, pager, arrows), adds each element's area, writes the
# stage-based controls, and the scenes Start · Scene_01..Scene_08 · End with their Reactor items and plans.
# Run: python3 propvera-header-scenes.build.py <Recovered/PropVera_Header.json> <out.json>   (then: node scripts/mo-agent.mjs apply <out.json>)
import copy, json, re, subprocess, sys

SRC, OUT = sys.argv[1], sys.argv[2]
HERE = __file__.rsplit("/", 1)[0]
p = json.load(open(SRC))
a = copy.deepcopy(p["animation"])
old = a["design"]["motion"]


def const(name):
    m = re.search(r"^const %s = (.*);$" % name, old, re.M)
    return json.loads(m.group(1))


TEXTS, BARS, RING, COLUMNS, PAGER, ARROWS = (const(n) for n in ["TEXTS", "BARS", "RING", "COLUMNS", "PAGER", "ARROWS"])


def area_of_text(i):
    if i in ("fg2-727", "fg2-723", "fg2-719"):
        return 0
    if i.startswith("fg7") or i in ("fg2-653", "fg2-651"):
        return 1
    return 2  # fg8 (Maintenance) and fg2-232 / fg2-230 (Net operating income)


for t in TEXTS:
    t["area"] = area_of_text(t["id"])
for b in BARS:
    b["area"] = 2
RING["area"] = 1
for c in COLUMNS:
    c["area"] = 2 if c["order"] == 7 else 1
mins = {}
for e in TEXTS + BARS + [RING] + COLUMNS:
    mins[e["area"]] = min(mins.get(e["area"], 99), e["order"])
for e in TEXTS + BARS + [RING] + COLUMNS:
    e["rel"] = e["order"] - mins[e["area"]]

code = open(f"{HERE}/propvera-header-motion.template.js").read()
for name, value in [("TEXTS", TEXTS), ("BARS", BARS), ("RING", RING), ("COLUMNS", COLUMNS), ("PAGER", PAGER), ("ARROWS", ARROWS)]:
    code = code.replace(f"__{name}__", json.dumps(value, separators=(",", ":")))
open("/tmp/propvera-motion.built.js", "w").write(code)
lengths = json.loads(subprocess.check_output(["node", "-e", "const m = new Function('api','D','H', require('fs').readFileSync('/tmp/propvera-motion.built.js','utf8'))({},{},{}); process.stdout.write(JSON.stringify(m.lengths({})))"]))

G = {"00": "00 · Start", "09": "09 · End", "01": "01 · Cursor in", "02": "02 · Move for Arrows", "03": "03 · Next", "04": "04 · Data change", "05": "05 · Data change", "06": "06 · Data change", "07": "07 · Back twice", "08": "08 · Cursor out", "fx": "Shapes"}


def slider(id, label, group, default, lo, hi, step=0.05, layer="Segment", unit="s"):
    return {"default": default, "group": group, "id": id, "label": label, "layer": layer, "max": hi, "min": lo, "step": step, "type": "slider", "unit": unit}


def switch(id, label, group, layer):
    return {"default": True, "group": group, "id": id, "label": label, "layer": layer, "type": "switch"}


CONTROLS = [
    switch("flow.direct", "Without interaction (no clicks)", G["00"], "Segment"),
    slider("z.delay", "First data change delay (no clicks)", G["04"], 0.3, 0, 2, step=0.05),
    slider("s0.pause", "Pause", G["00"], 1.0, 0, 5),
    slider("s2.enterTime", "Entry time", G["01"], 1.0, 0.2, 3, layer="Cursor"),
    slider("s2.hold", "Pause", G["01"], 0.5, 0, 3),
    slider("s3.moveTime", "Move to arrow", G["02"], 0.7, 0.2, 2, layer="Cursor"),
    slider("click.delay", "Delay before click", G["03"], 0.3, 0, 2, layer="Cursor"),
    slider("click.time", "Click time", G["03"], 0.3, 0.1, 1, layer="Cursor"),
    slider("click.delay2", "Delay 2nd click", G["03"], 0.0, 0, 2, layer="Cursor"),
    slider("d3.delay", "Data delay after click", G["03"], 0.2, 0, 1),
    slider("d3.time", "Count time", G["03"], 1.0, 0.2, 2, layer="Numbers"),
    slider("d3.stagger", "Stagger", G["03"], 0.01, 0, 0.3, step=0.01, layer="Numbers"),
    slider("d3.hold", "Hold after", G["03"], 0.6, 0, 3),
]
for key, stage, layer in [("d4", "04", "Key stats"), ("d5", "05", "Occupancy · Rent collection"), ("d6", "06", "Maintenance · Net operating income")]:
    CONTROLS += [
        slider(f"{key}.delay", "Delay (after the zoom in)", G[stage], 0.9, 0, 2),
        slider(f"{key}.time", "Count time", G[stage], 1.0, 0.2, 2, layer=layer),
        slider(f"{key}.stagger", "Stagger", G[stage], 0.01, 0, 0.3, step=0.01, layer=layer),
        slider(f"{key}.hold", "Hold after", G[stage], 0.6, 0, 3),
    ]
CONTROLS += [
    slider("s7.moveTime", "Move to left arrow", G["07"], 0.5, 0.2, 2, layer="Cursor"),
    slider("s7.gap", "Gap between clicks", G["07"], 0.15, 0, 1, layer="Cursor"),
    slider("d7.delay", "Data delay after click", G["07"], 0.2, 0, 1),
    slider("d7.time", "Count time", G["07"], 1.0, 0.2, 2, layer="Numbers"),
    slider("d7.stagger", "Stagger", G["07"], 0.01, 0, 0.3, step=0.01, layer="Numbers"),
    slider("d7.hold", "Hold after", G["07"], 0.6, 0, 3),
    slider("s9.pause", "Pause", G["08"], 0.4, 0, 3),
    slider("s9.exitTime", "Exit time", G["08"], 0.9, 0.2, 3, layer="Cursor"),
    slider("s10.pause", "Pause", G["09"], 0.5, 0, 5),
    switch("ring.on", "Gauge trim", G["fx"], "Occupancy"),
    switch("bars.on", "Maintenance bars", G["fx"], "Maintenance"),
    switch("charts.on", "Dot charts", G["fx"], "Net operating income · Rent collection"),
    slider("letter.stagger", "Letter stagger", G["fx"], 0.04, 0, 0.2, step=0.005, layer="Numbers"),
    slider("letter.time", "Letter time", G["fx"], 0.6, 0.1, 1.5, layer="Numbers"),
    slider("letter.cycles", "Letter changes", G["fx"], 3, 0, 8, step=1, layer="Numbers", unit=""),
    slider("letter.blur", "Letter blur", G["fx"], 5, 0, 30, step=1, layer="Numbers", unit="px"),
    slider("letter.slide", "Letter slide", G["fx"], 10, 0, 30, step=1, layer="Numbers", unit="px"),
    slider("chart.stagger", "Column stagger", G["fx"], 0.025, 0, 0.15, step=0.005, layer="Dot charts"),
    slider("chart.dotStagger", "Dot stagger", G["fx"], 0.022, 0, 0.1, step=0.002, layer="Dot charts"),
    slider("chart.pop", "Dot pop time", G["fx"], 0.12, 0.04, 0.5, step=0.01, layer="Dot charts"),
]
a["design"]["motion"] = code
a["controls"] = CONTROLS
a["layers"] = [l for l in a["layers"] if "cursor" not in l["id"].lower()]
a["version"] += 1

# ---- The Reactor items of each scene (percent of the 1600 x 1200 artboard; times are the scene's own).
W, H = 1600, 1200
pct = lambda x, y: (round(x / W * 100, 4), round(y / H * 100, 4))
START, REST = pct(1720, 1330), pct(1372, 846)
RIGHT, LEFT = pct(ARROWS["right"]["x"] + 1, ARROWS["right"]["y"] + 2), pct(ARROWS["left"]["x"] + 1, ARROWS["left"]["y"] + 2)
n = 0


def it(type, start, dur, frm, to=None, hold=None):
    global n
    n += 1
    to = to or frm
    return {"id": f"it-{n}", "type": type, "start": round(start, 3), "duration": round(dur, 3), "hold": round(dur if hold is None else hold, 3), "linked": True,
            "device": "desktop", "size": 30, "color": "#111111", "x": frm[0], "y": frm[1], "toX": to[0], "toY": to[1]}


click = 0.3
L = lengths
c1 = 0.3
# Next: the second click comes after the first one's data change (see nextTimes in the motion template).
span3 = 1.0 + 0.01 * 2 + 0.3
c2 = c1 + click + 0.2 + span3 + 0.6 + 0.0
# Back twice: the second left click comes after the first one's data change (see backTimes in the motion template).
span7 = 1.0 + 0.01 * 2 + 0.3
cA = 0.5
cB = cA + click + 0.2 + span7 + 0.6 + 0.15
REACTOR = {
    "01": [it("cursor", 0, 1.0, START, REST, hold=0.5)],
    "02": [it("cursor", 0, 0.7, REST, RIGHT)],
    "03": [it("cursor", 0, c1 / 2, RIGHT), it("tap", c1, click, RIGHT), it("cursor", c1 + click, (c2 - c1 - click) / 2, RIGHT), it("tap", c2, click, RIGHT), it("cursor", c2 + click, (L["03"] - c2 - click) / 2, RIGHT)],
    "04": [it("cursor", 0, L["04"] / 2, RIGHT)],
    "05": [it("cursor", 0, L["05"] / 2, RIGHT)],
    "06": [it("cursor", 0, L["06"] / 2, RIGHT)],
    "07": [it("cursor", 0, 0.5, RIGHT, LEFT), it("tap", cA, click, LEFT), it("cursor", cA + click, (cB - cA - click) / 2, LEFT), it("tap", cB, click, LEFT), it("cursor", cB + click, (L["07"] - cB - click) / 2, LEFT)],  # waits in place while the data counts back
    "08": [it("cursor", 0, 0.2, LEFT), it("cursor", 0.4, 0.9, LEFT, START)],
}

params = {k: v for k, v in p["params"].items()}
live_sound = {k: v for k, v in p["values"].items() if k.startswith("sound.")}
fx = {c["id"]: c["default"] for c in CONTROLS}
motion_params = {k: v for k, v in fx.items()}


def plan(hold):
    return {"plan": {"segments": [{"id": "seg-pause", "name": "Pause", "travel": 0, "hold": hold}], "animations": []}}


def scene_slice(stage):
    s = dict(live_sound)
    s["interactions.enabled"] = True
    s["interactions.list"] = {"items": REACTOR[stage], "seeded": True, "selected": None}
    s["animation.params"] = dict(motion_params)
    return s


scenes = [{"id": "scene-start", "name": "Start", "duration": 1.0, "motion": True, "role": "00", "start": "design", "slice": {"animation.params": dict(motion_params)}}]
for i, stage in enumerate(["01", "02", "03", "04", "05", "06", "07", "08"], 1):
    scenes.append({"id": "scene-1" if i == 1 else f"scene-{i}", "name": f"Scene_{stage}", "duration": round(L[stage], 3), "motion": True, "role": stage, "start": "design", "slice": scene_slice(stage)})
scenes.append({"id": "scene-end", "name": "End", "duration": 0.5, "motion": True, "role": "09", "start": "design", "slice": {"animation.params": dict(motion_params)}})
total = round(sum(s["duration"] for s in scenes), 3)
live = scenes[1]["slice"]
values = {k: v for k, v in live.items() if k != "animation.params"}
values["scenes.items"] = {"activeId": "scene-1", "items": scenes, "preview": False}
shared = {k: v for k, v in params.items() if k.startswith("__")}
update = {"project": "PropVera_Header", "saveVersion": True, "version": "v_09", "animation": a, "params": {**shared, **live["animation.params"]}, "values": values, "durationSeconds": total}
json.dump(update, open(OUT, "w"))
print("lengths", {k: round(v, 3) for k, v in L.items()}, "total", total, [(s["name"], s["duration"]) for s in scenes])
