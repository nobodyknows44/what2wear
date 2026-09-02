# -*- coding: utf-8 -*-
"""Wrap placeholder-labelled cells in <object placeholders="1"> so draw.io
resolves %width-m% / %height-m%, and set the snap grid.

The CLI writes plain mxCell values; placeholder resolution needs an object
value (Graph.isReplacePlaceholders), so this runs after the CLI build."""
import re, sys

def main(path, grid):
    s = open(path, encoding="utf-8").read()

    s = re.sub(r'(<mxGraphModel\b[^>]*?)\bgridSize="[^"]*"', r'\1gridSize="%s"' % grid, s)

    # <mxCell id="X" value="PH_%width-m%" style="..." vertex="1" parent="1"> ... </mxCell>
    pat = re.compile(
        r'<mxCell id="([^"]+)" value="PH_([^"]*)" (style="[^"]*" vertex="1" parent="1">.*?</mxCell>)',
        re.S)

    def repl(m):
        cid, label, rest = m.groups()
        return ('<object label="%s" placeholders="1" id="%s">\n'
                '          <mxCell %s\n        </object>' % (label, cid, rest))

    s, n = pat.subn(repl, s)
    open(path, "w", encoding="utf-8").write(s)
    print("wrapped %d placeholder cells, gridSize=%s" % (n, grid))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
