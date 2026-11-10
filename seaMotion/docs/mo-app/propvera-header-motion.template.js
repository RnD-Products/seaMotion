// PropVera_Header · v_09 · Scenes. The motion is played one scene at a time; each scene plays one part (its stage, params.__stage):
//   01 Cursor in · 02 Move for Arrows · 03 Next (first click: every area counts to page 02, pager 02; second click: pager 03) · 04 / 05 / 06 Data change of one area each, from the first click's values (page 02) to the second click's (page 03)
//   (img-01 key stats, img-02 Occupancy + Rent collection, img-03 Maintenance + Net operating income) · 07 Back twice (pager
//   03 → 01; after each click every area counts back one page: 03 → 02, then 02 → 01) · 08 Cursor out. A part starts from where the part before it ended (cursor place, pager page, areas changed so far),
//   so the scenes join up. Without a stage the parts play one after another.
const TEXTS = __TEXTS__;
const BARS = __BARS__;
const RING = __RING__;
const COLUMNS = __COLUMNS__;
const PAGER = __PAGER__;
const ARROWS = __ARROWS__;
const ENTER = __ENTER__;
const CARDS = {"05":{"fg7-31":0,"fg2-659":1},"06":{"fg8-47":0,"fg2-238":1}};
const CURSOR_ID = "motion-cursor";
const CURSOR_SIZE = 30;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, p) => a + (b - a) * p;
const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const out = (p) => 1 - Math.pow(1 - p, 3);
const bump = (p) => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p));

// The settings and their defaults (Motion › Interaction plan offers each of them).
const DEFAULTS = {
  "s0.pause": 1.0, "s10.pause": 0.5,
  "s2.enterTime": 1.0, "s2.hold": 0.5,
  "s3.moveTime": 0.7,
  "click.time": 0.3, "click.delay": 0.3, "click.delay2": 0,
  "d3.delay": 0.2, "d3.time": 1.0, "d3.stagger": 0.01, "d3.hold": 0.6,
  "d4.delay": 0.9, "d4.time": 1.0, "d4.stagger": 0.01, "d4.hold": 0.6,
  "d5.delay": 0.9, "d5.time": 1.0, "d5.stagger": 0.01, "d5.hold": 0.6,
  "d6.delay": 0.9, "d6.time": 1.0, "d6.stagger": 0.01, "d6.hold": 0.6,
  "s7.moveTime": 0.5, "s7.gap": 0.15,
  "d7.delay": 0.2, "d7.time": 1.0, "d7.stagger": 0.01, "d7.hold": 0.6,
  "s9.pause": 0.4, "s9.exitTime": 0.9,
  "letter.stagger": 0.04, "letter.time": 0.6, "letter.blur": 5, "letter.slide": 10, "letter.cycles": 3,
  "video.fade": 0, "flow.direct": false, "z.delay": 0.3, "enter.on": true, "enter.1.slide": 30, "enter.1.from": "bottom", "enter.1.time": 0.4, "enter.1.blurOn": true, "enter.1.blur": 6, "enter.1.fade": true, "enter.1.easing": "smooth", "enter.2.slide": 30, "enter.2.from": "bottom", "enter.2.time": 0.4, "enter.2.blurOn": true, "enter.2.blur": 6, "enter.2.fade": true, "enter.2.easing": "smooth", "enter.3.slide": 30, "enter.3.from": "bottom", "enter.3.time": 0.4, "enter.3.blurOn": true, "enter.3.blur": 6, "enter.3.fade": true, "enter.3.easing": "smooth", "enter.4.slide": 30, "enter.4.from": "bottom", "enter.4.time": 0.4, "enter.4.blurOn": true, "enter.4.blur": 6, "enter.4.fade": true, "enter.4.easing": "smooth", "enter.5.slide": 30, "enter.5.from": "bottom", "enter.5.time": 0.4, "enter.5.blurOn": true, "enter.5.blur": 6, "enter.5.fade": true, "enter.5.easing": "smooth", "enter.6.slide": 30, "enter.6.from": "bottom", "enter.6.time": 0.4, "enter.6.blurOn": true, "enter.6.blur": 6, "enter.6.fade": true, "enter.6.easing": "smooth", "enter.7.slide": 30, "enter.7.from": "bottom", "enter.7.time": 0.4, "enter.7.blurOn": true, "enter.7.blur": 6, "enter.7.fade": true, "enter.7.easing": "smooth", "enter.8.slide": 30, "enter.8.from": "bottom", "enter.8.time": 0.4, "enter.8.blurOn": true, "enter.8.blur": 6, "enter.8.fade": true, "enter.8.easing": "smooth", "enter.from": "bottom", "enter.easing": "smooth", "enter.fade": true, "enter.blurOn": true, "enter.stagger": 0.1, "enter.time": 0.4, "enter.fadeDelay": 0.3, "enter.innerDelay": 0.15, "enter.cardDelay05": 0.3, "enter.slide06": 60, "enter.time06": 0.7, "enter.innerBlur": 5, "enter.fadeTime": 0.2, "enter.slide": 30, "enter.blur": 6, "chart.stagger": 0.025, "chart.dotStagger": 0.022, "chart.pop": 0.12, "ring.on": true, "bars.on": true, "charts.on": true,
};
const val = (P, key) => {
  const v = P && P[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && v !== "") return v;
  return DEFAULTS[key];
};

