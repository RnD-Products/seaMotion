import collections, json, re, subprocess, sys

HERE = "/private/tmp/claude-501/-Users-seativedigital-Documents-Mo-App-Mo-App-v-01/1c2b27be-6559-4c40-8c8b-9c747e1394cf/scratchpad/pv"
SRC = "/Users/seativedigital/Documents/seaMotion/Recovered/PropVera_Header.json"
d = json.load(open(SRC))
a = d["animation"]
lay = d["layers"]
blocks = {b["id"]: b for b in a["design"]["blocks"]}
items = {it["id"]: (b["id"], it) for b in a["design"]["blocks"] for it in b["items"]}
kids = collections.defaultdict(list)
for l in lay:
    kids[l.get("parentGroupId")].append(l)


def leaves(gid):
    out = []
    for l in kids[gid]:
        if l["id"] in items:
            out.append(l["id"])
        out += leaves(l["id"])
    return out


def chars(i):
    return items[i][1]["text"]["chars"]


# ---- Numbers (pages 01, 02, 03) and the order they change in.
P = [
    # id, order, page 02, page 03
    ("fg2-727", 0, "$92.1M", "$78.9M"),
    ("fg2-723", 1, "$3,420", "$2,960"),
    ("fg2-719", 2, "6.1%", "7.2%"),
    ("fg7-25", 3, "97.2%", "91.6%"),
    ("fg7-23", 3, "+2.8%", "+0.4%"),
    ("fg7-17", 4, "208 / 214", "196 / 214"),
    ("fg7-10", 4, "Occupied 208", "Occupied 196"),
    ("fg7-7", 4, "Vacant 4", "Vacant 13"),
    ("fg7-4", 4, "Notice 2", "Notice 5"),
    ("fg2-653", 5, "$612.4k", "$541.7k"),
    ("fg2-651", 5, "93%", "86%"),
    ("fg8-41", 6, "12", "23"),
    ("fg8-39", 6, "+2", "+5"),
    ("fg8-29", 6, "5", "7"),
    ("fg8-23", 6, "4", "6"),
    ("fg8-17", 6, "2", "4"),
    ("fg8-11", 6, "1", "3"),
    ("fg2-232", 7, "$4.6M", "$3.8M"),
    ("fg2-230", 7, "+9.4%", "+4.1%"),
]
TEXTS = [{"id": i, "order": o, "pages": [chars(i), p2, p3]} for (i, o, p2, p3) in P]

# ---- Maintenance bars (block-local coordinates).
# Widths follow the counts (150 px for 7, as in the design): page 02 counts 5, 4, 2, 1; page 03 7, 6, 4, 3.
PX = 150 / 7
BAR_PAGES = {"fg8-31": [None, 5 * PX, 7 * PX], "fg8-25": [None, 4 * PX, 6 * PX], "fg8-19": [None, 2 * PX, 4 * PX], "fg8-13": [None, 1 * PX, 3 * PX]}
BARS = []
for bid, widths in BAR_PAGES.items():
    it = items[bid][1]
    w0 = it["w"]
    BARS.append({"h": it["h"], "id": bid, "order": 6, "w0": w0, "widths": [w0, widths[1], widths[2]], "x": it["x"], "y": it["y"]})

# ---- Occupancy gauge: the green ring picture, swept around the track's centre (block-local).
ring = items["fg7-13"][1]
track = items["fg7-14"][1]
# The track is a pill 266 x 148 with a 16 px band: its centre line has radius 66 and straight parts between x 98 and 216.
band = 16
r = track["h"] / 2 - band / 2
half = track["w"] / 2 - track["h"] / 2
quarter = 3.14159265 * r / 2
reach_94 = ring["x"] + ring["w"] - band / 2 - 4  # where the design's green stroke ends (its centre)
L1 = quarter + (reach_94 - (track["x"] + track["h"] / 2))
RING = {"cx": track["x"] + track["w"] / 2, "cy": track["y"] + track["h"] / 2, "half": half, "id": "fg7-13", "lengths": [L1, L1 + 2.8 * 14, L1 - 2.8 * 14], "order": 3, "r": r, "w": band}

# ---- Dot charts.
GREEN = re.compile(r"#0[01]B26B", re.I)


def dot_columns(group, order):
    cols = collections.OrderedDict()
    for i in leaves(group):
        b, it = items[i]
        if it["kind"] != "svg":
            continue
        key = round(it["x"], 1)
        col = cols.setdefault(key, {"dots": [], "ids": []})
        col["ids"].append(i)
        if it["h"] < 6:  # one dot
            col["dots"].append((it["y"], bool(GREEN.search(it["svg"]))))
        else:  # a strip of dots
            for m in re.finditer(r'<circle[^>]*transform="matrix\(-1 0 0 1 [\d.]+ ([\d.]+)\)"[^>]*fill="([^"]+)"', it["svg"]):
                col["dots"].append((it["y"] + float(m.group(1)), bool(GREEN.match(m.group(2)))))
    out = []
    for x in sorted(cols):
        col = cols[x]
        dots = sorted(col["dots"], key=lambda dot: -dot[0])  # bottom first
        if not dots:
            continue
        g = sum(1 for _, green in dots if green)
        out.append({"anchor": col["ids"][0], "g": [g], "green": "#00B26B", "hide": col["ids"][1:], "order": order, "r": 1.9389, "x": x, "ys": [y for y, _ in dots]})
    return out


