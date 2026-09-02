# -*- coding: utf-8 -*-
"""Emit cli-anything-drawio commands that build the apartment plan."""
import sys, shlex
sys.path.insert(0, '.')
from plan import *
from dims import DIMS, NOTES

PROJ = "/home/user/what2wear/docs/apartment-plan/apartment-plan.drawio"
cmds = []

def cli(*a):
    cmds.append("cli-anything-drawio --json --project %s %s" %
                (shlex.quote(PROJ), " ".join(shlex.quote(str(x)) for x in a)))

def add(kind, label, x, y, w, h, styles):
    """add a shape then apply style keys; the id is captured by the shell"""
    cmds.append("ID=$(cli-anything-drawio --json --project %s shape add %s -l %s "
                "--x %.2f --y %.2f -w %.2f -h %.2f | python3 -c "
                "'import sys,json;print(json.load(sys.stdin)[\"id\"])')" %
                (shlex.quote(PROJ), kind, shlex.quote(label), x, y, w, h))
    for k, v in styles.items():
        cmds.append("cli-anything-drawio --json --project %s shape style \"$ID\" %s %s > /dev/null"
                    % (shlex.quote(PROJ), shlex.quote(k), shlex.quote(str(v))))

def X(v): return OX + v * S
def Y(v): return OY + v * S

# ---------------------------------------------------------------- rectangles
def rectangles(poly):
    """Decompose a rectilinear polygon into rectangles (y-band sweep)."""
    ys = sorted({y for _, y in poly})
    out = []
    for y0, y1 in zip(ys, ys[1:]):
        ym = (y0 + y1) / 2.0
        xs = []
        for i in range(len(poly)):
            ax, ay = poly[i]; bx, by = poly[(i + 1) % len(poly)]
            if ax == bx and min(ay, by) < ym < max(ay, by):
                xs.append(ax)
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            out.append((a, y0, b - a, y1 - y0))
    return out

# ---------------------------------------------------------------- build
cli("project", "new", "--preset", "a3", "-o", PROJ)
cli("page", "rename", "0", "План квартиры")

COL = {"A": "#E6EEFA", "B": "#FBEEE0", "C": "#E3F4EA", "H": "#EFEAF8", "D": "#FBE8E8"}

# room floors
for k, poly, name in ROOMS:
    for (x, y, w, h) in rectangles(poly):
        add("rectangle", "", X(x), Y(y), w * S, h * S,
            {"fillColor": COL[k], "strokeColor": "none"})

# walls
for (x, y, w, h) in WALLS:
    add("rectangle", "", X(x), Y(y), w * S, h * S,
        {"fillColor": "#3A3A3A", "strokeColor": "none"})

# door openings (gap in the wall) + door leaf/arc
for (gap, door, lbl) in DOORS:
    if gap:
        gx, gy, gw, gh = gap
        add("rectangle", "", X(gx), Y(gy), gw * S, gh * S,
            {"fillColor": "#FFFFFF", "strokeColor": "none"})
    dx, dy, dw, dh, direction, kind = door
    add("rectangle", "", dx, dy, dw, dh,
        {"shape": "mxgraph.floorplan." + kind, "direction": direction,
         "strokeColor": "#8C8C8C", "fillColor": "#FFFFFF", "html": 1})

# room labels
for k, poly, name in ROOMS:
    cx, cy = centroid(poly)
    txt = name.replace("|", "<br>") + "<br><font style='font-size:12px;color:#777'>%.2f м²</font>" % area(poly)
    add("text", txt, X(cx) - 90, Y(cy) - 26, 180, 52,
        {"fontSize": 15, "fontStyle": 1, "fontColor": "#2B2B2B", "align": "center"})

# dimension labels
for (t, x, y, rot) in DIMS:
    add("text", t, X(x) - 26, Y(y) - 9, 52, 18,
        {"fontSize": 11, "fontColor": "#1F5FA8", "align": "center", "rotation": rot})

# title block + notes
add("text", "ПЛАН КВАРТИРЫ<br><font style='font-size:13px;font-weight:normal'>"
    "по обмерам с эскиза (IMG_2445) · масштаб 1:100 · размеры в метрах</font>",
    60, 40, 700, 56, {"fontSize": 22, "fontStyle": 1, "fontColor": "#1A1A1A", "align": "left"})

add("text", "Общая площадь по помещениям: <b>%.2f м²</b>" % sum(area(p) for _, p, _ in ROOMS),
    60, 108, 700, 22, {"fontSize": 14, "fontColor": "#333", "align": "left"})

add("note", NOTES.replace("\n", "<br>"), 55, 1424, 1060, 196,
    {"fontSize": 11, "align": "left", "verticalAlign": "top", "fillColor": "#FFFDF0",
     "strokeColor": "#D9D2B0", "spacing": 8})

cli("project", "info")
open("build.sh", "w").write("set -e\n" + "\n".join(cmds) + "\n")
print(len(cmds), "commands")
