# -*- coding: utf-8 -*-
"""Emit cli-anything-drawio commands that build the apartment plan 1:1 in metres."""
import sys, shlex
sys.path.insert(0, '.')
from plan import *
from dims import DIMS, NOTES

PROJ = "/home/user/what2wear/docs/apartment-plan/apartment-plan.drawio"

# page: plan extents plus margins, expressed in metres
PAGE_W_M, PAGE_H_M = 10.2, 19.1
PAGE_W, PAGE_H = int(PAGE_W_M * S), int(PAGE_H_M * S)
GRID = round(0.05 * S, 2)            # 5 cm snap

def m(v):  return v * S              # metres -> units
FS = {"title": m(0.26), "sub": m(0.135), "room": m(0.17),
      "area": m(0.13), "dim": m(0.115), "note": m(0.105)}

BAR   = m(0.012)                     # dimension-line thickness
TICK  = m(0.075)                     # end-tick length
DIMC  = "#1F5FA8"

cmds = []
def cli(*a):
    cmds.append("cli-anything-drawio --json --project %s %s" %
                (shlex.quote(PROJ), " ".join(shlex.quote(str(x)) for x in a)))

def add(kind, label, x, y, w, h, styles, placeholder=False):
    tag = "PH_" if placeholder else ""
    cmds.append("ID=$(cli-anything-drawio --json --project %s shape add %s -l %s "
                "--x %.3f --y %.3f -w %.3f -h %.3f | python3 -c "
                "'import sys,json;print(json.load(sys.stdin)[\"id\"])')" %
                (shlex.quote(PROJ), kind, shlex.quote(tag + label), x, y, w, h))
    for k, v in styles.items():
        cmds.append("cli-anything-drawio --json --project %s shape style \"$ID\" %s %s > /dev/null"
                    % (shlex.quote(PROJ), shlex.quote(k), shlex.quote(str(v))))

def keep_note(note, length):
    """Show the sketch value only when the drawing does not already say it."""
    try:
        return abs(float(note.replace(",", ".")) - length) > 5e-4
    except ValueError:
        return True          # "0,45 + 0,242", "1,051 на эскизе", "вход" ...


def X(v): return OX + v * S
def Y(v): return OY + v * S

def rectangles(poly):
    """Decompose a rectilinear polygon into rectangles (y-band sweep)."""
    ys = sorted({y for _, y in poly}); out = []
    for y0, y1 in zip(ys, ys[1:]):
        ym = (y0 + y1) / 2.0; xs = []
        for i in range(len(poly)):
            ax, ay = poly[i]; bx, by = poly[(i + 1) % len(poly)]
            if ax == bx and min(ay, by) < ym < max(ay, by): xs.append(ax)
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]): out.append((a, y0, b - a, y1 - y0))
    return out

# --------------------------------------------------------------------- build
cli("project", "new", "--preset", "custom", "--width", PAGE_W, "--height", PAGE_H, "-o", PROJ)
cli("page", "rename", "0", "План квартиры")

COL = {"A": "#E6EEFA", "B": "#FBEEE0", "C": "#E3F4EA", "H": "#EFEAF8", "D": "#FBE8E8"}

for k, poly, name in ROOMS:                                    # floors
    for (x, y, w, h) in rectangles(poly):
        add("rectangle", "", X(x), Y(y), m(w), m(h),
            {"fillColor": COL[k], "strokeColor": "none"})

for (x, y, w, h) in WALLS:                                     # walls
    add("rectangle", "", X(x), Y(y), m(w), m(h),
        {"fillColor": "#3A3A3A", "strokeColor": "none"})

for (gap, door, lbl) in DOORS:                                 # doors
    if gap:
        gx, gy, gw, gh = gap
        add("rectangle", "", X(gx), Y(gy), m(gw), m(gh),
            {"fillColor": "#FFFFFF", "strokeColor": "none"})
    dx, dy, dw, dh, direction, kind = door
    add("rectangle", "", dx, dy, dw, dh,
        {"shape": "mxgraph.floorplan." + kind, "direction": direction,
         "strokeColor": "#8C8C8C", "fillColor": "#FFFFFF", "html": 1,
         "strokeWidth": round(m(0.012), 1)})

