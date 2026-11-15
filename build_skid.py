import json, os, sys
SP = os.path.dirname(os.path.abspath(__file__))
# 用法：python build_skid.py <本项目目录> <StrongholdAssistant 的 data 目录>
SA = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SP, "sa_src", "sa", "data")
APP = sys.argv[1]
def jsload(p, pre):
    s = open(p, encoding="utf8").read()
    i = s.index(pre) + len(pre); s = s[i:].strip().rstrip(";")
    return json.loads(s)
D = jsload(os.path.join(APP, "data.js"), "window.DATA=")
ST = jsload(os.path.join(APP, "strategies.js"), "window.STRATS=")
BO = jsload(os.path.join(APP, "bosses.js"), "window.BOSSES=")
ops = {o["name"] for o in D["operators"]}
eqs = {e["name"] for e in D["equipment"]}
bonds = {b["name"] for b in D["bonds"]}
strats = {x["name"] for x in ST}
bosses = {b["name"] for b in BO["list"]}

cx = json.load(open(os.path.join(SA, "codex_extra.json"), encoding="utf8"))
out = {"op": {}, "eq": {}, "bond": {}, "strat": {}, "boss": {}}
miss = {k: [] for k in out}
for name, v in cx["operators"].items():
    if v.get("charId"):
        out["op"][v["charId"]] = name
        if name not in ops: miss["op"].append(name)
for name, v in cx["equipment"].items():
    for i in [v.get("itemId")] + v.get("itemAliases", []):
        if i: out["eq"][i] = name
    if name not in eqs: miss["eq"].append(name)
for name, i in json.load(open(os.path.join(SA, "covenant_ids.json"), encoding="utf8")).items():
    out["bond"][i] = name
    if name not in bonds: miss["bond"].append(name)
for x in json.load(open(os.path.join(SA, "strategies.json"), encoding="utf8"))["strategies"]:
    out["strat"][x["id"]] = x["name"]
    if x["name"] not in strats: miss["strat"].append(x["name"])
enemy = {b["enemyId"]: b["name"] for b in json.load(open(os.path.join(SA, "bosses.json"), encoding="utf8"))["bosses"]}
BOSS_IDS = {"boss_1":"enemy_9013_acstmk","boss_2":"enemy_9017_achunt","boss_3":"enemy_9021_acduml","boss_4":"enemy_1521_dslily",
 "boss_6":"enemy_9032_aclionk","boss_7":"enemy_9033_acdeer","boss_8":"enemy_9013_acstmk","boss_9":"enemy_9017_achunt",
 "boss_10":"enemy_9021_acduml","boss_11":"enemy_9029_acfnc","boss_12":"enemy_9035_acspider","boss_13":"enemy_9037_aceel",
 "boss_14":"enemy_9029_acfnc","boss_15":"enemy_9035_acspider","boss_16":"enemy_9037_aceel","boss_17":"enemy_2124_dyjsfg"}
for k, e in BOSS_IDS.items():
    if e in enemy:
        out["boss"][k] = enemy[e]
        if enemy[e] not in bosses: miss["boss"].append(enemy[e])
print({k: len(v) for k, v in out.items()})
print("not in our data:", {k: sorted(set(v)) for k, v in miss.items()})
print("our ops not mapped:", sorted(ops - set(out["op"].values())))
print("our bonds not mapped:", sorted(bonds - set(out["bond"].values())))
print("our strats not mapped:", sorted(strats - set(out["strat"].values())))
hdr = "// 森空岛战绩里的编号 → 名称。编号对照来自 LBEILC/StrongholdAssistant 的 data/（Apache-2.0，基于 Moonfair/ASP_Assistant），由 build_skid.py 生成\n"
open(os.path.join(APP, "skland_ids.js"), "w", encoding="utf8").write(hdr + "window.SKID=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
