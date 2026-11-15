"""生成 sw.js（离线缓存）。改动任何网页文件后重新运行：python build_sw.py
文件列表和内容哈希会写进 sw.js，手机下次联网打开时自动更新缓存。"""
import hashlib, json, os, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP = {"sw.js", "build_sw.py", "README.md", ".nojekyll"}
files, h = [], hashlib.sha256()
for dp, dns, fns in os.walk(ROOT):
    dns[:] = sorted(d for d in dns if not d.startswith("."))
    for fn in sorted(fns):
        rel = os.path.relpath(os.path.join(dp, fn), ROOT).replace(os.sep, "/")
        if rel in SKIP or fn.startswith("."):
            continue
        # 与页面里 encodeURIComponent 一致的编码，保证缓存键对得上
        url = "/".join(urllib.parse.quote(seg, safe="-_.!~*'()") for seg in rel.split("/"))
        files.append(url)
        h.update(rel.encode("utf8"))
        h.update(open(os.path.join(dp, fn), "rb").read())
version = h.hexdigest()[:12]
files.sort(key=lambda u: (u.startswith("avatars/"), u))
sw = f"""// 由 build_sw.py 生成，不要手动修改
const VERSION = "{version}";
const CACHE = "wsxy-" + VERSION;
const FILES = ["./", {", ".join(json.dumps(f) for f in files)}];

self.addEventListener("install", e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
}});
self.addEventListener("activate", e => {{
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith("wsxy-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
}});
// 先用缓存（离线秒开），新版本靠 VERSION 变化整体替换
self.addEventListener("fetch", e => {{
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(c =>
    c.match(req, {{ignoreSearch: true}}).then(hit => hit || fetch(req).then(res => {{
      if (res.ok) c.put(req, res.clone());
      return res;
    }}).catch(() => req.mode === "navigate" ? c.match("./") : Response.error()))
  ));
}});
"""
open(os.path.join(ROOT, "sw.js"), "w", encoding="utf8").write(sw)
print(f"sw.js: {len(files)} files, version {version}")
