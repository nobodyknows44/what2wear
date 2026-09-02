# -*- coding: utf-8 -*-
"""Render a .drawio (mxGraph XML) file to SVG — supports the style subset used here,
including the mxgraph.floorplan door stencils, so the preview matches the real file."""
import re, sys, html
import xml.etree.ElementTree as ET

def parse_style(s):
    d = {}
    for part in (s or "").split(";"):
        if not part: continue
        if "=" in part:
            k, v = part.split("=", 1); d[k] = v
        else:
            d[part] = True
    return d

def door_path(kind, w, h, direction):
    """Return (band_rect, path_d) in the stencil's own frame, then the transform."""
    # stencil frame: for north/south the drawing frame is (h, w)
    fw, fh = (h, w) if direction in ("north", "south") else (w, h)
    band = (0, 0, fw, 5)
    if kind == "doorLeft":
        d = f"M {fw} 5 A {fw} {fw} 0 0 1 0 {5+fw} L 0 5"
    else:
        d = f"M 0 5 A {fw} {fw} 0 0 0 {fw} {5+fw} L {fw} 5"
    rot = {"east": 0, "south": 90, "west": 180, "north": 270}[direction]
    return band, d, rot, fw, fh

def render(path, out):
    root = ET.parse(path).getroot()
    model = root.find(".//mxGraphModel")
    pw = float(model.get("pageWidth", 1169)); ph = float(model.get("pageHeight", 1654))
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{pw:.0f}" height="{ph:.0f}" '
             f'viewBox="0 0 {pw:.0f} {ph:.0f}">',
             f'<rect width="{pw:.0f}" height="{ph:.0f}" fill="#ffffff"/>']
    for cell in model.iter("mxCell"):
        if cell.get("vertex") != "1": continue
        g = cell.find("mxGeometry")
        if g is None: continue
        x, y = float(g.get("x", 0)), float(g.get("y", 0))
        w, h = float(g.get("width", 0)), float(g.get("height", 0))
        st = parse_style(cell.get("style", ""))
        val = cell.get("value") or ""
        shape = st.get("shape", "")
        fill = st.get("fillColor", "#ffffff")
        stroke = st.get("strokeColor", "#000000")
        if fill == "none": fill = "none"
        if stroke == "none": stroke = "none"

        if shape.startswith("mxgraph.floorplan.door"):
            kind = shape.rsplit(".", 1)[1]
            band, d, rot, fw, fh = door_path(kind, w, h, st.get("direction", "east"))
            cx, cy = x + w / 2, y + h / 2
            ox, oy = cx - fw / 2, cy - fh / 2
            parts.append(f'<g transform="rotate({rot} {cx:.2f} {cy:.2f}) translate({ox:.2f} {oy:.2f})">')
            parts.append(f'<rect x="0" y="0" width="{fw:.2f}" height="5" fill="{fill}" stroke="{stroke}" stroke-width="1"/>')
            parts.append(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="1.4"/>')
            parts.append('</g>')
            continue

        rot = float(st.get("rotation", 0))
        tr = f' transform="rotate({rot} {x+w/2:.2f} {y+h/2:.2f})"' if rot else ""

        if shape == "note":
            parts.append(f'<g{tr}><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" '
                         f'stroke="{stroke}" stroke-width="1"/>')
        elif "text" in st and not shape:
            parts.append(f'<g{tr}>')
        else:
            parts.append(f'<g{tr}><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" '
                         f'stroke="{stroke}" stroke-width="1"/>')

        if val:
            fs = float(st.get("fontSize", 12))
            fc = st.get("fontColor", "#000000")
            bold = "bold" if str(st.get("fontStyle", "0")) in ("1", "5", "7") else "normal"
            align = st.get("align", "center")
            va = st.get("verticalAlign", "middle")
            ax = {"left": x + 4, "center": x + w / 2, "right": x + w - 4}[align]
            anchor = {"left": "start", "center": "middle", "right": "end"}[align]
            # crude inline-HTML handling: <br> -> lines, strip tags, keep font-size hints
            txt = val.replace("<br>", "\n").replace("<br/>", "\n")
            lines = []
            for ln in txt.split("\n"):
                sz = fs
                m = re.search(r"font-size:(\d+)px", ln)
                if m: sz = float(m.group(1))
                col = fc
                m2 = re.search(r"color:(#[0-9A-Fa-f]{3,6})", ln)
                if m2: col = m2.group(1)
                b = bold if "<b>" not in ln else "bold"
                lines.append((re.sub(r"<[^>]+>", "", html.unescape(ln)).strip(), sz, col, b))
            total = sum(s_ * 1.25 for _, s_, _, _ in lines)
            y0 = (y + h / 2 - total / 2) if va == "middle" else y + 6
            cy = y0
            for t, sz, col, b in lines:
                cy += sz * 1.05
                if t:
                    parts.append(f'<text x="{ax:.1f}" y="{cy:.1f}" text-anchor="{anchor}" '
                                 f'font-family="Helvetica,Arial" font-size="{sz}" font-weight="{b}" '
                                 f'fill="{col}">{html.escape(t)}</text>')
                cy += sz * 0.2
        parts.append('</g>')
    parts.append('</svg>')
    open(out, "w", encoding="utf-8").write("\n".join(parts))

if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2]); print("rendered ->", sys.argv[2])
