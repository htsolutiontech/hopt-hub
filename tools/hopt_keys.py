#!/usr/bin/env python3
"""HOPT Hub – quản lý khóa vai trò (RBAC) cho keys.json.

Mỗi vai trò có một cặp khóa RSA-3072. Khóa công khai nằm công khai trong keys.json;
khóa riêng được mã hóa bằng AES-256-GCM với khóa dẫn xuất từ mật khẩu (PBKDF2-SHA256).
Chỉ người biết mật khẩu mới mở được khóa riêng -> mở được dữ liệu agent được cấp quyền.

Lệnh:
  python3 tools/hopt_keys.py init   [--keys keys.json]          # tạo mới 5 vai trò, in mật khẩu ngẫu nhiên
  python3 tools/hopt_keys.py passwd ROLE [--keys keys.json]     # đổi mật khẩu (giữ khóa, cần mật khẩu cũ)
  python3 tools/hopt_keys.py rotate ROLE [--keys keys.json]     # thu hồi: tạo cặp khóa mới + mật khẩu mới
  python3 tools/hopt_keys.py show   [--keys keys.json]          # xem vai trò & quyền
Quyền (ACL) nằm ở mục "access" trong keys.json; sửa trực tiếp nếu cần, lượt đồng bộ sau sẽ áp dụng.
Yêu cầu: pip install cryptography
"""
import argparse, base64, getpass, json, os, secrets, string, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 310_000
ROLES = {
    "admin": {"label_vi": "Quản trị (toàn quyền)", "label_en": "Administrator (full access)"},
    "user1": {"label_vi": "Radar Thiết bị & Giải pháp Y tế số", "label_en": "Device & Digital Health Radar"},
    "user2": {"label_vi": "Tài chính Quốc tế & Việt Nam", "label_en": "Global & Vietnam Finance"},
    "user3": {"label_vi": "Đầu tư & M&A Bệnh viện, Phòng khám", "label_en": "Hospital & Clinic Investment, M&A"},
    "user4": {"label_vi": "Thuận lợi, Bất lợi & Khuyến nghị chiến lược", "label_en": "Opportunities, Risks & Strategy"},
}
ACCESS = {"admin": ["A1", "A2", "A3", "A4", "W", "Y"], "user1": ["A1"], "user2": ["A2"], "user3": ["A3"], "user4": ["A4"]}
b64 = lambda b: base64.b64encode(b).decode()
ub64 = base64.b64decode

def kdf(password, salt):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())

def gen_password(n=16):
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(n))

def make_role(password):
    priv = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    pkcs8 = priv.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    spki = priv.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(kdf(password, salt)).encrypt(iv, pkcs8, None)
    return {"pub": b64(spki), "encPriv": {"kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}}

def open_priv(entry, password):
    e = entry["encPriv"]
    return AESGCM(kdf(password, ub64(e["salt"]))).decrypt(ub64(e["iv"]), ub64(e["ct"]), None)  # raises on wrong password

def load(path):
    with open(path, encoding="utf-8") as f: return json.load(f)

def save(path, data):
    with open(path, "w", encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False, indent=1)

def ask_new(role):
    p = getpass.getpass(f"Mật khẩu mới cho {role} (để trống = tạo ngẫu nhiên): ")
    if not p: return gen_password(), True
    if len(p) < 12: sys.exit("Mật khẩu tối thiểu 12 ký tự.")
    if p != getpass.getpass("Nhập lại: "): sys.exit("Không khớp.")
    return p, False

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["init", "passwd", "rotate", "show"])
    ap.add_argument("role", nargs="?"); ap.add_argument("--keys", default="keys.json")
    ap.add_argument("--random", action="store_true", help="init: tạo mật khẩu ngẫu nhiên không hỏi")
    a = ap.parse_args()
    if a.cmd == "init":
        if os.path.exists(a.keys) and input(f"{a.keys} đã có. Ghi đè (mọi mật khẩu cũ mất hiệu lực)? [y/N] ").lower() != "y": return
        data = {"version": 1, "alg": "RSA-OAEP-3072-SHA256 + AES-256-GCM", "roles": {}, "access": ACCESS}
        out = []
        for r, meta in ROLES.items():
            pw, rnd = (gen_password(), True) if a.random else ask_new(r)
            data["roles"][r] = {**meta, **make_role(pw)}
            out.append((r, pw if rnd else "(mật khẩu anh vừa nhập)"))
        save(a.keys, data)
        print("Đã tạo", a.keys); [print(f"  {r:6s}  {p}") for r, p in out]
        print("Lưu mật khẩu ở nơi an toàn; không commit mật khẩu vào repo.")
    elif a.cmd in ("passwd", "rotate"):
        data = load(a.keys); r = a.role
        if r not in data["roles"]: sys.exit(f"Không có vai trò {r}")
        if a.cmd == "passwd":
            try: pkcs8 = open_priv(data["roles"][r], getpass.getpass(f"Mật khẩu hiện tại của {r}: "))
            except Exception: sys.exit("Sai mật khẩu.")
            pw, rnd = ask_new(r); salt, iv = os.urandom(16), os.urandom(12)
            data["roles"][r]["encPriv"] = {"kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(AESGCM(kdf(pw, salt)).encrypt(iv, pkcs8, None))}
        else:
            pw, rnd = ask_new(r); meta = {k: v for k, v in data["roles"][r].items() if k.startswith("label")}
            data["roles"][r] = {**meta, **make_role(pw)}
            print("Lưu ý: dữ liệu cũ trong lịch sử git vẫn mở được bằng khóa cũ; chỉ dữ liệu đồng bộ từ nay dùng khóa mới.")
        save(a.keys, data); print(f"Đã cập nhật {r}." + (f" Mật khẩu mới: {pw}" if rnd else ""))
    else:
        data = load(a.keys)
        for r, e in data["roles"].items(): print(f"{r:6s} {e.get('label_vi','')} -> {', '.join(data['access'].get(r, []))}")

if __name__ == "__main__":
    main()
