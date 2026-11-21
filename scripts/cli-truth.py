"""CodeBuddy CLI 用量的独立实现（Python），用来反向校验 TS 解析器。

刻意不复用 src/core/cliParse.ts：这里按"采集契约"重新读一遍日志，
输出 JSON 供 `npm run verify:cli` 逐字段比对。任何字段不一致都说明 TS 解析器有 bug。

契约（docs/codebuddy-cli-data-sources.md）：
- 一条 `agent.model_call.completed` = 一次请求（= 一次真实 API 调用）
- 一次用户 turn 可含多条请求；`conversation_request_id` 只是分组键
- 积分行同一份值写两遍（raw_model_stream_event / response_done），只取前者；
  组内按时间排序后「第 i 条 credit 配第 i 次调用」
- 项目取自每份 .log 的首行 `Workspace Path:`
"""

import glob
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime

ROOT = os.environ.get("CB_CLI_HOME") or os.path.expandvars(r"%USERPROFILE%\.codebuddy")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".tmp-cli-py.json")

TS_RE = re.compile(r"^\[(\d{4})/(\d{2})/(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]")
WS_RE = re.compile(r"^Workspace Path:\s*(.+)$")
CREDIT_RE = re.compile(r"Credit received:\s*rootRequestId=([^,\s]+),\s*source=([a-z_]+),\s*credit=([0-9.]+)")


def ts_of(line):
    m = TS_RE.match(line)
    if not m:
        return None
    y, mo, d, h, mi, s, ms = (int(x) for x in m.groups())
    return datetime(y, mo, d, h, mi, s, ms * 1000).timestamp() * 1000


def main():
    logs = glob.glob(os.path.join(ROOT, "logs", "*", "*.log"))
    calls = {}
    credits = []
    seq = 0
    parse_errors = 0
    duplicated = 0
    files_hit = 0

    for path in logs:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError:
            parse_errors += 1
            continue
        cwd = None
        hit = False
        for line in text.split("\n"):
            if not line:
                continue
            if cwd is None:
                m = WS_RE.match(line.strip())
                if m:
                    cwd = m.group(1).strip()
            if "Credit received" in line:
                m = CREDIT_RE.search(line)
                if m:
                    credits.append(
                        {"rid": m.group(1), "credit": float(m.group(3)), "ts": ts_of(line), "source": m.group(2), "seq": seq}
                    )
                    seq += 1
                continue
            if "agent.model_call.completed" not in line:
                continue
            brace = line.find('{"')
            if brace < 0:
                continue
            try:
                rec = json.loads(line[brace:])
            except json.JSONDecodeError:
                parse_errors += 1
                continue
            ts = ts_of(line)
            sid = rec.get("conversation_id")
            if not ts or not sid:
                continue
            hit = True
            key = rec.get("event_id") or rec.get("conversation_message_id")
            call = {
                "key": key,
                "ts": ts,
                "sid": sid,
                "rid": rec.get("conversation_request_id") or sid,
                "model": rec.get("model"),
                "input": rec.get("input_tokens") or 0,
                "output": rec.get("output_tokens") or 0,
                "total": rec.get("total_tokens") or 0,
                "cache": min(rec.get("cached_read_tokens") or 0, rec.get("input_tokens") or 0),
                "cwd": cwd,
                "credit": None,
            }
            prev = calls.get(key)
            if prev is not None:
                duplicated += 1
                if call["ts"] >= prev["ts"]:
                    calls[key] = call
            else:
                calls[key] = call
        if hit:
            files_hit += 1

    # 积分配对：同一 rootRequestId 内第 i 条 credit 配第 i 次调用
    by_req = {}
    for c in credits:
        by_req.setdefault(c["rid"], []).append(c)
    call_by_req = {}
    for call in calls.values():
        call_by_req.setdefault(call["rid"], []).append(call)
    unpaired = 0
    without_credit = 0
    for rid, group in call_by_req.items():
        group.sort(key=lambda c: c["ts"])
        raw = by_req.get(rid, [])
        preferred = [c for c in raw if c["source"] == "raw_model_stream_event"]
        chosen = preferred or raw
        chosen.sort(key=lambda c: (c["ts"] if c["ts"] is not None else 0, c["seq"]))
        seen = set()
        unique = []
        for c in chosen:
            sig = (c["ts"], c["credit"])
            if sig in seen:
                continue
            seen.add(sig)
            unique.append(c)
        for i, call in enumerate(group):
            if i < len(unique):
                call["credit"] = unique[i]["credit"]
            else:
                without_credit += 1
        if len(unique) > len(group):
            unpaired += len(unique) - len(group)
    for rid, group in by_req.items():
        if rid not in call_by_req:
            unpaired += len([c for c in group if c["source"] == "raw_model_stream_event"])

    sessions = {}
    for call in calls.values():
        item = sessions.setdefault(call["sid"], {"requests": 0, "total": 0, "input": 0, "output": 0, "cache": 0, "credit": 0.0})
        item["requests"] += 1
        item["total"] += call["total"]
        item["input"] += call["input"]
        item["output"] += call["output"]
        item["cache"] += call["cache"]
        item["credit"] = round(item["credit"] + (call["credit"] or 0.0), 6)

    days = Counter()
    for call in calls.values():
        day = datetime.fromtimestamp(call["ts"] / 1000).strftime("%Y-%m-%d")
        days[day] += call["total"]

    out = {
        "logFiles": len(logs),
        "logFilesHit": files_hit,
        "requests": len(calls),
        "sessions": len(sessions),
        "total": sum(c["total"] for c in calls.values()),
        "input": sum(c["input"] for c in calls.values()),
        "output": sum(c["output"] for c in calls.values()),
        "cache": sum(c["cache"] for c in calls.values()),
        "credit": round(sum((c["credit"] or 0) for c in calls.values()), 6),
        "creditKnown": sum(1 for c in calls.values() if c["credit"] is not None),
        "withoutCredit": without_credit,
        "creditUnpaired": unpaired,
        "duplicates": duplicated,
        "parseErrors": parse_errors,
        "perSession": {k: v for k, v in sorted(sessions.items())},
        "perDay": {k: v for k, v in sorted(days.items())},
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"PY: {out['requests']} 请求 / {out['total']} token / {out['sessions']} 会话 / 积分 {out['credit']}")


if __name__ == "__main__":
    if not os.path.isdir(ROOT):
        print(f"CLI 数据根不存在：{ROOT}", file=sys.stderr)
        sys.exit(1)
    main()