// Where the cursor goes (design pixels; the tip of the arrow).
const P_START = { x: 1720, y: 1330 };
const P_REST = { x: 1372, y: 846 };
const P_RIGHT = { x: ARROWS.right.x + 1, y: ARROWS.right.y + 2 };
const P_LEFT = { x: ARROWS.left.x + 1, y: ARROWS.left.y + 2 };
// The cursor's way (Motion Plan › Interaction Segment › Cursor): where it rests, where it goes to, the side it comes in from and leaves to,
// the shape of the path and the easing of each move.
Object.assign(DEFAULTS, {
  "cur.01.x": P_REST.x, "cur.01.y": P_REST.y, "cur.01.from": "bottomRight", "cur.01.arc": "straight", "cur.01.ease": "inOut",
  "cur.02.x": P_RIGHT.x, "cur.02.y": P_RIGHT.y, "cur.02.arc": "straight", "cur.02.ease": "inOut",
  "cur.07.x": P_LEFT.x, "cur.07.y": P_LEFT.y, "cur.07.arc": "straight", "cur.07.ease": "inOut",
  "cur.08.to": "bottomRight", "cur.08.arc": "straight", "cur.08.ease": "inOut",
});
// A point off the picture on one of the eight sides (above, below, left, right and the four corners), in line with `ref` where it can be.
function edgePoint(side, ref) {
  const W = 1600, H = 1200, MX = 120, MY = 130;
  switch (side) {
    case "left": return { x: -MX, y: ref.y };
    case "right": return { x: W + MX, y: ref.y };
    case "top": return { x: ref.x, y: -MY };
    case "bottom": return { x: ref.x, y: H + MY };
    case "topLeft": return { x: -MX, y: -MY };
    case "topRight": return { x: W + MX, y: -MY };
    case "bottomLeft": return { x: -MX, y: H + MY };
    default: return { x: W + MX, y: H + MY };
  }
}
// Where the cursor is a part `p` of the way from a to b on the chosen path: straight, a curve to one side, a bigger curve, or an S wave.
function curvePoint(a, b, p, arc) {
  let x = lerp(a.x, b.x, p), y = lerp(a.y, b.y, p);
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d, ny = dx / d;
  const bend = { curveLeft: 0.18, curveRight: -0.18, bigLeft: 0.36, bigRight: -0.36 }[arc];
  if (bend) { const o = bend * d * Math.sin(Math.PI * p); x += nx * o; y += ny * o; }
  else if (arc === "wave") { const o = 0.12 * d * Math.sin(2 * Math.PI * p); x += nx * o; y += ny * o; }
  return { x, y };
}
const curEase = (name, p) => (name === "inOut" ? inOut(p) : easeBy(name, p));
const curPlace = (P, key) => ({ x: val(P, "cur." + key + ".x"), y: val(P, "cur." + key + ".y") });

const STAGES = ["01", "02", "03", "04", "05", "06", "07", "08"];
// The data stages: which area changes in each (0 key stats, 1 Occupancy + Rent collection, 2 Maintenance + Net operating income),
// and the settings it reads.
const DATA = { "04": { area: 0, key: "d4" }, "05": { area: 1, key: "d5" }, "06": { area: 2, key: "d6" } };
// The latest "rel" (the stagger step) of each area.
const AREA_STEPS = [0, 0, 0];
for (const entry of [].concat(TEXTS, BARS, [RING], COLUMNS)) AREA_STEPS[entry.area] = Math.max(AREA_STEPS[entry.area], entry.rel);
// Bars and the gauge use the numbers' easing, so a shape and its number arrive together.
const SYNC = (p) => out(p);

function dataTimes(P, stage) {
  const d = DATA[stage];
  const delay = val(P, d.key + ".delay");
  const time = val(P, d.key + ".time");
  const stagger = val(P, d.key + ".stagger");
  const hold = val(P, d.key + ".hold");
  const span = time + stagger * AREA_STEPS[d.area] + 0.3;
  return { area: d.area, delay, hold, span, stagger, time, total: delay + span + hold };
}

// Part 03, Next: click on the right arrow, all areas count to page 02 (together, each element a stagger step later than the one
// before), then the second click (pager 03). Parts 04 to 06 then change each area from page 02 to page 03.
function nextTimes(P) {
  const click = val(P, "click.time");
  const delay = val(P, "d3.delay");
  const time = val(P, "d3.time");
  const stagger = val(P, "d3.stagger");
  const hold = val(P, "d3.hold");
  const span = time + stagger * Math.max(...AREA_STEPS) + 0.3;
  const first = val(P, "click.delay");
  const firstAt = first + click + delay;
  const second = firstAt + span + hold + val(P, "click.delay2");
  return { clicks: [first, second], delay, firstAt, hold, span, stagger, time, total: second + click + 0.3 };
}

// Part 07, Back twice: click on the left arrow, the data counts back to page 02 (all areas together, each element a stagger step later
// than the one before), a pause, then the second click and the data counts back to page 01.
function backTimes(P) {
  const click = val(P, "click.time");
  const delay = val(P, "d7.delay");
  const time = val(P, "d7.time");
  const stagger = val(P, "d7.stagger");
  const hold = val(P, "d7.hold");
  const span = time + stagger * Math.max(...AREA_STEPS) + 0.3;
  const first = val(P, "s7.moveTime");
  const firstAt = first + click + delay;
  const second = firstAt + span + hold + val(P, "s7.gap");
  const secondAt = second + click + delay;
  return { clicks: [first, second], delay, firstAt, hold, secondAt, span, stagger, time, total: secondAt + span + hold };
}

// How long each part lasts for these settings.
function lengths(P) {
  const click = val(P, "click.time");
  return {
    "00": val(P, "s0.pause"),
    "09": val(P, "s10.pause"),
    "01": val(P, "s2.enterTime") + val(P, "s2.hold"),
    "02": val(P, "s3.moveTime"),
    "03": nextTimes(P).total,
    "04": dataTimes(P, "04").total,
    "05": dataTimes(P, "05").total,
    "06": dataTimes(P, "06").total,
    "07": val(P, "flow.direct") ? val(P, "d7.delay") + val(P, "d7.time") + val(P, "d7.stagger") * Math.max(...AREA_STEPS) + 0.3 + val(P, "d7.hold") : backTimes(P).total,
    "08": val(P, "s9.pause") + val(P, "s9.exitTime") + 0.2,
  };
}

