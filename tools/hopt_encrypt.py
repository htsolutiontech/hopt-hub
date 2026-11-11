#!/usr/bin/env python3
"""HOPT Hub – mã hóa dữ liệu lượt chạy theo vai trò.

python3 tools/hopt_encrypt.py PLAIN.json keys.json data/runs.json
PLAIN.json: {"runs":[{agent,kind,date,...}, ...]} – để NGOÀI repo, không bao giờ commit.
Mỗi nhóm agent (A1..A4, W, Y) thành một gói AES-256-GCM với khóa ngẫu nhiên riêng;
khóa gói được bọc bằng RSA-OAEP-SHA256 cho từng vai trò có quyền trong keys.json["access"].
"""
import base64, datetime, json, os, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

GROUPS = ["A1", "A2", "A3", "A4", "W", "Y"]
b64 = lambda b: base64.b64encode(b).decode()

def main(plain_path, keys_path, out_path, allow_empty=False):
    plain = json.load(open(plain_path, encoding="utf-8"))
    keys = json.load(open(keys_path, encoding="utf-8"))
    src = plain.get("runs", []) if isinstance(plain, dict) else []
    runs = [r for r in src if isinstance(r, dict) and r.get("agent") in GROUPS]
    dropped = sorted({str(r.get("agent")) for r in src if isinstance(r, dict) and r.get("agent") not in GROUPS})
    if dropped: print("CẢNH BÁO: bỏ qua lượt có agent không hợp lệ:", dropped, file=sys.stderr)
    # chặn ghi đè dữ liệu cũ bằng gói rỗng (vd. chạy trước khi agent ghi Hub)
    if not runs and not allow_empty:
        sys.exit(f"LỖI: plain.json có 0 lượt hợp lệ ({len(src)} bản ghi gốc) – không ghi đè {out_path}. Dùng --allow-empty nếu cố ý.")
    pubs = {r: serialization.load_der_public_key(base64.b64decode(e["pub"])) for r, e in keys["roles"].items()}
    oaep = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
    bundles = {}
    for g in GROUPS:
        items = [r for r in runs if r["agent"] == g]
        readers = [role for role, groups in keys.get("access", {}).items() if g in groups and role in pubs]
        if not readers: continue
        k, iv = AESGCM.generate_key(256), os.urandom(12)
        ct = AESGCM(k).encrypt(iv, json.dumps({"runs": items}, ensure_ascii=False).encode(), g.encode())
        bundles[g] = {"iv": b64(iv), "ct": b64(ct), "count": len(items), "keys": {role: b64(pubs[role].encrypt(k, oaep)) for role in readers}}
    out = {"version": 2, "encrypted": True, "updatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "HOPT Intelligence Hub", "bundles": bundles}
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=1)
    # an toàn: file xuất ra không được chứa văn bản gốc
    raw = open(out_path, encoding="utf-8").read()
    for r in runs[:50]:
        for h in (r.get("highlights") or [])[:2]:
            if isinstance(h, str) and len(h) > 12 and h in raw: sys.exit("LỖI: phát hiện văn bản gốc trong file xuất – dừng.")
    print(json.dumps({g: b["count"] for g, b in bundles.items()}))

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--allow-empty"]
    if len(args) != 3: sys.exit(__doc__)
    main(*args, allow_empty="--allow-empty" in sys.argv)
