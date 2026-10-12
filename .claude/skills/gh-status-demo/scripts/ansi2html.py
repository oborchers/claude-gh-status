"""Convert a herdr ANSI pane capture into a standalone HTML page for a screenshot.

usage: ansi2html.py [--font-dir DIR] [--font-family NAME] in.ansi out.html
                    [first_row] [last_row] [first_col] [last_col]

Rows and columns are 0-based and inclusive; use - or omit for "all".
Use the row range to leave out the status line below the prompt.

Fonts: --font-dir points to a folder with a Regular and a Bold .ttf (the first
file whose name contains "Regular" and the first containing "Bold" but not
"Italic"). They are copied next to out.html as font-regular.ttf and
font-bold.ttf and loaded through @font-face under --font-family. Without
--font-dir the page uses the system font named by --font-family
(default: monospace).

The page has a .win element (window with title bar and the text); screenshot
that element with a transparent background. Colors are TokyoNight-like.
"""
import argparse
import glob
import html
import os
import re
import shutil

PALETTE16 = [
    '#1d1f21', '#cc6666', '#b5bd68', '#f0c674', '#81a2be', '#b294bb', '#8abeb7', '#c5c8c6',
    '#666666', '#d54e53', '#b9ca4a', '#e7c547', '#7aa6da', '#c397d8', '#70c0b1', '#eaeaea',
]
FG_DEFAULT = '#c0caf5'
BG_DEFAULT = '#1a1b26'


