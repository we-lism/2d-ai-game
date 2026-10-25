"""Cache-busting: stamp every local JS/CSS reference with ?v=<version> so browsers load new code after each deploy.
Run before committing:  python3 tools/stamp.py
"""
import re, pathlib, time
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime("%Y%m%d%H%M")
pat = re.compile(r'''((?:from|import)\s*\(?\s*["'])(\.{1,2}/[^"'?]+\.js)(?:\?v=\d+)?(["'])''')
for f in (root / "js").rglob("*.js"):
    s = f.read_text(encoding="utf-8"); n = pat.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", s)
    if n != s: f.write_text(n, encoding="utf-8")
h = root / "index.html"; s = h.read_text(encoding="utf-8")
s = re.sub(r'''((?:src|href)=["'])((?:js|css)/[^"'?]+\.(?:js|css))(?:\?v=\d+)?(["'])''', lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}", s)
h.write_text(s, encoding="utf-8")
print("stamped", v)
