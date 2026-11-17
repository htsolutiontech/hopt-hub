#!/usr/bin/env python3
"""HOPT Hub – kiểm tra an toàn & độ tươi dữ liệu (dùng trong GitHub Actions hoặc chạy tay).

python3 tools/hopt_guard.py safety      # data/runs.json phải mã hóa, status.json không chứa nội dung
python3 tools/hopt_guard.py freshness   # lỗi nếu lượt mới nhất cũ hơn ngày làm việc dự kiến
"""
import datetime, json, sys

VN = datetime.timedelta(hours=7)
ALLOWED_STATUS_KEYS = {"version", "source", "updatedAt", "latestFinishedAt", "total", "groups"}
ALLOWED_GROUP_KEYS = {"count", "lastDate", "lastFinishedAt", "lastStatus"}


def fail(msg):
    print("::error::" + msg); sys.exit(1)


def safety():
    d = json.load(open("data/runs.json", encoding="utf-8"))
    if d.get("encrypted") is not True or "runs" in d:
        fail("data/runs.json KHÔNG ở dạng mã hóa – không được phép công khai.")
    for g, b in (d.get("bundles") or {}).items():
        if not all(k in b for k in ("iv", "ct", "keys")) or not b["keys"]:
            fail(f"Gói {g} thiếu iv/ct/keys.")
    try:
        s = json.load(open("data/status.json", encoding="utf-8"))
    except FileNotFoundError:
        print("status.json chưa có – bỏ qua."); return
    if set(s) - ALLOWED_STATUS_KEYS:
        fail(f"status.json có trường lạ: {sorted(set(s) - ALLOWED_STATUS_KEYS)}")
    for g, v in (s.get("groups") or {}).items():
        if set(v) - ALLOWED_GROUP_KEYS:
            fail(f"status.json nhóm {g} có trường lạ (có thể lộ nội dung).")
    print("OK: dữ liệu công khai đều đã mã hóa.")


def expected_day(now_vn):
    d = now_vn
    if not (d.weekday() < 5 and (d.hour, d.minute) >= (9, 30)):
        d -= datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d.date()


def freshness():
    try:
        s = json.load(open("data/status.json", encoding="utf-8"))
        latest = s.get("latestFinishedAt")
    except FileNotFoundError:
        latest = None
    if not latest:
        fail("Chưa có data/status.json/latestFinishedAt – lượt đồng bộ tự động chưa từng chạy thành công.")
    last = (datetime.datetime.fromisoformat(latest.replace("Z", "+00:00")) + VN).date()
    exp = expected_day(datetime.datetime.now(datetime.timezone.utc) + VN)
    if last < exp:
        fail(f"Dữ liệu cũ: lượt mới nhất {last:%d/%m/%Y}, dự kiến phải có {exp:%d/%m/%Y}. "
             "Kiểm tra: (1) scheduled task HOPT Agent có chạy/ghi Hub không; (2) HOPT GitHub Sync có quyền push không.")
    print(f"OK: lượt mới nhất {last:%d/%m/%Y} (dự kiến {exp:%d/%m/%Y}).")


if __name__ == "__main__":
    {"safety": safety, "freshness": freshness}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
