# -*- coding: utf-8 -*-
"""Render a .drawio file to SVG. Supports the style subset used by this plan:
filled rectangles, text, the mxgraph.floorplan door stencils, note shapes and
the %width-m% / %height-m% placeholders resolved the way draw.io resolves them."""
import re, sys, html
import xml.etree.ElementTree as ET

PIXELS_PER_M = 3937.0

def parse_style(s):
    d = {}
    for part in (s or "").split(";"):
        if not part: continue
        if "=" in part:
            k, v = part.split("=", 1); d[k] = v
        else: d[part] = True
    return d

def to_m(px):
    v = round(px * 100000 / PIXELS_PER_M) / 100000
    return ("%.5f" % v).rstrip("0").rstrip(".")

def door_geom(kind, w, h, direction):
    fw, fh = (h, w) if direction in ("north", "south") else (w, h)
    d = (f"M {fw} 5 A {fw} {fw} 0 0 1 0 {5+fw} L 0 5" if kind == "doorLeft"
         else f"M 0 5 A {fw} {fw} 0 0 0 {fw} {5+fw} L {fw} 5")
    return d, {"east": 0, "south": 90, "west": 180, "north": 270}[direction], fw, fh

def cells(root):
    """Yield (id, label, mxCell) including <object> placeholder wrappers."""
    for obj in root.iter("object"):
        c = obj.find("mxCell")
        if c is not None: yield obj.get("label") or "", c
    for c in root.iter("mxCell"):
        if c.getparent_is_object if False else False: continue
        yield c.get("value") or "", c

def render(path, out, px_per_m=105.0):
    root = ET.parse(path).getroot()
    model = root.find(".//mxGraphModel")
    k = px_per_m / PIXELS_PER_M                       # units -> output px
    W = float(model.get("pageWidth")) * k
    H = float(model.get("pageHeight")) * k
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" '
         f'viewBox="0 0 {W:.0f} {H:.0f}">',
         f'<rect width="{W:.0f}" height="{H:.0f}" fill="#ffffff"/>']

    obj_cells = {}
    for obj in root.iter("object"):
        c = obj.find("mxCell")
        if c is not None: obj_cells[id(c)] = obj.get("label") or ""

    for cell in root.iter("mxCell"):
        if cell.get("vertex") != "1": continue
        g = cell.find("mxGeometry")
        if g is None: continue
        x, y = float(g.get("x", 0)) * k, float(g.get("y", 0)) * k
        w, h = float(g.get("width", 0)) * k, float(g.get("height", 0)) * k
        raw_w, raw_h = float(g.get("width", 0)), float(g.get("height", 0))
        st = parse_style(cell.get("style", ""))
        if id(cell) in obj_cells:
            val = obj_cells[id(cell)].replace("%width-m%", to_m(raw_w)) \
                                     .replace("%height-m%", to_m(raw_h))
        else:
            val = cell.get("value") or ""
        shape = st.get("shape", "")
        fill = st.get("fillColor", "#ffffff"); stroke = st.get("strokeColor", "#000000")

        if shape.startswith("mxgraph.floorplan.door"):
            d, rot, fw, fh = door_geom(shape.rsplit(".", 1)[1], w, h, st.get("direction", "east"))
            cx, cy = x + w / 2, y + h / 2
            p.append(f'<g transform="rotate({rot} {cx:.2f} {cy:.2f}) '
                     f'translate({cx-fw/2:.2f} {cy-fh/2:.2f})">'
                     f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="1.3"/></g>')
            continue

        if shape == "note" or (not shape and "text" not in st):
            p.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
                     f'fill="{fill}" stroke="{stroke}" stroke-width="1"/>')
        if not val: continue

        fs = float(st.get("fontSize", 12)) * k
        fc = st.get("fontColor", "#000000")
        bold = "bold" if str(st.get("fontStyle", "0")) in ("1", "5", "7") else "normal"
        align = st.get("align", "center")
        lp, vlp = st.get("labelPosition", "center"), st.get("verticalLabelPosition", "middle")
        vert = st.get("horizontal") == "0"

        if lp == "left":     ax, anchor = x - fs * 0.4, "end"
        elif lp == "right":  ax, anchor = x + w + fs * 0.4, "start"
        else:
            ax = {"left": x + 4, "center": x + w / 2, "right": x + w - 4}[align]
            anchor = {"left": "start", "center": "middle", "right": "end"}[align]

        lines = []
        for ln in val.replace("<br/>", "<br>").split("<br>"):
            sz = fs; col = fc
            mm = re.search(r"font-size:(\d+)px", ln)
            if mm: sz = float(mm.group(1)) * k
            mc = re.search(r"color:(#[0-9A-Fa-f]{3,6})", ln)
            if mc: col = mc.group(1)
            b = "bold" if "<b>" in ln else bold
            lines.append((re.sub(r"<[^>]+>", "", html.unescape(ln)).strip(), sz, col, b))

        if vlp == "top":       y0 = y - sum(s_ * 1.25 for _, s_, _, _ in lines) + fs * 0.15
        elif vlp == "bottom":  y0 = y + h
        elif st.get("verticalAlign") == "top": y0 = y + 4
        else: y0 = y + h / 2 - sum(s_ * 1.25 for _, s_, _, _ in lines) / 2
        cy = y0
        for t, sz, col, b in lines:
            cy += sz * 1.05
            if t:
                tr = f' transform="rotate(-90 {ax:.1f} {cy:.1f})"' if vert else ""
                p.append(f'<text x="{ax:.1f}" y="{cy:.1f}" text-anchor="{anchor}"{tr} '
                         f'font-family="Helvetica,Arial" font-size="{sz:.1f}" font-weight="{b}" '
                         f'fill="{col}">{html.escape(t)}</text>')
            cy += sz * 0.2
    p.append("</svg>")
    open(out, "w", encoding="utf-8").write("\n".join(p))

if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2]); print("rendered ->", sys.argv[2])