// Start ("00") and End ("09") are parts of their own, drawn by this script like every other part, so the first and the last picture
// are made the same way as the pictures between them: "00" is part 01 before the cursor comes in (everything on page 01), "09" is
// part 08 after the cursor has left (everything on page 01 again, the pager on 01).
const IDLE = { "00": { stage: "01", t: -1 }, "09": { stage: "08", t: 1e6 } };

// The part a time falls in when no stage is given (the parts one after another), and the time inside it.
function locate(P, t) {
  if (P && typeof P.__stage === "string" && IDLE[P.__stage]) return IDLE[P.__stage];
  if (P && typeof P.__stage === "string" && STAGES.includes(P.__stage)) return { stage: P.__stage, t };
  const L = lengths(P || {});
  let at = 0;
  for (const stage of STAGES) {
    if (t < at + L[stage] || stage === "08") return { stage, t: t - at };
    at += L[stage];
  }
  return { stage: "08", t };
}

// When the clicks of a part are (inside the part).
function clicksOf(P, stage) {
  const click = val(P, "click.time");
  if (stage === "03") return nextTimes(P).clicks;
  if (stage === "07") return backTimes(P).clicks;
  return [];
}

function cursorAt(P, stage, t) {
  const rest = curPlace(P, "01"), right = curPlace(P, "02"), left = curPlace(P, "07");
  if (stage === "01") {
    const enter = val(P, "s2.enterTime");
    const start = edgePoint(val(P, "cur.01.from"), rest);
    if (t <= 0) return { ...start, hidden: true };
    return curvePoint(start, rest, curEase(val(P, "cur.01.ease"), clamp01(t / enter)), val(P, "cur.01.arc"));
  }
  if (stage === "02") return curvePoint(rest, right, curEase(val(P, "cur.02.ease"), clamp01(t / val(P, "s3.moveTime"))), val(P, "cur.02.arc"));
  if (stage === "07") return curvePoint(right, left, curEase(val(P, "cur.07.ease"), clamp01(t / val(P, "s7.moveTime"))), val(P, "cur.07.arc"));
  if (stage === "08") {
    const wait = val(P, "s9.pause");
    const exit = val(P, "s9.exitTime");
    const away = edgePoint(val(P, "cur.08.to"), left);
    if (t < wait) return { ...left };
    if (t < wait + exit) return curvePoint(left, away, curEase(val(P, "cur.08.ease"), clamp01((t - wait) / exit)), val(P, "cur.08.arc"));
    return { ...away, hidden: true };
  }
  return { ...right };
}

// The pager's page before this part starts, and its changes inside it (when, from page, to page).
function pagerPlan(P, stage) {
  if (val(P, "flow.direct")) return { base: 0, changes: [] };
  const click = val(P, "click.time");
  const [a, b] = clicksOf(P, stage);
  if (stage === "03") return { base: 0, changes: [{ at: a + click * 0.4, from: 0, to: 1 }, { at: b + click * 0.4, from: 1, to: 2 }] };
  if (stage === "07") return { base: 2, changes: [{ at: a + click * 0.4, from: 2, to: 1 }, { at: b + click * 0.4, from: 1, to: 0 }] };
  const i = STAGES.indexOf(stage);
  return { base: i >= 3 && i < 6 ? 2 : 0, changes: [] };
}

// A value's place in its change: the data pages of an area stay on page 01 until its part, change from page 01 to page 03 in it
// (the element's stagger step `rel` after the delay), and stay on page 03 after it.
function changeAt(P, stage, t, area, rel, shift) {
  // Without interaction ("flow.direct"): no clicks. The zoom in (04) brings the first click's data (page 02) in every area, then each
  // area counts to page 03 in its own part (04 – 06); the zoom out (07) counts every area straight back to page 01.
  if (val(P, "flow.direct")) {
    const s = STAGES.indexOf(stage);
    if (s < 3 || stage === "08") return { elapsed: stage === "08" ? 1e6 : 0, from: 0, p: 1, to: 0 };
    if (stage === "07") {
      const back = t - val(P, "d7.delay") - rel * val(P, "d7.stagger") - (shift || 0);
      if (back < 0) return { elapsed: 0, from: 2, p: 1, to: 2 };
      return { elapsed: back, from: 2, p: clamp01(back / val(P, "d7.time")), to: 0 };
    }
    const mine = STAGES.indexOf(Object.keys(DATA).find((key) => DATA[key].area === area));
    if (s > mine) return { elapsed: 1e6, from: 2, p: 1, to: 2 };
    if (s === mine) {
      const d = dataTimes(P, stage);
      const next = t - d.delay - rel * d.stagger - (shift || 0);
      if (next >= 0) return { elapsed: next, from: 1, p: clamp01(next / d.time), to: 2 };
    }
    if (stage === "04") {
      const first = t - val(P, "z.delay") - rel * val(P, "d3.stagger") - (shift || 0);
      if (first < 0) return { elapsed: 0, from: 0, p: 1, to: 0 };
      if (first < val(P, "d3.time") + 0.3) return { elapsed: first, from: 0, p: clamp01(first / val(P, "d3.time")), to: 1 };
    }
    return { elapsed: 1e6, from: 1, p: 1, to: 1 };
  }
  // Back twice: every area counts back to page 02 after the first click and to page 01 after the second.
  if (stage === "07") {
    const d = backTimes(P);
    const second = t - d.secondAt - rel * d.stagger - (shift || 0);
    if (second >= 0) return { elapsed: second, from: 1, p: clamp01(second / d.time), to: 0 };
    const first = t - d.firstAt - rel * d.stagger - (shift || 0);
    if (first >= 0) return { elapsed: first, from: 2, p: clamp01(first / d.time), to: 1 };
    return { elapsed: 0, from: 2, p: 1, to: 2 };
  }
  if (stage === "08") return { elapsed: 1e6, from: 0, p: 1, to: 0 };
  // Next: every area counts from page 01 to page 02 after the first click.
  if (stage === "03") {
    const d = nextTimes(P);
    const elapsed = t - d.firstAt - rel * d.stagger - (shift || 0);
    if (elapsed < 0) return { elapsed: 0, from: 0, p: 1, to: 0 };
    return { elapsed, from: 0, p: clamp01(elapsed / d.time), to: 1 };
  }
  const s = STAGES.indexOf(stage);
  if (s < 2) return { elapsed: 0, from: 0, p: 1, to: 0 };
  // Parts 04 to 06: each area, in its part, counts from page 02 to page 03; before it is on page 02, after it on page 03.
  const mine = STAGES.indexOf(Object.keys(DATA).find((key) => DATA[key].area === area));
  if (s < mine) return { elapsed: 0, from: 1, p: 1, to: 1 };
  if (s > mine) return { elapsed: 1e6, from: 2, p: 1, to: 2 };
  const d = dataTimes(P, stage);
  const elapsed = t - d.delay - rel * d.stagger - (shift || 0);
  if (elapsed < 0) return { elapsed: 0, from: 1, p: 1, to: 1 };
  return { elapsed, from: 1, p: clamp01(elapsed / d.time), to: 2 };
}

