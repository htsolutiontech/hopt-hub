#!/usr/bin/env python3
"""HOPT Hub – đồng bộ một lệnh: export Hub (thô) -> chuẩn hóa -> mã hóa -> data/runs.json + data/status.json.

python3 tools/hopt_sync.py EXPORT.json [--repo .] [--force] [--dry-run]

EXPORT.json (để NGOÀI repo, không commit) nhận một trong các dạng:
  - {"runs":[{agent,kind,date,...}, ...]}
  - [{"id":..,"data":{...}}, ...]           (nguyên các document từ db_list)
  - {"docs":[{"id":..,"data":{...}}, ...]}
Trường *_en (bản dịch) nếu có sẽ được giữ nguyên.

Mã thoát: 0 = đã ghi file mới (cần commit) · 3 = không có thay đổi (bỏ qua commit) · khác = lỗi (KHÔNG commit).
"""
import argparse, datetime, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hopt_encrypt  # noqa: E402

GROUPS = hopt_encrypt.GROUPS
KEEP = ["id", "agent", "kind", "date", "period", "period_en", "status", "finishedAt", "emailSent", "attachments",
        "highlights", "highlights_en", "kpis", "recos", "note", "note_en"]
MAX_RUNS = 400
STALE_H = 24


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def load_export(path):
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("runs"), list):
        items = raw["runs"]
    elif isinstance(raw, dict) and isinstance(raw.get("docs"), list):
        items = raw["docs"]
    elif isinstance(raw, list):
        items = raw
    else:
        sys.exit("LỖI: EXPORT.json không đúng định dạng (cần runs[] hoặc danh sách document).")
    runs = []
    for it in items:
        if not isinstance(it, dict):
            continue
        rec = dict(it["data"]) if isinstance(it.get("data"), dict) else dict(it)
        if "id" in it and "id" not in rec:
            rec["id"] = it["id"]
        if rec.get("agent") not in GROUPS:
            continue
        runs.append({k: rec[k] for k in KEEP if k in rec})
    # khử trùng theo id (giữ bản finishedAt mới nhất)
    best = {}
    for r in runs:
        key = r.get("id") or f'{r.get("agent")}-{r.get("date")}-{r.get("kind")}'
        if key not in best or str(r.get("finishedAt", "")) > str(best[key].get("finishedAt", "")):
            best[key] = r
    out = sorted(best.values(), key=lambda r: str(r.get("finishedAt", "")), reverse=True)[:MAX_RUNS]
    return out, len(items)


def build_status(runs, updated_at):
    groups = {}
    for g in GROUPS:
        rs = [r for r in runs if r["agent"] == g]
        if not rs:
            groups[g] = {"count": 0}
            continue
        last = rs[0]
        groups[g] = {"count": len(rs), "lastDate": last.get("date"), "lastFinishedAt": last.get("finishedAt"),
                     "lastStatus": last.get("status")}
    latest = max((str(r.get("finishedAt", "")) for r in runs), default="")
    return {"version": 1, "source": "HOPT Intelligence Hub", "updatedAt": updated_at,
            "latestFinishedAt": latest or None, "total": len(runs), "groups": groups}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export"); ap.add_argument("--repo", default=".")
    ap.add_argument("--force", action="store_true", help="ghi lại kể cả khi không có lượt mới")
    ap.add_argument("--dry-run", action="store_true", help="chỉ in kết quả so sánh, không ghi file")
    a = ap.parse_args()

    repo = os.path.abspath(a.repo)
    exp = os.path.abspath(a.export)
    if exp.startswith(repo + os.sep):
        sys.exit("LỖI: EXPORT.json nằm trong repo – phải đặt ngoài repo (vd. /tmp/hopt_plain/).")
    keys_p, runs_p, status_p = (os.path.join(repo, p) for p in ("keys.json", "data/runs.json", "data/status.json"))
    if not os.path.exists(keys_p):
        sys.exit("LỖI: thiếu keys.json trong repo.")

    runs, n_src = load_export(exp)
    if not runs:
        sys.exit(f"LỖI: export có 0 lượt hợp lệ ({n_src} bản ghi gốc) – không ghi đè dữ liệu cũ.")
    latest = max(str(r.get("finishedAt", "")) for r in runs)

    old = {}
    if os.path.exists(status_p):
        try: old = json.load(open(status_p, encoding="utf-8"))
        except Exception: old = {}
    old_latest = str(old.get("latestFinishedAt") or "")
    old_upd = parse_iso(old.get("updatedAt") or "")
    stale = old_upd is None or (now_utc() - old_upd).total_seconds() > STALE_H * 3600
    changed = latest > old_latest or old.get("total") != len(runs)
    summary = {"hubRuns": len(runs), "hubLatest": latest, "repoLatest": old_latest or None,
               "changed": changed, "repoStale": stale}
    if a.dry_run:
        print(json.dumps(summary, ensure_ascii=False)); sys.exit(0 if (changed or stale or a.force) else 3)
    if not (changed or stale or a.force):
        print(json.dumps({**summary, "action": "skip"}, ensure_ascii=False)); sys.exit(3)

    tmp_dir = os.path.join(os.path.dirname(exp), ".hopt_sync_tmp"); os.makedirs(tmp_dir, exist_ok=True)
    plain_p = os.path.join(tmp_dir, "plain.json")
    json.dump({"runs": runs}, open(plain_p, "w", encoding="utf-8"), ensure_ascii=False)
    try:
        hopt_encrypt.main(plain_p, keys_p, runs_p)
    finally:
        os.remove(plain_p)
        try: os.rmdir(tmp_dir)
        except OSError: pass

    enc = json.load(open(runs_p, encoding="utf-8"))
    if enc.get("encrypted") is not True:
        sys.exit("LỖI: runs.json không ở trạng thái mã hóa.")
    status = build_status(runs, enc["updatedAt"])
    json.dump(status, open(status_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # tự kiểm tra: không có văn bản gốc nào trong 2 file sẽ commit
    blob = open(runs_p, encoding="utf-8").read() + open(status_p, encoding="utf-8").read()
    for r in runs:
        for f in ("highlights", "highlights_en"):
            for h in (r.get(f) or [])[:3]:
                if isinstance(h, str) and len(h) > 12 and h in blob:
                    sys.exit("LỖI: phát hiện văn bản gốc trong file xuất – dừng, KHÔNG commit.")
        for f in ("note", "note_en"):
            v = r.get(f)
            if isinstance(v, str) and len(v) > 12 and v in blob:
                sys.exit("LỖI: phát hiện ghi chú gốc trong file xuất – dừng, KHÔNG commit.")
    print(json.dumps({**summary, "action": "written", "updatedAt": enc["updatedAt"],
                      "groups": {g: v["count"] for g, v in status["groups"].items()}}, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
