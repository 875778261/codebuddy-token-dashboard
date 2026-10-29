#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WorkBuddy 本地数据源复核脚本（只读、可重跑）。

对应报告：docs/workbuddy-data-sources.md
用法：
    python docs/exploration/wb_verify.py
    python docs/exploration/wb_verify.py --json docs/exploration/wb_verify_out.json

口径（与报告 §2 一致）：
  * 一条「请求」= 会话 jsonl 里一条带 providerData.usage 的记录（type=function_call|message）
  * totalTokens / inputTokens / outputTokens 取 providerData.usage（缺失时回落 rawUsage.*_tokens）
  * 缓存命中取 inputTokensDetails[0].cached_tokens（缺失时回落 rawUsage.prompt_cache_hit_tokens）
  * 积分取 rawUsage.credit（逐请求），并用 workbuddy.db 的 session_usage.credit_json 对拍
  * 去重键 (sessionId, messageId)：同一键多条时取 timestamp 最大者（实测为重试双写）

只读：全部 open(...,'r') 与 sqlite3 mode=ro，不写任何源文件、不联网。
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

HOME = os.path.expanduser("~")
WB = os.path.join(HOME, ".workbuddy")
PROJECTS = os.path.join(WB, "projects")
DB = os.path.join(WB, "workbuddy.db")
LEGACY = os.path.join(HOME, ".workbuddy-ai")
TZ = timezone(timedelta(hours=8))


def ts2date(ms):
    return datetime.fromtimestamp(ms / 1000, TZ).strftime("%Y-%m-%d")


def iter_jsonl(root):
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in sorted(filenames):
            if not fn.endswith(".jsonl"):
                continue
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, root).replace("\\", "/")
            is_sub = "subagents" in rel.split("/")
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for lineno, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield path, rel, is_sub, lineno, json.loads(line)
                    except Exception:
                        yield path, rel, is_sub, lineno, None


def ro(path):
    con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    con.row_factory = sqlite3.Row
    return con