// Numbers count from one value to the next, keeping the text around them ("$", "M", "%", " / 214") and the format.
const NUM = /\d[\d,]*(?:\.\d+)?/g;
function mixText(a, b, p) {
  if (p >= 1) return b;
  if (p <= 0) return a;
  const na = a.match(NUM) || [];
  const nb = b.match(NUM) || [];
  const sa = a.split(NUM);
  const sb = b.split(NUM);
  if (na.length !== nb.length || sa.join("|") !== sb.join("|")) return p < 0.5 ? a : b;
  let text = sb[0];
  for (let i = 0; i < nb.length; i += 1) {
    const x = parseFloat(na[i].replace(/,/g, ""));
    const y = parseFloat(nb[i].replace(/,/g, ""));
    const dec = (nb[i].split(".")[1] || "").length;
    const v = x + (y - x) * p;
    text += nb[i].includes(",") ? v.toLocaleString("en-US", { maximumFractionDigits: dec, minimumFractionDigits: dec }) : v.toFixed(dec);
    text += sb[i + 1];
  }
  return text;
}

// A dot column of a chart. On a change, the dots that light up pop in one after another from the lowest, and those
// that go dark shrink away from the top, fast.
function drawColumn(ctx, col, from, to, elapsed, P) {
  const r = col.r;
  const gFrom = col.g[from];
  const gTo = col.g[to];
  const step = val(P, "chart.dotStagger");
  const pop = val(P, "chart.pop");
  for (let i = 0; i < col.ys.length; i += 1) {
    const cx = col.x + r;
    const cy = col.ys[i] + r;
    let lit = i < gTo ? 1 : 0;
    if (i >= gFrom && i < gTo) lit = out(clamp01((elapsed - (i - gFrom) * step) / pop));
    else if (i >= gTo && i < gFrom) lit = 1 - inOut(clamp01((elapsed - (gFrom - 1 - i) * step) / pop));
    if (lit < 1) {
      ctx.fillStyle = "rgba(0,0,0,0.1)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (lit > 0) {
      ctx.fillStyle = col.green;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.35 + 0.65 * lit) * (1 + 0.25 * bump(lit)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// The occupancy gauge as one stroke along the pill's centre line, from the right end over the top, round the left and
// back along the bottom (so there is no seam). Its middle is the left end of the pill: the arms reach L from there,
// and a gap of e opens from there (the trim start), so a change can erase the arms outward and draw them in again.
// The colour runs green → yellow → clear over the reach of `colorL`, like the design.
function drawGauge(ctx, L, e, colorL, view, feather) {
  const g = RING;
  const left = g.cx - g.half;
  const right = g.cx + g.half;
  const quarter = (Math.PI * g.r) / 2;
  const straight = right - left;
  const arm = 2 * quarter + straight;
  const len = Math.min(arm, Math.max(0, L));
  const gap = Math.min(len, Math.max(0, e));
  if (len - gap <= 0.01) return;
  const reachOf = (d) => (d <= quarter ? left - g.r * Math.cos(d / g.r) : d <= quarter + straight ? left + (d - quarter) : right + g.r * Math.sin(Math.min(Math.PI / 2, (d - quarter - straight) / g.r)));
  const x0 = left - g.r - g.w / 2;
  const x1 = Math.max(x0 + 1, reachOf(Math.min(arm, colorL)) + g.w / 2);
  const paint = ctx.createLinearGradient(x0, 0, x1, 0);
  paint.addColorStop(0, "rgba(0,178,107,1)");
  paint.addColorStop(0.41, "rgba(246,227,52,1)");
  paint.addColorStop(0.95, "rgba(231,231,231,0)");
  ctx.save();
  ctx.lineWidth = g.w;
  ctx.lineCap = "butt";
  ctx.strokeStyle = paint;
  // Visible: [middle - len, middle - gap] and [middle + gap, middle + len] along the path.
  ctx.setLineDash(gap > 0.01 ? [len - gap, 2 * gap, len - gap, 100000] : [2 * len, 100000]);
  ctx.lineDashOffset = -(arm - len);
  if (view && view.scale) ctx.filter = "blur(" + 1.2 * view.scale + "px)";
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(right + g.r, g.cy);
    ctx.arc(right, g.cy, g.r, 0, 1.5 * Math.PI, true);
    ctx.lineTo(left, g.cy - g.r);
    ctx.arc(left, g.cy, g.r, 1.5 * Math.PI, 0.5 * Math.PI, true);
    ctx.lineTo(right, g.cy + g.r);
    ctx.arc(right, g.cy, g.r, 0.5 * Math.PI, 0, true);
    ctx.stroke();
  };
  // A feathered leading end: the last `feather` px of each arm fade out in thin slices, so the drawn-in end is soft, not cut.
  const soft = gap <= 0.01 ? Math.min(len, Math.max(0, feather || 0)) : 0;
  if (soft > 0.5) {
    const body = len - soft;
    const slices = 24;
    const step = soft / slices;
    const baseAlpha = ctx.globalAlpha;
    if (body > 0.01) {
      ctx.setLineDash([2 * body, 100000]);
      ctx.lineDashOffset = -(arm - body);
      trace();
    }
    for (let j = 0; j < slices; j++) {
      const d0 = body + j * step;
      const k = (j + 0.5) / slices;
      ctx.globalAlpha = baseAlpha * (1 - k * k * (3 - 2 * k));
      ctx.setLineDash([step + 0.6, 2 * d0, step + 0.6, 100000]);
      ctx.lineDashOffset = -(arm - d0 - step - 0.3);
      trace();
    }
    ctx.globalAlpha = baseAlpha;
  } else trace();
  ctx.restore();
}

// A maintenance bar as a stroke from its start, trimmed to width w (green → yellow → clear along its length).
function drawBar(ctx, bar, w) {
  const h = bar.h;
  const y = bar.y + h / 2;
  const len = Math.max(h, w);
  const paint = ctx.createLinearGradient(bar.x, 0, bar.x + len, 0);
  paint.addColorStop(0, "rgba(0,178,107,1)");
  paint.addColorStop(0.58, "rgba(245,228,82,1)");
  paint.addColorStop(0.99, "rgba(216,215,215,0)");
  ctx.save();
  ctx.lineWidth = h;
  ctx.lineCap = "round";
  ctx.strokeStyle = paint;
  ctx.beginPath();
  ctx.moveTo(bar.x + h / 2, y);
  ctx.lineTo(bar.x + len - h / 2 + 0.01, y);
  ctx.stroke();
  ctx.restore();
}

// A number changes digit by digit, as if it changed many times on the way: every digit (those that stay the same too) rolls through
// a few other digits (`letter.cycles`) before it lands on the new one. Text letters and signs around the digits do not move. Each step the shown letter leaves (fades, slides up `letter.slide` px,
// blurs up to `letter.blur` px) while the next one comes in from below (slides up, blur down to 0, fades in). The letters start one
// `letter.stagger` after each other from the left and take `letter.time` each.
function fontOf(ctx, it) {
  const t = it.text;
  const italic = /italic|oblique/i.test(t.style || "") ? "italic " : "";
  ctx.font = italic + (t.weight || 400) + " " + t.size + 'px "' + (t.family || "Inter") + '", "Instrument Sans", system-ui, sans-serif';
  if ("letterSpacing" in ctx) ctx.letterSpacing = (t.ls || 0) + "px";
}
// Where each letter of a text stands (its left edge) and how wide its place is, from the font's measured widths.
function letterPlaces(ctx, it, str) {
  const t = it.text;
  ctx.save();
  fontOf(ctx, it);
  const total = ctx.measureText(str).width;
  const base = t.align === "CENTER" ? it.x + (it.w - total) / 2 : t.align === "RIGHT" ? it.x + it.w - total : it.x;
  const xs = [];
  for (let k = 0; k < str.length; k += 1) xs.push(base + ctx.measureText(str.slice(0, k)).width);
  const ws = xs.map((x, k) => (k + 1 < xs.length ? xs[k + 1] : base + total) - x);
  ctx.restore();
  return { ws, xs };
}
function charWidth(ctx, it, ch) {
  ctx.save();
  fontOf(ctx, it);
  const width = ctx.measureText(ch).width;
  ctx.restore();
  return width;
}
// The letters a rolling letter passes through, of its own kind (digits, capitals, small letters, signs): not the old one, not the new
// one, never the same twice in a row.
const isDigit = (ch) => ch >= "0" && ch <= "9";
const KINDS = ["0123456789", "ABCDEFGHJKLMNPRSTUVWXYZ", "abcdefghjkmnoprstuvwxyz", "$%+#&/.,"];
function kindOf(ch) {
  return KINDS.find((kind) => kind.includes(ch)) || (ch >= "A" && ch <= "Z" ? KINDS[1] : ch >= "a" && ch <= "z" ? KINDS[2] : ch >= "0" && ch <= "9" ? KINDS[0] : KINDS[3]);
}
function rollOf(k, before, after, count) {
  const seq = [before];
  const kind = kindOf(after || before);
  for (let step = 1; step <= count; step += 1) {
    let at = (k * 7 + step * 3 + (after.charCodeAt(0) || 0) * 5 + (before.charCodeAt(0) || 0) * 3) % kind.length;
    while (kind[at] === seq[seq.length - 1] || kind[at] === after) at = (at + 1) % kind.length;
    seq.push(kind[at]);
  }
  seq.push(after);
  return seq;
}
function drawLetters(ctx, it, H, from, to, elapsed, P) {
  const stagger = val(P, "letter.stagger");
  const time = Math.max(0.05, val(P, "letter.time"));
  const blur = val(P, "letter.blur") * H.view.scale;
  const slide = val(P, "letter.slide");
  const cycles = Math.max(0, Math.round(val(P, "letter.cycles")));
  const was = letterPlaces(ctx, it, from);
  const now = letterPlaces(ctx, it, to);
  const glyph = (ch, x, dy, alpha, soft) => {
    if (alpha <= 0.002 || ch === " " || ch === "") return;
    ctx.save();
    ctx.translate(0, dy);
    if (soft > 0.05) ctx.filter = "blur(" + soft + "px)";
    H.drawItem(ctx, Object.assign({}, it, { alpha: it.alpha * alpha, w: 4000, x }), { align: "LEFT", chars: ch });
    ctx.restore();
  };
  // A rolling digit always stays inside its own place in the new text (centered, squeezed when it is wider), so it never reaches the
  // letters and signs beside it, whichever digit it shows.
  const digit = (k, ch, dy, alpha, soft) => {
    const own = k < to.length ? now : was;
    const slotX = own.xs[k];
    const slotW = own.ws[k];
    const width = charWidth(ctx, it, ch);
    const fit = width > slotW && width > 0 ? slotW / width : 1;
    const left = slotX + (slotW - width * fit) / 2;
    ctx.save();
    ctx.translate(left, 0);
    ctx.scale(fit, 1);
    ctx.translate(-left, 0);
    glyph(ch, left, dy, alpha, soft);
    ctx.restore();
  };
  const count = Math.max(from.length, to.length);
  for (let k = 0; k < count; k += 1) {
    const before = from[k] || "";
    const after = to[k] || "";
    // Every digit rolls, the ones that stay the same too; text letters and signs (Occupied, $, M, %, the point) stand still.
    if (!(isDigit(before) && isDigit(after))) {
      glyph(after, now.xs[k], 0, 1, 0);
      continue;
    }
    const q = clamp01((elapsed - k * stagger) / time);
    if (q <= 0) {
      digit(k, before, 0, 1, 0);
      continue;
    }
    if (q >= 1) {
      digit(k, after, 0, 1, 0);
      continue;
    }
    const seq = rollOf(k, before, after, cycles);
    const steps = seq.length - 1;
    const step = Math.min(steps - 1, Math.floor(q * steps));
    const e = out(q * steps - step);
    // The digit shown leaves while the next comes in.
    digit(k, seq[step], -slide * e, 1 - e, blur * e);
    digit(k, seq[step + 1], slide * (1 - e), e, blur * (1 - e));
  }
}

function stateAt(P, time) {
  P = P || {};
  const { stage, t } = locate(P, time);
  const items = {};
  // Key numbers (and the small numbers that go with them) change letter by letter to page 03's values, area by area.
  for (const entry of TEXTS) {
    const c = changeAt(P, stage, t, entry.area, entry.rel);
    const from = entry.pages[c.from];
    const to = entry.pages[c.to];
    const lettersDone = c.elapsed >= (Math.max(from.length, to.length) - 1) * val(P, "letter.stagger") + val(P, "letter.time");
    if (c.from === c.to || lettersDone || c.elapsed <= 0) items[entry.id] = { freeClip: true, text: c.elapsed <= 0 && c.from !== c.to ? from : to };
    else items[entry.id] = { draw: (ctx, it, H) => drawLetters(ctx, it, H, from, to, c.elapsed, P), freeClip: true };
  }
  // Maintenance bars: a stroke trimmed to the count, arriving with its number.
  if (val(P, "bars.on")) {
    for (const bar of BARS) {
      const c = changeAt(P, stage, t, bar.area, bar.rel);
      const w = lerp(bar.widths[c.from], bar.widths[c.to], SYNC(c.p));
      items[bar.id] = { draw: (ctx) => drawBar(ctx, bar, w) };
    }
  }
  // The occupancy gauge on a change: the old gauge fades out, then the new one is drawn in from the left end to the new occupancy
  // (trim end), in step with the percentage.
  if (val(P, "ring.on")) {
    const c = changeAt(P, stage, t, RING.area, RING.rel);
    const from = RING.lengths[c.from];
    const to = RING.lengths[c.to];
    const split = 0.42;
    let drawn;
    if (c.from === c.to || c.p >= 1) drawn = { L: to, alpha: 1, color: to };
    else if (c.p < split) drawn = { L: from, alpha: 1 - inOut(c.p / split), color: from };
    else { const q = (c.p - split) / (1 - split); drawn = { L: to * out(q), alpha: 1, color: to, feather: 90 * (1 - q) }; }
    items[RING.id] = {
      draw: (ctx, it, H) => {
        ctx.save();
        ctx.globalAlpha *= drawn.alpha;
        drawGauge(ctx, drawn.L, 0, drawn.color, H.view, drawn.feather);
        ctx.restore();
      },
    };
  }
  // Dot charts: lit dots pop in (or out) one by one, column after column.
  if (val(P, "charts.on")) {
    const chartStagger = val(P, "chart.stagger");
    for (const col of COLUMNS) {
      for (const id of col.hide) items[id] = { hidden: true };
      const c = changeAt(P, stage, t, col.area, col.rel, col.index * chartStagger);
      items[col.anchor] = { draw: (ctx) => drawColumn(ctx, col, c.from, c.to, c.elapsed, P) };
    }
  }
  // The pager's number rolls to the next page with each click.
  {
    const plan = pagerPlan(P, stage);
    let found = null;
    for (const change of plan.changes) if (t >= change.at) found = change;
    const p = found ? out(clamp01((t - found.at) / 0.28)) : 1;
    const from = found ? PAGER.pages[found.from] : PAGER.pages[plan.base];
    const to = found ? PAGER.pages[found.to] : PAGER.pages[plan.base];
    items[PAGER.id] = {
      draw(ctx, it, H) {
        // "/ 24" is fixed and never animates; only the page number changes, as a blur + fade crossfade (no slide, no clip).
        const places = letterPlaces(ctx, it, to);
        const part = (str, x, alpha, soft) => {
          if (alpha <= 0.002) return;
          ctx.save();
          if (soft > 0.05) ctx.filter = "blur(" + soft + "px)";
          H.drawItem(ctx, Object.assign({}, it, { alpha: it.alpha * alpha, w: 4000, x }), { align: "LEFT", chars: str });
          ctx.restore();
        };
        const soft = 5 * H.view.scale;
        const head = from.indexOf(" ");
        part(to.slice(head), places.xs[head], 1, 0);
        if (p < 1) part(from.slice(0, head), places.xs[0], 1 - p, soft * p);
        part(to.slice(0, head), places.xs[0], p, soft * (1 - p));
      },
    };
  }
  // The arrows light up under the cursor and dip when clicked.
  const cursor = cursorAt(P, stage, t);
  const click = val(P, "click.time");
  let press = 0;
  for (const c of clicksOf(P, stage)) press = Math.max(press, bump((t - c) / click));
  for (const side of ["right", "left"]) {
    if (val(P, "flow.direct")) break;
    // The data parts (04, 05, 06) have no click: the cursor rests by the arrow there, but the arrow is not shown as picked.
    if (DATA[stage]) break;
    const arrow = ARROWS[side];
    const near = cursor.hidden ? 0 : clamp01(1 - (Math.hypot(cursor.x - arrow.x, cursor.y - arrow.y) - 6) / 14);
    const dip = near > 0.5 ? press : 0;
    if (near <= 0 && dip <= 0) continue;
    items[arrow.id] = {
      draw(ctx, it, H) {
        ctx.save();
        ctx.fillStyle = "rgba(21,23,21," + (0.07 * near + 0.06 * dip) + ")";
        ctx.beginPath();
        ctx.arc(it.x + it.w / 2, it.y + it.h / 2, 13, 0, Math.PI * 2);
        ctx.fill();
        const k = 1 - 0.18 * dip;
        ctx.translate(it.x + it.w / 2, it.y + it.h / 2);
        ctx.scale(k, k);
        ctx.translate(-(it.x + it.w / 2), -(it.y + it.h / 2));
        H.drawItem(ctx, it);
        ctx.restore();
      },
    };
  }
  // The zoom-in parts (04, 05, 06): the layers in view slide in from below, one step after another (`enter.stagger`), so they arrive
  // while the camera moves. Each step is a row of the picture (ENTER maps a layer to its step). The layers seen at the end of the
  // last scene stay for `enter.fadeDelay`, fade out (`enter.fadeTime`), then slide in.
  if (ENTER[stage] && val(P, "enter.on")) {
    const fadeDelay = val(P, "enter.fadeDelay");
    const fadeTime = val(P, "enter.fadeTime");
    const begin = fadeDelay + fadeTime;
    // Part 05: the filter chips above the cards (search, Leases, Work orders, Payments) slide in first, then the bottom rail icons (0.1 s later), then the cards, then the two cards.
    const chips = ["fg2-701", "fg2-702", "fg2-703", "fg2-705", "fg2-706", "fg2-707", "fg2-709", "fg2-710", "fg2-711", "fg2-712"];
    const table = stage === "05"
      ? Object.assign(Object.fromEntries(Object.entries(ENTER["05"]).map(([id, card]) => [id, card + 2])), Object.fromEntries(chips.map((id) => [id, 0])), { "fg2-713": 1 })
      : stage === "06"
        ? Object.assign(Object.fromEntries(Object.entries(ENTER["06"]).map(([id, card]) => [id, card + 2])), val(P, "flow.direct") ? {} : Object.fromEntries(["fg2-693", "fg2-695", "fg2-696", "fg2-697", "fg2-698"].map((id) => [id, 0]))) // the pager and plus first (not in the version without interaction: they stay still), then the two cards one after another
        : ENTER[stage];
    // The cards of part 06 (Maintenance, Net operating income) are not there in part 05: they first appear, sliding in, in part 06.
    if (stage === "05") for (const id of Object.keys(ENTER["06"])) if (!(id in table)) items[id] = { hidden: true };
    const cards = CARDS[stage] || null;
    const wait = stage === "05" || stage === "06" ? val(P, "enter.cardDelay05") : 0; // Scenes 05 and 06: the cards wait a little longer
    const innerBegin = begin + wait + val(P, "enter.innerDelay");
    for (const id of Object.keys(table)) {
      const card = true; // the layers of a card follow it: the same slide, blur and fade
      // Cards slide in from below; what is inside a card only blurs and fades in once the card is there (no slide).
      const sv = (key) => val(P, "enter." + (table[id] + 1) + "." + key); // each step (Slide in 1, 2, 3 …) has its own settings
      const raw = t < begin ? 0 : clamp01((t - (card ? begin + wait : innerBegin) - table[id] * val(P, "enter.stagger")) / sv("time"));
      const k = easeBy(sv("easing"), raw);
      if (k >= 1) continue;
      const gone = t < begin && stage !== "06" ? 1 - out(clamp01((t - fadeDelay) / fadeTime)) : k;
      const was = items[id] || {};
      const side = SLIDE_FROM[sv("from")] || SLIDE_FROM.bottom;
      const reach = card && t >= begin ? (1 - k) * sv("slide") : 0;
      const blurOn = sv("blurOn") !== false;
      const patch = {
        dx: (was.dx || 0) + side[0] * reach,
        dy: (was.dy || 0) + side[1] * reach,
        blur: (was.blur || 0) + (blurOn ? (card ? (1 - gone) * sv("blur") : (1 - gone) * val(P, "enter.innerBlur")) : 0),
      };
      const fadeGone = sv("fade") !== false ? gone : 1; // Fade off: the layers slide in without fading
      // A layer the script draws itself fades through the canvas alpha (gauge, bars, dot charts) and through its own alpha (numbers).
      if (was.draw) patch.draw = (ctx, it, H) => { ctx.save(); ctx.globalAlpha *= fadeGone; was.draw(ctx, Object.assign({}, it, { alpha: it.alpha * fadeGone }), H); ctx.restore(); }; // text drawn through the design sets its own alpha, so it gets the fade in `it`
      else patch.fade = (was.fade == null ? 1 : was.fade) * fadeGone;
      items[id] = Object.assign({}, was, patch);
    }
  }
  // The video behind the page plays in parts (see Motion › Layer video): each part after the first fades in as it starts (off by default: the parts dissolve into each other in the layer's own video settings).
  if ((stage === "04" || stage === "07") && val(P, "video.fade") > 0) {
    const k = out(clamp01(t / val(P, "video.fade")));
    if (k < 1) {
      const was = items["fg2-772"] || {};
      items["fg2-772"] = Object.assign({}, was, { fade: (was.fade == null ? 1 : was.fade) * k });
    }
  }
  return { cursor, items, press };
}

// What each part is called, what it moves, and its settings' pause at its end (the cards of the Interaction plan).
// The easing presets of the slide-in (Motion Plan › Animations › Slide in › Easing) and the side the layers slide in from.
function easeBy(name, x) {
  switch (name) {
    case "linear": return x;
    case "easeIn": return x * x * x;
    case "easeInOut": return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case "outCubic": return 1 - Math.pow(1 - x, 3);
    case "outQuart": return 1 - Math.pow(1 - x, 4);
    case "outExpo": return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
    case "outBack": { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
    default: return out(x);
  }
}
const SLIDE_FROM = { bottom: [0, 1], top: [0, -1], left: [-1, 0], right: [1, 0], topRight: [0.7071, -0.7071], topLeft: [-0.7071, -0.7071], bottomRight: [0.7071, 0.7071], bottomLeft: [-0.7071, 0.7071] };

// The slide-ins of a zoom-in part (04, 05, 06), one entry per layer: when it starts and ends (the scene's own time) and its step (layers of the
// same step slide in together). The timeline shows them as keyframes, grouped by step.
function slidesOf(P, stage) {
  if (!ENTER[stage] || !val(P, "enter.on")) return [];
  const begin = val(P, "enter.fadeDelay") + val(P, "enter.fadeTime");
  const wait = stage === "05" || stage === "06" ? val(P, "enter.cardDelay05") : 0;
  const chips = ["fg2-701", "fg2-702", "fg2-703", "fg2-705", "fg2-706", "fg2-707", "fg2-709", "fg2-710", "fg2-711", "fg2-712"];
  const table = stage === "05"
    ? Object.assign(Object.fromEntries(Object.entries(ENTER["05"]).map(([id, card]) => [id, card + 2])), Object.fromEntries(chips.map((id) => [id, 0])), { "fg2-713": 1 })
    : stage === "06"
      ? Object.assign(Object.fromEntries(Object.entries(ENTER["06"]).map(([id, card]) => [id, card + 2])), val(P, "flow.direct") ? {} : Object.fromEntries(["fg2-693", "fg2-695", "fg2-696", "fg2-697", "fg2-698"].map((id) => [id, 0])))
      : ENTER[stage];
  return Object.keys(table).map((id) => {
    const start = begin + wait + table[id] * val(P, "enter.stagger");
    return { end: start + val(P, "enter." + (table[id] + 1) + ".time"), id, start, step: table[id] };
  });
}

function describe(P, stage, L) {
  const data = {
    "04": [{ item: "Key stats", where: "Market value · Avg. rent · Cap rate count to page 03's values" }],
    "05": [{ item: "Occupancy", where: "numbers count, gauge redraws" }, { item: "Rent collection", where: "number counts, dot chart redraws" }],
    "06": [{ item: "Maintenance", where: "numbers count, bars resize" }, { item: "Net operating income", where: "number counts, dot chart redraws" }],
  };
  const parts = {
    "00": { name: "00 · Start", hold: val(P, "s0.pause"), items: [{ item: "Design", where: "nothing moves" }] },
    "09": { name: "09 · End", hold: val(P, "s10.pause"), items: [{ item: "Design", where: "nothing moves" }] },
    "01": { name: "01 · Cursor in", hold: val(P, "s2.hold"), items: [{ item: "Cursor", where: "comes in from off screen, then pauses" }] },
    "02": { name: "02 · Move for Arrows", hold: 0, items: [{ item: "Cursor", where: "moves to the right arrow" }] },
    "03": { name: "03 · Next", hold: val(P, "d3.hold"), items: [{ item: "Cursor", where: "clicks the right arrow, then once more" }, { item: "Pager", where: "01 → 02 after the first click, 02 → 03 after the second" }, { item: "All areas", where: "numbers, gauge, bars and dot charts count to page 02 after the first click" }] },
    "04": { name: "04 · Data change · img-01", hold: val(P, "d4.hold"), items: data["04"] },
    "05": { name: "05 · Data change · img-02", hold: val(P, "d5.hold"), items: data["05"] },
    "06": { name: "06 · Data change · img-03", hold: val(P, "d6.hold"), items: data["06"] },
    "07": { name: "07 · Back twice", hold: val(P, "d7.hold"), items: [{ item: "Cursor", where: "clicks the left arrow two times" }, { item: "Pager (img-04)", where: "03 → 02 → 01" }, { item: "All areas", where: "numbers, gauge, bars and dot charts count back to page 02 after the first click, page 01 after the second" }] },
    "08": { name: "08 · Cursor out", hold: val(P, "s9.pause"), items: [{ item: "Cursor", where: "pauses, then leaves the screen" }] },
  };
  return { id: stage, ...parts[stage], slides: slidesOf(P, stage), start: 0, end: L[stage] };
}

return {
  // The cursor is a layer of its own (Layers panel › Cursor): it is drawn as a small mark at the cursor's tip, which the Reactor items follow
  // (the pointer icons are drawn by the app at that place). Nothing is drawn while the cursor is off the picture.
  drawLayer(ctx, id, st, frame) {
    if (id !== CURSOR_ID) return;
    // Only the pass that looks for the cursor (the layer drawn alone) gets the mark; in the picture itself nothing is drawn.
    if (!frame || !frame.layerStack || frame.layerStack.length !== 1) return;
    const c = st && st.cursor;
    if (!c || c.hidden) return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(c.x, c.y, 6, 6);
    ctx.restore();
  },
  stateAt,
  // When each part starts and ends for the given settings: the scene's own part, or all of them one after another.
  getSegments(P) {
    P = P || {};
    const L = lengths(P);
    if (typeof P.__stage === "string" && (STAGES.includes(P.__stage) || IDLE[P.__stage])) return [describe(P, P.__stage, L)];
    let at = 0;
    return STAGES.map((stage) => {
      const part = describe(P, stage, L);
      const placed = { ...part, start: at, end: at + L[stage] };
      at += L[stage];
      return placed;
    });
  },
  lengths,
};