def xterm256(n):
    if n < 16:
        return PALETTE16[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return '#%02x%02x%02x' % (v, v, v)


class Style:
    def __init__(self):
        self.reset()

    def reset(self):
        self.fg = None
        self.bg = None
        self.bold = False
        self.dim = False
        self.italic = False
        self.underline = False
        self.inverse = False

    def key(self):
        return (self.fg, self.bg, self.bold, self.dim, self.italic, self.underline, self.inverse)

    def css(self):
        fg, bg = self.fg, self.bg
        if self.inverse:
            fg, bg = (bg or BG_DEFAULT), (fg or FG_DEFAULT)
        parts = []
        if fg:
            parts.append('color:%s' % fg)
        if bg:
            parts.append('background:%s' % bg)
        if self.bold:
            parts.append('font-weight:700')
        if self.dim:
            parts.append('opacity:.6')
        if self.italic:
            parts.append('font-style:italic')
        if self.underline:
            parts.append('text-decoration:underline')
        return ';'.join(parts)


def apply_sgr(style, params):
    codes = [int(p) if p else 0 for p in params.split(';')] if params else [0]
    i = 0
    while i < len(codes):
        c = codes[i]
        if c == 0:
            style.reset()
        elif c == 1:
            style.bold = True
        elif c == 2:
            style.dim = True
        elif c == 3:
            style.italic = True
        elif c == 4:
            style.underline = True
        elif c == 7:
            style.inverse = True
        elif c == 22:
            style.bold = style.dim = False
        elif c == 23:
            style.italic = False
        elif c == 24:
            style.underline = False
        elif c == 27:
            style.inverse = False
        elif 30 <= c <= 37:
            style.fg = PALETTE16[c - 30]
        elif 90 <= c <= 97:
            style.fg = PALETTE16[c - 90 + 8]
        elif 40 <= c <= 47:
            style.bg = PALETTE16[c - 40]
        elif 100 <= c <= 107:
            style.bg = PALETTE16[c - 100 + 8]
        elif c == 39:
            style.fg = None
        elif c == 49:
            style.bg = None
        elif c in (38, 48) and i + 1 < len(codes):
            if codes[i + 1] == 2 and i + 4 < len(codes):
                color = '#%02x%02x%02x' % tuple(codes[i + 2:i + 5])
                i += 4
            elif codes[i + 1] == 5 and i + 2 < len(codes):
                color = xterm256(codes[i + 2])
                i += 2
            else:
                color = None
            if c == 38:
                style.fg = color
            else:
                style.bg = None if color == '#000000' else color
        i += 1


TOKEN = re.compile(r'\x1b\[([0-9;]*)([A-Za-z])|\x1b\][^\x07]*\x07|\x1b\]8;;[^\x1b]*\x1b\\')


def parse_lines(text):
    """Returns rows of (char, style_key, css) cells."""
    style = Style()
    rows = []
    for raw in text.split('\n'):
        cells = []
        pos = 0
        for match in TOKEN.finditer(raw):
            for ch in raw[pos:match.start()]:
                cells.append((ch, style.css()))
            if match.group(2) == 'm':
                apply_sgr(style, match.group(1))
            pos = match.end()
        for ch in raw[pos:]:
            cells.append((ch, style.css()))
        rows.append(cells)
    return rows


def render(rows, r0, r1, c0, c1):
    out = []
    for cells in rows[r0:r1 + 1]:
        cells = cells[c0:c1 + 1] if c1 is not None else cells[c0:]
        line = []
        current = None
        buf = ''
        for ch, css in cells:
            if css != current:
                if buf:
                    line.append(span(buf, current))
                buf, current = '', css
            buf += ch
        if buf:
            line.append(span(buf, current))
        out.append(''.join(line))
    return '\n'.join(out)


def span(text, css):
    text = html.escape(text)
    return '<span style="%s">%s</span>' % (css, text) if css else text


def find_font(font_dir, bold):
    for path in sorted(glob.glob(os.path.join(font_dir, '*.ttf'))):
        name = os.path.basename(path)
        if bold and 'Bold' in name and 'Italic' not in name and 'Oblique' not in name:
            return path
        if not bold and 'Regular' in name:
            return path
    raise SystemExit('no %s .ttf in %s' % ('Bold' if bold else 'Regular', font_dir))


def font_face(font_dir, family, out_dir):
    if not font_dir:
        return ''
    faces = []
    for bold, name, weight in ((False, 'font-regular.ttf', 400), (True, 'font-bold.ttf', 700)):
        shutil.copyfile(find_font(font_dir, bold), os.path.join(out_dir, name))
        faces.append('@font-face{font-family:"%s";font-weight:%d;src:url(%s)}' % (family, weight, name))
    return ''.join(faces)


def main():
    parser = argparse.ArgumentParser(description='ANSI capture to HTML screenshot page')
    parser.add_argument('src')
    parser.add_argument('dst')
    parser.add_argument('range', nargs='*', help='first_row last_row first_col last_col')
    parser.add_argument('--font-dir', default=None)
    parser.add_argument('--font-family', default='monospace')
    args = parser.parse_args()
    rest = [int(a) if a != '-' else None for a in args.range] + [None] * 4
    rows = parse_lines(open(args.src, encoding='utf-8').read())
    r0 = rest[0] or 0
    r1 = rest[1] if rest[1] is not None else len(rows) - 1
    c0 = rest[2] or 0
    c1 = rest[3]
    body = render(rows, r0, r1, c0, c1)
    out_dir = os.path.dirname(os.path.abspath(args.dst))
    faces = font_face(args.font_dir, args.font_family, out_dir)
    stack = '"%s",monospace' % args.font_family if args.font_family != 'monospace' else 'monospace'
    page = f'''<!doctype html><html><head><meta charset="utf-8"><style>
{faces}
html,body{{margin:0;background:transparent}}
.win{{display:inline-block;margin:24px;border-radius:10px;background:{BG_DEFAULT};box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden}}
.bar{{height:28px;background:#2a2b36;display:flex;align-items:center;padding-left:12px;gap:8px}}
.dot{{width:12px;height:12px;border-radius:6px}}
pre{{margin:0;padding:14px 18px;color:{FG_DEFAULT};font:15px/1.25 {stack};white-space:pre}}
</style></head><body><div class="win"><div class="bar"><div class="dot" style="background:#ff5f57"></div><div class="dot" style="background:#febc2e"></div><div class="dot" style="background:#28c840"></div></div><pre>{body}</pre></div></body></html>'''
    open(args.dst, 'w', encoding='utf-8').write(page)


main()