noi = dot_columns("fg2-39", 7)
sep = dot_columns("fg2-297", 5)
# New lit counts for pages 02 and 03 (a gentle, believable change per column).
SHIFT2 = [4, 3, 5, 2, 4, 3, 5, 4, 2, 5, 3, 6, 3, 4, 2, 4, 5, 6, 3, 4]
SHIFT3 = [-2, -1, 1, -3, 0, -2, 2, -1, 1, -2, -3, 0, 1, -1, 2, -2, 0, 1, -1, 2]
for index, col in enumerate(noi):
    n = len(col["ys"])
    g1 = col["g"][0]
    col["g"] += [max(0, min(n, g1 + SHIFT2[index % len(SHIFT2)])), max(0, min(n, g1 + SHIFT3[index % len(SHIFT3)]))]
    col["index"] = index
for index, col in enumerate(sep):
    n = len(col["ys"])
    g1 = col["g"][0]
    col["g"] += [min(n, g1 + 4), max(1, g1 - 2)]
    col["index"] = index
COLUMNS = noi + sep

PAGER = {"id": "fg2-696", "pages": ["01 / 24", "02 / 24", "03 / 24"]}
r_it = items["fg2-695"][1]
l_it = items["fg2-697"][1]
ARROWS = {
    "left": {"id": "fg2-697", "x": l_it["x"] + l_it["w"] / 2, "y": l_it["y"] + l_it["h"] / 2},
    "right": {"id": "fg2-695", "x": r_it["x"] + r_it["w"] / 2, "y": r_it["y"] + r_it["h"] / 2},
}

code = open(f"{HERE}/motion.js").read()
for name, value in [("TEXTS", TEXTS), ("BARS", BARS), ("RING", RING), ("COLUMNS", COLUMNS), ("PAGER", PAGER), ("ARROWS", ARROWS)]:
    code = code.replace(f"__{name}__", json.dumps(value, separators=(",", ":")))
open(f"{HERE}/motion.built.js", "w").write(code)

# The total length, from the script itself.
total = float(subprocess.check_output(["node", "-e", f"const m = new Function('api','D','H', require('fs').readFileSync('{HERE}/motion.built.js','utf8'))({{}},{{}},{{}}); process.stdout.write(String(m.schedule({{}}).total))"]).decode())

G = {"01": "01 · Pause", "02": "02 · Cursor in", "03": "03 · Next", "04": "04 · Data change", "07": "07 · Back twice", "09": "09 · Cursor out", "fx": "Shapes"}
def slider(id, label, group, default, lo, hi, step=0.05, layer="Segment", unit="s"):
    return {"default": default, "group": group, "id": id, "label": label, "layer": layer, "max": hi, "min": lo, "step": step, "type": "slider", "unit": unit}
def switch(id, label, group, layer):
    return {"default": True, "group": group, "id": id, "label": label, "layer": layer, "type": "switch"}
CONTROLS = [
    slider("s2.enterTime", "Entry time", G["02"], 1.0, 0.2, 3, layer="Cursor"),
    slider("s2.hold", "Pause", G["02"], 0.5, 0, 3),
    slider("s3.moveTime", "Move to arrow", G["03"], 0.7, 0.2, 2, layer="Cursor"),
    slider("click.time", "Click time", G["03"], 0.3, 0.1, 1, layer="Cursor"),
    slider("data.delay", "Delay after click", G["04"], 0.2, 0, 1),
    slider("data.time", "Count time", G["04"], 0.8, 0.2, 2, layer="Numbers"),
    slider("data.stagger", "Stagger", G["04"], 0.08, 0, 0.3, step=0.01, layer="Numbers"),
    slider("data.hold", "Hold after", G["04"], 0.6, 0, 3),
    slider("s7.moveTime", "Move to left arrow", G["07"], 0.5, 0.2, 2, layer="Cursor"),
    slider("s7.gap", "Gap between clicks", G["07"], 0.15, 0, 1, layer="Cursor"),
    slider("s9.pause", "Pause", G["09"], 0.4, 0, 3),
    slider("s9.exitTime", "Exit time", G["09"], 0.9, 0.2, 3, layer="Cursor"),
    switch("ring.on", "Gauge trim", G["fx"], "Occupancy"),
    switch("bars.on", "Maintenance bars", G["fx"], "Maintenance"),
    switch("charts.on", "Dot charts", G["fx"], "Net operating income · Rent collection"),
    slider("chart.stagger", "Column stagger", G["fx"], 0.015, 0, 0.15, step=0.005, layer="Dot charts"),
    slider("chart.dotStagger", "Dot stagger", G["fx"], 0.022, 0, 0.1, step=0.002, layer="Dot charts"),
    slider("chart.pop", "Dot pop time", G["fx"], 0.12, 0.04, 0.5, step=0.01, layer="Dot charts"),
]

spec = dict(a)
spec["design"] = dict(a["design"], motion=code)
spec["controls"] = CONTROLS
spec["layers"] = [{"id": "motion-cursor", "name": "Cursor"}] + [l for l in a["layers"] if l["id"] != "motion-cursor"]
spec["version"] = a["version"] + 1
panel = [{"id": "motion-cursor", "kind": "layer", "name": "Cursor", "visible": True}] + [l for l in lay if l["id"] != "motion-cursor"]
update = {
    "animation": spec,
    "durationSeconds": round(total, 2),
    "layers": panel,
    "params": dict(d.get("params") or {}),
    "project": "PropVera_Header",
    "values": {"motion.type": "interaction", "interactions.enabled": False},
    "version": "v_04",
}
json.dump(update, open(f"{HERE}/update.json", "w"))
print("total", round(total, 2), "texts", len(TEXTS), "bars", len(BARS), "noi columns", len(noi), "sep columns", len(sep), [c["g"] for c in sep], [c["g"] for c in noi][:6])
