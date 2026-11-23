#!/usr/bin/env python3
"""Dựng infographic.png + report.html + PDF cho báo cáo HOPT Agent.
Dùng: python3 hopt_build.py <spec.json> <thư_mục_ra>
spec: agent, code, date, period, pdf_name, kpis [{label,value,note,source:{title,url}}],
      charts [{type: bar|barh|line, title, labels, values, unit, source}], sections [{title, html}],
      sources [{title,url,label,publisher,date,used_for}]
Không in mục "Giả định"; mỗi chỉ số và biểu đồ hiện nguồn."""
import json, sys, os, re, subprocess, html, datetime
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

ASM = re.compile(r"^\s*[\[(]?\s*(giả định|giả thiết|các giả định|assumptions?)\b", re.I)
ASM_BLOCK = re.compile(r"<(p|li|tr|div|blockquote|h[3-6])\b[^>]*>\s*(?:<[^>]+>\s*)*(?:giả định|giả thiết|assumptions?)\b.*?</\1>", re.I | re.S)

spec = json.load(open(sys.argv[1], encoding="utf-8"))
out = sys.argv[2]; os.makedirs(out, exist_ok=True)
plt.rcParams["font.family"] = "DejaVu Sans"
NAVY, TEAL, ORANGE, GREY, INK = "#0B3C5D", "#1D7874", "#E07A1F", "#8A9BA8", "#1F2933"
PAL = [TEAL, NAVY, ORANGE]
kpis = spec.get("kpis", [])[:4]
charts = [c for c in spec.get("charts", []) if c.get("labels") and c.get("values") and len(c["values"]) >= 3][:2]
H = 2.4 + 4.2 * len(charts) + 1.2
fig = plt.figure(figsize=(12, H), dpi=150); fig.patch.set_facecolor("white")
fig.text(0.03, 1 - 0.55 / H, spec["agent"], fontsize=18, weight="bold", color=NAVY)
fig.text(0.03, 1 - 0.95 / H, f"HOPT Intelligence · {spec['date']} · {spec.get('period','')}", fontsize=10.5, color=GREY)
if kpis:
    w = 0.94 / len(kpis)
    for i, k in enumerate(kpis):
        ax = fig.add_axes([0.03 + i * w, 1 - 2.25 / H, w - 0.015, 1.1 / H]); ax.axis("off")
        ax.add_patch(FancyBboxPatch((0, 0), 1, 1, boxstyle="round,pad=0,rounding_size=0.08", transform=ax.transAxes, fc="#EEF4F8", ec="none"))
        ax.text(0.06, 0.62, str(k["value"]), fontsize=20, weight="bold", color=PAL[i % 3], transform=ax.transAxes)
        ax.text(0.06, 0.30, str(k["label"])[:40], fontsize=9.5, color=INK, transform=ax.transAxes)
        if k.get("note"): ax.text(0.06, 0.10, str(k["note"])[:56], fontsize=7.5, color=GREY, transform=ax.transAxes)
for j, c in enumerate(charts):
    top = 2.6 + 4.2 * j; t = c.get("type", "bar")
    ax = fig.add_axes([0.30 if t == "barh" else 0.08, 1 - (top + 3.3) / H, 0.66 if t == "barh" else 0.88, 2.8 / H])
    labels, vals = [str(x)[:34] for x in c["labels"]], [float(v) for v in c["values"]]
    if t == "barh":
        ax.barh(labels[::-1], vals[::-1], color=TEAL)
        for y, v in enumerate(vals[::-1]): ax.text(v, y, f" {v:g}", va="center", fontsize=8.5, color=INK)
    elif t == "line":
        ax.plot(labels, vals, color=NAVY, lw=2.2, marker="o")
        for x, v in zip(labels, vals): ax.annotate(f"{v:g}", (x, v), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=8)
    else:
        ax.bar(labels, vals, color=TEAL)
        for x, v in enumerate(vals): ax.text(x, v, f"{v:g}", ha="center", va="bottom", fontsize=8.5)
        plt.setp(ax.get_xticklabels(), rotation=20 if len(labels) > 4 else 0, ha="right" if len(labels) > 4 else "center", fontsize=8.5)
    for s in ("top", "right"): ax.spines[s].set_visible(False)
    ax.tick_params(labelsize=8.5)
    fig.text(0.03, 1 - (top + 0.2) / H, c["title"] + (f" ({c['unit']})" if c.get("unit") else ""), fontsize=12, weight="bold", color=NAVY)
    fig.text(0.03, 1 - (top + 4.05) / H, "Nguồn: " + str(c.get("source") or "Cần kiểm tra"), fontsize=7.5, color=GREY)
