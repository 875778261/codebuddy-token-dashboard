import json, os, re, glob, collections

LOG_RE = re.compile(
    r'^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?\[BaseAgent:(?P<mode>\w+)\]\s+\[(?P<rid>[0-9a-f]{32})\]\s+notifyStepEnd, step:\s*(?P<step>\d+).*?usage:\s*(?P<u>\{.*?\}),\s*isMaxTokenLimit'
)

L = r"C:\Users\HUAWEI\AppData\Roaming\CodeBuddy CN\logs"
steps = collections.defaultdict(list)
files = 0
for f in glob.glob(os.path.join(L, "*", "window*", "exthost", "Tencent-Cloud.coding-copilot", "*.log")):
    files += 1
    with open(f, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            m = LOG_RE.match(line)
            if not m:
                continue
            try:
                u = json.loads(m.group("u"))
            except Exception:
                continue
            steps[m.group("rid")].append(dict(step=int(m.group("step")), ts=m.group("ts"), mode=m.group("mode"),
                                              **{k: u.get(k) for k in ("inputTokens", "outputTokens", "totalTokens",
                                                                       "cacheTokens", "credit", "thinkingTokens")}))

print(f"日志文件 {files} 个，聚合到 requestId {len(steps)} 个")
tot_step_tokens = sum(s["totalTokens"] for v in steps.values() for s in v)
print(f"step 级 totalTokens 合计 = {tot_step_tokens:,}")

# 对照 history
H = r"C:\Users\HUAWEI\AppData\Local\CodeBuddyExtension\Data\fdb42935-f98d-45a6-9cda-8be6bff04c36\CodeBuddyIDE\fdb42935-f98d-45a6-9cda-8be6bff04c36\history"
def P(p):
    p = os.path.abspath(p)
    return p if p.startswith("\\\\?\\") else "\\\\?\\" + p

hist = {}
for cidx in glob.glob(os.path.join(H, "*", "*", "index.json")):
    try:
        with open(P(cidx), encoding="utf-8-sig", errors="ignore") as fh:
            doc = json.load(fh)
    except Exception:
        continue
    for r in doc.get("requests") or []:
        if r.get("usage"):
            hist[r["id"]] = r

matched = [rid for rid in steps if rid in hist]
print(f"\n能在 history 中对上的 requestId: {len(matched)} / {len(steps)}")
print(f"{'requestId':34s} {'steps':>5} {'log_tokens':>12} {'hist_total':>12} {'差%':>7} {'log_credit':>10} {'hist_credit':>11}")
for rid in matched[:8]:
    ls = steps[rid]
    lt = sum(s["totalTokens"] for s in ls)
    lc = sum(s["credit"] or 0 for s in ls)
    h = hist[rid]["usage"]
    print(f"{rid:34s} {len(ls):>5} {lt:>12,} {h['totalTokens']:>12,} "
          f"{(lt - h['totalTokens']) / max(h['totalTokens'],1) * 100:>6.1f}% {lc:>10.2f} {h['credit']:>11.2f}")
