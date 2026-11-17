# HOPT Hub – Vận hành đồng bộ

## Luồng dữ liệu
1. 08:30–08:46 (T2–T6): HOPT Agent 1–4 chạy → gửi email → ghi lượt vào HOPT Intelligence Hub (`runs/<A?>-<YYYYMMDD>`).
2. 09:05 và 12:05 (hằng ngày): scheduled task **HOPT GitHub Sync** đọc Hub → `tools/hopt_sync.py` mã hóa → commit `data/runs.json` + `data/status.json` → GitHub Pages.
3. 10:17 (T2–T7): GitHub Actions `hopt-guard` kiểm tra dữ liệu có phải của ngày làm việc gần nhất không; nếu không thì lượt chạy báo lỗi và GitHub gửi email.

## Điều kiện bắt buộc
- Claude GitHub App phải được cài cho repo `htsolutiontech/hopt-hub` (quyền Contents: Read & write):
  https://github.com/apps/claude/installations/select_target
  Thiếu bước này thì tác vụ đồng bộ không push được (lỗi 403). Đây là lý do repo đứng yên từ 11/11.

## Lệnh thủ công
```bash
# export Hub (đặt NGOÀI repo) -> mã hóa -> ghi data/
python3 tools/hopt_sync.py /tmp/hopt_plain/export.json            # 0 = đã ghi, 3 = không đổi
python3 tools/hopt_sync.py /tmp/hopt_plain/export.json --dry-run  # chỉ so sánh
python3 tools/hopt_guard.py safety      # dữ liệu công khai phải mã hóa
python3 tools/hopt_guard.py freshness   # dữ liệu có phải của ngày làm việc gần nhất
```

## Dấu hiệu lỗi trên site
Dải đỏ phía trên tab nghĩa là lượt dự kiến gần nhất (T2–T6 sau 09:30) chưa có trên site. Dải này đọc `data/status.json`, chỉ gồm thời điểm và số lượt, không có nội dung báo cáo.