fig.text(0.03, 0.25 / H, "Thiết kế: Mr Thuong AgenticAI · Thông tin chỉ mang tính gợi ý tham khảo", fontsize=8, color=GREY)
png = os.path.join(out, "infographic.png"); fig.savefig(png, facecolor="white"); plt.close(fig)

e = html.escape
ok = lambda u: bool(re.match(r"^https?://", str(u or ""))) and "claude.ai" not in str(u)
srcs = "".join(
    f'<tr><td>{i}</td><td><a href="{e(s["url"])}">{e(s.get("title") or s["url"])}</a></td><td>{e(s.get("publisher",""))}</td>'
    f'<td>{e(s.get("date",""))}</td><td class="lb">{e(s.get("label",""))}</td><td>{e(s.get("used_for",""))}</td></tr>'
    for i, s in enumerate([s for s in spec.get("sources", []) if ok(s.get("url"))], 1))
ksrc = "".join(
    f'<tr><td>{e(str(k.get("label","")))}</td><td><b>{e(str(k.get("value","")))}</b></td><td>{e(str(k.get("note","")))}'
    + (f' · <a href="{e(k["source"]["url"])}">{e(k["source"].get("title") or k["source"]["url"])}</a>' if isinstance(k.get("source"), dict) and ok(k["source"].get("url")) else "")
    + "</td></tr>" for k in spec.get("kpis", []))
secs = "".join(f'<h2>{e(s["title"])}</h2>{ASM_BLOCK.sub("", s.get("html",""))}' for s in spec.get("sections", []) if not ASM.search(str(s.get("title", ""))))
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime('%H:%M %d/%m/%Y')
doc = f"""<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>{e(spec['agent'])} – {e(spec['date'])}</title>
<style>@page{{size:A4;margin:14mm 13mm}}body{{font-family:'DejaVu Sans',sans-serif;color:{INK};font-size:10pt;line-height:1.5}}
h1{{color:{NAVY};font-size:17pt;margin:0}}h2{{color:{TEAL};font-size:12.5pt;border-bottom:1.5px solid #D5E3EC;padding-bottom:3px;margin-top:16px;page-break-after:avoid}}
.meta{{color:{GREY};font-size:9pt;margin-bottom:8px}}img{{width:100%}}table{{border-collapse:collapse;width:100%;font-size:8.5pt;margin:6px 0}}
th{{background:{NAVY};color:#fff;text-align:left;padding:4px}}td{{border-bottom:1px solid #E1E8ED;padding:4px;vertical-align:top}}tr{{page-break-inside:avoid}}
.lb{{color:{ORANGE};font-size:8pt}}a{{color:{NAVY};word-break:break-all}}footer{{margin-top:18px;color:{GREY};font-size:8pt;border-top:1px solid #D5E3EC;padding-top:6px}}</style></head><body>
<h1>{e(spec['agent'])}</h1><div class="meta">HOPT Intelligence · {e(spec['date'])} · {e(spec.get('period',''))} · tạo lúc {now} (giờ VN)</div>
<img src="infographic.png" alt="Infographic">{secs}
{f'<h2>Nguồn của số liệu chỉ số</h2><table><tr><th>Chỉ số</th><th>Giá trị</th><th>Nguồn</th></tr>{ksrc}</table>' if ksrc else ''}
<h2>Nguồn</h2><table><tr><th>#</th><th>Nguồn</th><th>Đơn vị phát hành</th><th>Ngày</th><th>Mức kiểm chứng</th><th>Dùng cho</th></tr>{srcs}</table>
<footer>Thiết kế: Mr Thuong AgenticAI · Thông tin chỉ mang tính gợi ý tham khảo</footer></body></html>"""
hp = os.path.join(out, "report.html"); open(hp, "w", encoding="utf-8").write(doc)
pdf = os.path.join(out, spec.get("pdf_name", "report.pdf"))
subprocess.run(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", "file://" + os.path.abspath(hp)], check=True, capture_output=True, timeout=120)
print(json.dumps({"png": os.path.abspath(png), "html": os.path.abspath(hp), "pdf": os.path.abspath(pdf)}))
