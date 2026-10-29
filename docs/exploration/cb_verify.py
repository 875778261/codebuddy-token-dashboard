import json, os, glob, collections, datetime, sys

BASE = r"C:\Users\HUAWEI\AppData\Local\CodeBuddyExtension\Data"

def P(p):
    p = os.path.abspath(p)
    if os.name != "nt":
        return p
    if p.startswith("\\\\?\\"):
        return p
    return "\\\\?\\" + p

def b64name(s):
    try:
        import base64
        pad = "=" * (-len(s) % 4)
        return base64.urlsafe_b64decode(s + pad).decode("utf-8", "ignore")
    except Exception:
        return "?"

roots = []
for app in ("CodeBuddyIDE", "WXIDE"):
    for uid_dir in glob.glob(P(os.path.join(BASE, "*", app, "*"))):
        h = os.path.join(uid_dir, "history")
        if os.path.isdir(h):
            roots.append((app, uid_dir, h))

print("=== history roots ===")
for app, uid_dir, h in roots:
    proj = [d for d in os.listdir(h) if os.path.isdir(os.path.join(h, d))]
    nconv = nmsg = 0
    for pd in proj:
        nconv += len(glob.glob(os.path.join(h, pd, "*", "index.json")))
        nmsg += len(glob.glob(os.path.join(h, pd, "*", "messages", "*.json")))
    print(f"{app:14s} uid={os.path.basename(uid_dir)[:8]} projects={len(proj):3d} convIndex={nconv:4d} msgFiles={nmsg:6d}  {os.path.basename(uid_dir)}")

# 全量统计 requests
stats = dict(reqs=0, no_usage=0, total=0, inp=0, out=0, cache=0, credit=0.0,
             types=collections.Counter(), credit_by_type=collections.Counter(),
             dates=[], fields=collections.Counter(), convs=0)
per_day = collections.defaultdict(lambda: dict(requests=0, totalTokens=0, credit=0.0))
per_model = collections.Counter()
model_tokens = collections.Counter()

for app, uid_dir, h in roots:
    for pd in [d for d in os.listdir(h) if os.path.isdir(os.path.join(h, d))]:
        for cidx in glob.glob(os.path.join(h, pd, "*", "index.json")):
            try:
                with open(P(cidx), encoding="utf-8-sig", errors="ignore") as f:
                    doc = json.load(f)
            except Exception as e:
                continue
            reqs = doc.get("requests") or []
            if reqs:
                stats["convs"] += 1
            for r in reqs:
                stats["reqs"] += 1
                u = r.get("usage")
                t = r.get("type", "?")
                stats["types"][t] += 1
                if not u:
                    stats["no_usage"] += 1
                    continue
                for k in u:
                    stats["fields"][k] += 1
                stats["total"] += u.get("totalTokens", 0)
                stats["inp"] += u.get("inputTokens", 0)
                stats["out"] += u.get("outputTokens", 0)
                stats["cache"] += u.get("cacheTokens", 0)
                stats["credit"] += u.get("credit", 0) or 0
                stats["credit_by_type"][t] += 1 if (u.get("credit") or 0) > 0 else 0
                ts = r.get("startedAt")
                if ts:
                    d = datetime.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                    stats["dates"].append(d)
                    per_day[d]["requests"] += 1
                    per_day[d]["totalTokens"] += u.get("totalTokens", 0)
                    per_day[d]["credit"] += u.get("credit", 0) or 0
            # 采模型：读本会话 messages 里的 extra
            mdir = os.path.join(os.path.dirname(cidx), "messages")
            if os.path.isdir(P(mdir)):
                for mf in glob.glob(os.path.join(mdir, "*.json"))[:400]:
                    try:
                        with open(P(mf), encoding="utf-8-sig", errors="ignore") as f:
                            m = json.load(f)
                        ex = m.get("extra")
                        if isinstance(ex, str):
                            ex = json.loads(ex)
                        if isinstance(ex, dict) and ex.get("modelId"):
                            key = ex.get("modelName") or ex["modelId"]
                            per_model[ex.get("modelId")] += 1
                            model_tokens[ex["modelId"]] += 0
                    except Exception:
                        pass

print("\n=== 汇总 ===")
print(f"requests={stats['reqs']}  有usage的会话数={stats['convs']}  usage缺失={stats['no_usage']}")
print(f"totalTokens={stats['total']:,}  input={stats['inp']:,}  output={stats['out']:,}  cache={stats['cache']:,}")
print(f"credit={stats['credit']:.2f}")
print(f"types={dict(stats['types'])}")
print(f"日期范围={min(stats['dates'])} ~ {max(stats['dates'])}  有数据天数={len(set(stats['dates']))}")
print(f"\nusage 字段出现次数(总{stats['reqs']-stats['no_usage']}条):")
for k, v in stats["fields"].most_common():
    print(f"  {k:20s} {v}")
print("\n模型分布(按 messages extra.modelId 采样):")
for k, v in per_model.most_common(12):
    print(f"  {k:24s} {v}")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cb_verify_out.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump({"summary": {k: (dict(v) if isinstance(v, collections.Counter) else v)
                           for k, v in stats.items() if k != "dates"},
               "model_dist": dict(per_model),
               "daily": {k: v for k, v in sorted(per_day.items())}},
              f, ensure_ascii=False, indent=1)
print("\nwritten:", out)
