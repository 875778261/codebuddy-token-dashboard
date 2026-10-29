"""独立实现（Python）的用量真值，用来反向校验浏览器端 TS 管线。

刻意不复用 docs/exploration/cb_verify.py 的写法：这里按"采集契约"重新聚合一遍，
输出 JSON 供 `npm run verify` 与 TS 结果逐字段比对。任何字段不一致都说明 TS 解析器有 bug。
"""

import glob
import json
import os
import sqlite3
import sys
from collections import Counter

DATA = os.environ.get("CB_DATA") or os.path.expandvars(
    r"%LOCALAPPDATA%\CodeBuddyExtension\Data"
)
SESSIONS_DB = os.environ.get("CB_SESSIONS_DB") or os.path.expandvars(
    r"%APPDATA%\CodeBuddy CN\codebuddy-sessions.vscdb"
)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tmp-py-out.json")


def P(p: str) -> str:
    p = os.path.abspath(p)
    if os.name != "nt" or p.startswith("\\\\?\\"):
        return p
    return "\\\\?\\" + p


def collect_indexes():
    out = []
    for path in glob.glob(P(os.path.join(DATA, "**", "index.json")), recursive=True):
        parts = path.replace("\\\\?\\", "").replace("\\", "/").split("/")
        if "history" not in parts:
            continue
        out.append((parts, path))
    return out


def load_session_meta():
    meta = {}
    if not os.path.exists(SESSIONS_DB):
        return meta
    con = sqlite3.connect("file:" + SESSIONS_DB.replace("\\", "/") + "?mode=ro", uri=True)
    for (value,) in con.execute(
        "select value from ItemTable where key like 'session:%'"
    ):
        if isinstance(value, bytes):
            value = value.decode("utf-8", "ignore")
        try:
            item = json.loads(value)
        except Exception:
            continue
        meta[item["conversationId"]] = item
    con.close()
    return meta


def main():
    files = collect_indexes()
    project_meta = {}
    convs = {}
    parse_errors = 0
    for parts, path in files:
        try:
            with open(path, encoding="utf-8-sig", errors="ignore") as f:
                doc = json.load(f)
        except Exception:
            parse_errors += 1
            continue
        hidx = parts.index("history")
        if isinstance(doc.get("conversations"), list):
            for c in doc["conversations"]:
                if c.get("id"):
                    project_meta[c["id"]] = c
        elif isinstance(doc.get("requests"), list):
            pid = parts[hidx + 1]
            cid = parts[hidx + 2] if len(parts) > hidx + 3 else parts[-2]
            convs[(pid, cid)] = doc

    meta = load_session_meta()
    sessions = []
    req_total = req_usage = in_flight = 0
    eq1 = eq2 = eq1_fail = eq2_fail = 0
    for (pid, cid), doc in convs.items():
        reqs = []
        for r in doc["requests"]:
            req_total += 1
            u = r.get("usage")
            ts = r.get("startedAt")
            if not u or not ts:
                in_flight += 1
                continue
            req_usage += 1
            i, o, t = u["inputTokens"], u["outputTokens"], u["totalTokens"]
            c, cm, cw = u["cacheTokens"], u["cachedMissTokens"], u.get("cachedWriteTokens", 0)
            if i == c + cm + cw or i == c + cm:
                eq1 += 1
            else:
                eq1_fail += 1
            if t == i + o:
                eq2 += 1
            else:
                eq2_fail += 1
            reqs.append(
                dict(
                    ts=ts,
                    type=r.get("type"),
                    input=i,
                    output=o,
                    total=t,
                    cache=c,
                    cacheMiss=cm,
                    cacheWrite=cw,
                    credit=u.get("credit") or 0,
                    lastTokens=u.get("lastTokens") or 0,
                )
            )
        if not reqs:
            continue
        reqs.sort(key=lambda x: x["ts"])
        pm = project_meta.get(cid, {})
        sm = meta.get(cid, {})
        agg = {
            "requestCount": len(reqs),
            "total": sum(x["total"] for x in reqs),
            "input": sum(x["input"] for x in reqs),
            "output": sum(x["output"] for x in reqs),
            "cache": sum(x["cache"] for x in reqs),
            "cacheMiss": sum(x["cacheMiss"] for x in reqs),
            "credit": round(sum(x["credit"] for x in reqs), 2),
        }
        sessions.append(
            {
                "id": cid,
                "projectId": pid,
                "modelId": pm.get("selectedModelId"),
                "title": sm.get("title") or pm.get("name") or None,
                "cwd": sm.get("cwd"),
                "status": sm.get("status"),
                "requests": reqs,
                **agg,
            }
        )

    daily = {}
    for s in sessions:
        for r in s["requests"]:
            import datetime

            k = datetime.datetime.fromtimestamp(r["ts"] / 1000).strftime("%Y-%m-%d")
            d = daily.setdefault(k, {"total": 0, "requests": 0, "credit": 0.0})
            d["total"] += r["total"]
            d["requests"] += 1
            d["credit"] += r["credit"]

    summary = {
        "sessionCount": len(sessions),
        "requestsTotal": req_total,
        "requestsWithUsage": req_usage,
        "inFlightSkipped": in_flight,
        "total": sum(s["total"] for s in sessions),
        "input": sum(s["input"] for s in sessions),
        "output": sum(s["output"] for s in sessions),
        "cache": sum(s["cache"] for s in sessions),
        "cacheMiss": sum(s["cacheMiss"] for s in sessions),
        "credit": round(sum(s["credit"] for s in sessions), 2),
        "identityInput": {"ok": eq1, "fail": eq1_fail},
        "identityTotal": {"ok": eq2, "fail": eq2_fail},
        "parseErrors": parse_errors,
        "sessionsWithoutCwd": sum(1 for s in sessions if not s["cwd"]),
        "sessionsWithoutModel": sum(1 for s in sessions if not s["modelId"]),
        "typeCounts": dict(Counter(r["type"] for s in sessions for r in s["requests"])),
    }

    payload = {
        "summary": summary,
        "daily": dict(sorted(daily.items())),
        "sessions": [
            {
                "id": s["id"],
                "projectId": s["projectId"],
                "modelId": s["modelId"],
                "title": s["title"],
                "cwd": s["cwd"],
                "total": s["total"],
                "requestCount": s["requestCount"],
                "credit": s["credit"],
                "requests": s["requests"],
            }
            for s in sessions
        ],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print("python ground truth ->", os.path.abspath(OUT))
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