for k, poly, name in ROOMS:                                    # room labels
    cx, cy = centroid(poly)
    txt = (name.replace("|", "<br>") +
           "<br><font style='font-size:%dpx;color:#777'>%.2f м²</font>" % (FS["area"], area(poly)))
    add("text", txt, X(cx) - m(1.0), Y(cy) - m(0.3), m(2.0), m(0.6),
        {"fontSize": int(FS["room"]), "fontStyle": 1, "fontColor": "#2B2B2B", "align": "center"})

# ------------------------------------------------- live dimension lines
for (kind, x, y, length, note) in DIMS:
    if kind == "h":
        bx, by, bw, bh = X(x), Y(y) - BAR / 2, m(length), BAR
        add("rectangle", "%width-m%", bx, by, bw, bh,
            {"fillColor": DIMC, "strokeColor": "none", "fontSize": int(FS["dim"]),
             "fontColor": DIMC, "align": "center", "verticalAlign": "bottom",
             "verticalLabelPosition": "top", "labelPosition": "center"}, placeholder=True)
        for tx in (bx, bx + bw - BAR):
            add("rectangle", "", tx, by - TICK / 2 + BAR / 2, BAR, TICK,
                {"fillColor": DIMC, "strokeColor": "none"})
        if keep_note(note, length):
            add("text", note, bx, by + BAR, bw, m(0.16),
                {"fontSize": int(m(0.095)), "fontColor": "#9AA7B8", "align": "center"})
    else:
        bx, by, bw, bh = X(x) - BAR / 2, Y(y), BAR, m(length)
        add("rectangle", "%height-m%", bx, by, bw, bh,
            {"fillColor": DIMC, "strokeColor": "none", "fontSize": int(FS["dim"]),
             "fontColor": DIMC, "align": "right", "verticalAlign": "middle",
             "labelPosition": "left", "verticalLabelPosition": "middle",
             "horizontal": 0}, placeholder=True)
        for ty in (by, by + bh - BAR):
            add("rectangle", "", bx - TICK / 2 + BAR / 2, ty, TICK, BAR,
                {"fillColor": DIMC, "strokeColor": "none"})
        if keep_note(note, length):
            add("text", note, bx + BAR, by, m(0.16), bh,
                {"fontSize": int(m(0.095)), "fontColor": "#9AA7B8",
                 "align": "left", "horizontal": 0})

# ------------------------------------------------------------- title / notes
add("text", "ПЛАН КВАРТИРЫ<br><font style='font-size:%dpx;font-weight:normal'>"
    "по обмерам с эскиза (IMG_2445) · чертёж 1:1 в метрах · View → Units → Meters</font>"
    % FS["sub"], m(0.15), m(0.30), m(9.0), m(0.75),
    {"fontSize": int(FS["title"]), "fontStyle": 1, "fontColor": "#1A1A1A", "align": "left"})

add("text", "Общая площадь по помещениям: <b>%.2f м²</b>" % sum(area(p) for _, p, _ in ROOMS),
    m(0.15), m(1.15), m(9.0), m(0.28), {"fontSize": int(FS["sub"]), "fontColor": "#333", "align": "left"})

add("note", NOTES.replace("\n", "<br>"), m(0.15), m(16.05), m(9.9), m(2.75),
    {"fontSize": int(FS["note"]), "align": "left", "verticalAlign": "top",
     "fillColor": "#FFFDF0", "strokeColor": "#D9D2B0", "spacing": int(m(0.08))})

open("build.sh", "w").write("set -e\n" + "\n".join(cmds) + "\n")
print(len(cmds), "commands · page", PAGE_W, "x", PAGE_H, "· grid", GRID)