def pick(rec):
    """从一条记录里抽出用量；不构成请求时返回 None。"""
    pd = rec.get("providerData")
    if not isinstance(pd, dict):
        return None
    u = pd.get("usage")
    if not isinstance(u, dict):
        return None
    ru = pd.get("rawUsage") if isinstance(pd.get("rawUsage"), dict) else {}
    # usage 是全零时（实测 1 例：custom-local 模型协议未归一化）整组回落到 rawUsage，保证三字段同源
    if u.get("totalTokens"):
        total = u["totalTokens"]
        inp = u.get("inputTokens") or 0
        out = u.get("outputTokens") or 0
        det = u.get("inputTokensDetails") or [{}]
        hit = (det[0] or {}).get("cached_tokens") if isinstance(det, list) and det else None
        if hit is None:
            hit = ru.get("prompt_cache_hit_tokens") or 0
    else:
        total = ru.get("total_tokens") or 0
        inp = ru.get("prompt_tokens") or 0
        out = ru.get("completion_tokens") or 0
        hit = ru.get("prompt_cache_hit_tokens")
        if hit is None:
            hit = (ru.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
    odet = u.get("outputTokensDetails") or [{}]
    think = (odet[0] or {}).get("reasoning_tokens") if isinstance(odet, list) and odet else 0
    if not think and ru.get("completion_thinking_tokens") is not None:
        think = ru["completion_thinking_tokens"]
    credit = ru.get("credit")
    return {
        "total": int(total), "in": int(inp), "out": int(out),
        "hit": int(hit or 0), "miss": int(inp) - int(hit or 0),
        "think": int(think or 0),
        "credit": float(credit) if credit is not None else None,
        "model": pd.get("model") or pd.get("requestModelId") or "<none>",
        "modelReq": pd.get("requestModelId") or pd.get("model") or "<none>",
        "sid": rec.get("sessionId"),
        "mid": pd.get("messageId"),
        "turn": pd.get("conversationRequestId"),
        "cwd": rec.get("cwd") or "",
        "ts": rec.get("timestamp"),
        "type": rec.get("type"),
        "subAgent": bool(pd.get("isSubAgent")),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="结构化结果输出路径")
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()

    print("WorkBuddy 数据源复核 · %s" % datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S"))

    if not os.path.isdir(PROJECTS):
        print("!! 未找到 %s" % PROJECTS)
        return 2

    # ---------- 1. 目录 ----------
    projects = [d for d in sorted(os.listdir(PROJECTS)) if os.path.isdir(os.path.join(PROJECTS, d))]
    main_files, sub_files, meta_files, ndjson_files = [], [], [], []
    for d in projects:
        full = os.path.join(PROJECTS, d)
        for name in os.listdir(full):
            p = os.path.join(full, name)
            if os.path.isdir(p):
                for dp, _dn, fns in os.walk(p):
                    for fn in fns:
                        if fn.endswith(".jsonl"):
                            (sub_files if "subagents" in dp.split(os.sep) else main_files).append(os.path.join(dp, fn))
            elif name.endswith(".jsonl"):
                main_files.append(p)
            elif name.endswith(".meta.json"):
                meta_files.append(p)
            elif name.endswith(".ndjson"):
                ndjson_files.append(p)
    size_main = sum(os.path.getsize(p) for p in main_files)
    size_sub = sum(os.path.getsize(p) for p in sub_files)
    print("\n[1] 目录（%s）" % PROJECTS)
    print("    项目（一级子目录）      : %d" % len(projects))
    print("    主会话 jsonl            : %d  (%.1f MB)" % (len(main_files), size_main / 1048576))
    print("    subagents jsonl         : %d  (%.1f MB)" % (len(sub_files), size_sub / 1048576))
    print("    *.meta.json / *.ndjson  : %d / %d" % (len(meta_files), len(ndjson_files)))

    # ---------- 2. 逐条解析 ----------
    types = Counter()
    rows = []
    raw_by_key = {}
    bad_lines = 0
    for path, rel, is_sub, lineno, rec in iter_jsonl(PROJECTS):
        if rec is None:
            bad_lines += 1
            continue
        types[rec.get("type")] += 1
        r = pick(rec)
        if not r:
            continue
        r["file"] = rel
        r["subFile"] = is_sub
        key = (r["sid"], r["mid"])
        prev = raw_by_key.get(key)
        if prev is None or (r["ts"] or 0) > (prev["ts"] or 0):
            raw_by_key[key] = r

    rows = list(raw_by_key.values())

    # ---------- 3. 聚合 ----------
    tot = Counter()
    per_day = defaultdict(Counter)
    per_session = defaultdict(Counter)
    per_project = defaultdict(Counter)
    per_model = Counter()
    per_model_tokens = Counter()
    per_turn = defaultdict(float)
    credit_missing = 0
    first_ts = last_ts = None
    for r in rows:
        ts = r["ts"]
        if not ts:
            continue
        first_ts = ts if first_ts is None else min(first_ts, ts)
        last_ts = ts if last_ts is None else max(last_ts, ts)
        day = ts2date(ts)
        sid = r["sid"] or "<none>"
        proj = r["cwd"] or "<none>"
        for bucket in (tot, per_day[day], per_session[sid], per_project[proj]):
            bucket["req"] += 1
            bucket["total"] += r["total"]
            bucket["in"] += r["in"]
            bucket["out"] += r["out"]
            bucket["hit"] += r["hit"]
            bucket["miss"] += r["miss"]
            bucket["think"] += r["think"]
            if r["credit"] is not None:
                bucket["credit"] += r["credit"]
                bucket["req_with_credit"] += 1
        if r["credit"] is None:
            credit_missing += 1
        else:
            per_turn[r["turn"]] += r["credit"]
        per_model[r["model"]] += 1
        per_model_tokens[r["model"]] += r["total"]

    print("\n[2] 汇总（已按 session+messageId 去重）")
    print("    请求数                  : %d" % tot["req"])
    print("    会话 / 项目             : %d / %d" % (len(per_session), len(per_project)))
    print("    累计 totalTokens        : %s" % f"{tot['total']:,}")
    print("    inputTokens             : %s" % f"{tot['in']:,}")
    print("    outputTokens            : %s" % f"{tot['out']:,}")
    print("      └ reasoning           : %s" % f"{tot['think']:,}")
    print("    cache hit / miss        : %s / %s  (命中率 %.1f%%)" % (
        f"{tot['hit']:,}", f"{tot['miss']:,}", 100.0 * tot["hit"] / tot["in"] if tot["in"] else 0))
    print("    积分（原始）            : %.2f（覆盖 %d/%d 请求）" % (
        tot["credit"], tot["req_with_credit"], tot["req"]))
    print("    时间范围                : %s ~ %s（%d 天有数据）" % (
        ts2date(first_ts), ts2date(last_ts), len(per_day)))

    # ---------- 4. 自检 ----------
    n_all = 0
    n_bad_total = 0
    n_cached_gt_input = 0
    n_requests_ne_1 = 0
    n_credit_null = 0
    no_sid = no_ts = 0
    dup_records = 0
    seen = defaultdict(int)
    for path, rel, is_sub, lineno, rec in iter_jsonl(PROJECTS):
        if rec is None:
            continue
        r = pick(rec)
        if not r:
            continue
        n_all += 1
        u = rec["providerData"]["usage"]
        if u.get("requests") not in (1, None):
            n_requests_ne_1 += 1
        if r["total"] and r["total"] != r["in"] + r["out"]:
            n_bad_total += 1
        if r["hit"] > r["in"]:
            n_cached_gt_input += 1
        if r["credit"] is None:
            n_credit_null += 1
        if not r["sid"]:
            no_sid += 1
        if not r["ts"]:
            no_ts += 1
        seen[(r["sid"], r["mid"])] += 1
    dup_records = sum(v - 1 for v in seen.values() if v > 1)

    print("\n[3] 自检（全量 %d 条）" % n_all)
    print("    totalTokens == input+output : %d/%d" % (n_all - n_bad_total, n_all))
    print("    cached <= input             : %d/%d" % (n_all - n_cached_gt_input, n_all))
    print("    usage.requests == 1         : %s" % ("全部为 1" if n_requests_ne_1 == 0 else "反例 %d" % n_requests_ne_1))
    print("    (session,messageId) 重复    : %d 组 / %d 条冗余" % (
        sum(1 for v in seen.values() if v > 1), dup_records))
    print("    缺 sessionId / timestamp    : %d / %d" % (no_sid, no_ts))
    print("    缺 credit                   : %d" % n_credit_null)
    print("    解析失败行                  : %d" % bad_lines)

    # ---------- 5. workbuddy.db ----------
    db = {}
    credit_json_total = 0.0
    credit_json_turns = 0
    db_sessions = {}
    if os.path.exists(DB):
        con = ro(DB)
        cur = con.cursor()
        db_sessions = {r["id"]: dict(r) for r in cur.execute(
            "select id,cwd,title,custom_title,status,model,mode,created_at,deleted_at from sessions")}
        used_rows = {}
        db_turns = {}
        for r in cur.execute("select session_id,used,size,credit_json from session_usage"):
            used_rows[r["session_id"]] = (r["used"], r["size"])
            if r["credit_json"]:
                try:
                    d = json.loads(r["credit_json"])
                except Exception:
                    d = {}
                for k, v in d.items():
                    db_turns[k] = float(v)
        con.close()
        credit_json_total = sum(db_turns.values())
        credit_json_turns = len(db_turns)

        jsonl_sids = {r["sid"] for r in rows if r["sid"]}
        matched = jsonl_sids & set(db_sessions)
        db.update({
            "sessions": len(db_sessions),
            "deleted": sum(1 for v in db_sessions.values() if v["deleted_at"]),
            "withCwd": sum(1 for v in db_sessions.values() if v["cwd"]),
            "withTitle": sum(1 for v in db_sessions.values() if v["title"] or v["custom_title"]),
            "sessionUsage": len(used_rows),
            "jsonlSessions": len(jsonl_sids),
            "matched": len(matched),
            "jsonlOnly": len(jsonl_sids) - len(matched),
            "dbOnly": len(db_sessions) - len(matched),
            "creditJsonTurns": credit_json_turns,
            "creditJsonSum": round(credit_json_total, 4),
        })
        print("\n[4] 与 workbuddy.db 对拍")
        print("    sessions 表                 : %d 行（deleted %d / 有 cwd %d / 有 title %d）"
              % (db["sessions"], db["deleted"], db["withCwd"], db["withTitle"]))
        print("    session_usage 表            : %d 行" % db["sessionUsage"])
        print("    jsonl 会话 ↔ sessions       : %d vs %d，命中 %d，仅 jsonl %d（多为 subagent 会话），仅 db %d"
              % (db["jsonlSessions"], db["sessions"], db["matched"], db["jsonlOnly"], db["dbOnly"]))

        # credit 两路对拍
        both = set(db_turns) & set(per_turn)
        eq = sum(1 for k in both if abs(db_turns[k] - per_turn[k]) < 1e-6)
        print("\n[5] 积分两路对拍")
        print("    Σ rawUsage.credit（jsonl）  : %.2f（%d 个 turn）" % (sum(per_turn.values()), len(per_turn)))
        print("    Σ credit_json（workbuddy.db）: %.2f（%d 个 turn）" % (credit_json_total, credit_json_turns))
        print("    共有 turn %d，逐条完全相等 %d（%.1f%%）" % (
            len(both), eq, 100.0 * eq / len(both) if both else 0))
        db["creditTurnOverlap"] = len(both)
        db["creditTurnEqual"] = eq

        # 交叉验证：session_usage.used == 末轮 inputTokens
        last_input = {}
        for r in rows:
            if not r["sid"] or not r["ts"]:
                continue
            p = last_input.get(r["sid"])
            if p is None or r["ts"] >= p[0]:
                last_input[r["sid"]] = (r["ts"], r["in"])
        pairs = [(last_input[s][1], used_rows[s][0]) for s in last_input if s in used_rows]
        exact = sum(1 for a, b in pairs if a == b)
        print("\n[6] 独立交叉验证：session_usage.used 是否等于该会话末轮 inputTokens")
        print("    可比会话 %d，完全相等 %d（%.1f%%）" % (
            len(pairs), exact, 100.0 * exact / len(pairs) if pairs else 0))
        db["usedVsLastInput"] = {"pairs": len(pairs), "exact": exact}

    # ---------- 7. 榜单 ----------
    def top(d, k, n, fmt):
        out = sorted(d.items(), key=lambda kv: kv[1][k], reverse=True)[:n]
        for name, c in out:
            print(fmt(name, c))

    print("\n[7] Top %d 项目（按 totalTokens）" % args.top)
    top(per_project, "total", args.top,
        lambda n, c: "    %-46s %14s tokens  %6d 请求" % (n[:46], f"{c['total']:,}", c["req"]))

    print("\n[8] Top %d 会话（按 totalTokens）" % args.top)
    sess_sorted = sorted(per_session.items(), key=lambda kv: kv[1]["total"], reverse=True)[:args.top]
    for sid, c in sess_sorted:
        s = db_sessions.get(sid) or {}
        title = (s.get("custom_title") or s.get("title") or "")[:26]
        print("    %s  %14s tokens  %5d 请求  %-26s" % (
            sid[:8], f"{c['total']:,}", c["req"], title))

    print("\n[9] 模型分布")
    for m, c in per_model.most_common(args.top):
        print("    %-32s %6d 请求  %14s tokens" % (m, c, f"{per_model_tokens[m]:,}"))

    print("\n[10] 按天（最近 12 天）")
    for day in sorted(per_day)[-12:]:
        c = per_day[day]
        print("    %s  %5d 请求  %14s tokens  cache %.1f%%  credit %.2f"
              % (day, c["req"], f"{c['total']:,}", 100.0 * c["hit"] / c["in"] if c["in"] else 0, c["credit"]))

    # 覆盖率：区间内缺失天（含首尾）
    d0 = datetime.fromtimestamp(first_ts / 1000, TZ).date()
    d1 = datetime.fromtimestamp(last_ts / 1000, TZ).date()
    days_in_range = (d1 - d0).days + 1
    missing_days = sorted(
        (d0 + timedelta(days=i)).isoformat() for i in range(days_in_range)
        if (d0 + timedelta(days=i)).isoformat() not in per_day
    )
    print("\n[11] 覆盖")
    print("    区间 %s ~ %s 共 %d 天，有数据 %d 天，缺失 %d 天"
          % (ts2date(first_ts), ts2date(last_ts), days_in_range, len(per_day), len(missing_days)))
    print("    缺失日期: %s" % ("、".join(missing_days) if missing_days else "无"))

    if args.json:
        data = {
            "generatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
            "root": PROJECTS,
            "layout": {
                "projects": len(projects), "mainJsonl": len(main_files), "subJsonl": len(sub_files),
                "mainBytes": size_main, "subBytes": size_sub,
            },
            "totals": {
                "requests": tot["req"], "sessions": len(per_session), "projects": len(per_project),
                "totalTokens": tot["total"], "inputTokens": tot["in"], "outputTokens": tot["out"],
                "cacheHitTokens": tot["hit"], "cacheMissTokens": tot["miss"],
                "reasoningTokens": tot["think"], "credit": round(tot["credit"], 4),
                "requestsWithCredit": tot["req_with_credit"],
                "first": ts2date(first_ts), "last": ts2date(last_ts), "daysWithData": len(per_day),
            },
            "selfCheck": {
                "records": n_all, "totalEqInPlusOut": n_all - n_bad_total,
                "cachedLeInput": n_all - n_cached_gt_input,
                "dupGroups": sum(1 for v in seen.values() if v > 1), "dupRecords": dup_records,
                "missingCredit": n_credit_null, "badLines": bad_lines,
            },
            "db": db,
            "models": dict(per_model.most_common()),
            "modelTokens": dict(per_model_tokens.most_common()),
            "daily": {d: dict(c) for d, c in sorted(per_day.items())},
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("\n结构化结果已写入 %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
