/* insight.js – dùng chung cho HOPT Hub và BMAI Hub.
   Tính trên trình duyệt, SAU khi dữ liệu đã giải mã; không gửi dữ liệu đi đâu.
   - So sánh định lượng lượt mới nhất với lượt liền trước (ghép KPI theo nhãn, Δ, Δ%, biểu đồ).
   - Infographic: thẻ KPI có mũi tên biến động + sparkline lịch sử, biểu đồ cặp (kỳ trước/kỳ này).
   - Nguồn chi tiết: đơn vị phát hành, ngày, mức kiểm chứng, đánh dấu nguồn mới, nguồn của từng chỉ số.
   API: window.Insight = {parse, matchKpis, kpiTiles, compare, sources, movers, moversOf, css} – mọi hàm trả về chuỗi HTML đã escape. */
(function () {
  "use strict";
  const T = {
    vi: { cmpH: "So sánh định lượng với lượt liền trước", noPrev: "Chưa có lượt liền trước để so sánh.", kpi: "Chỉ số", prev: "Kỳ trước", cur: "Kỳ này",
      d: "Chênh lệch", dp: "Thay đổi %", src: "Nguồn số liệu", pp: "điểm %", unitDiff: "khác đơn vị", nonNum: "không phải số", newK: "Chỉ số mới (kỳ trước không có)",
      dropK: "Chỉ số kỳ trước, kỳ này không còn", dpChart: "Biến động % của các chỉ số so với kỳ trước", counts: "Khối lượng thông tin",
      hl: "Điểm chính", srcN: "Nguồn trích dẫn", srcNew: "Nguồn mới so với kỳ trước", charts: "Biểu đồ", secs: "Mục báo cáo", kpis: "Chỉ số",
      pair: "So sánh từng nhóm", srcH: "Nguồn dẫn chi tiết", pub: "Đơn vị phát hành", date: "Ngày", lvl: "Mức kiểm chứng", use: "Dùng cho", isNew: "Mới",
      kSrc: "Nguồn của số liệu chỉ số", mix: "Cơ cấu độ tin cậy nguồn", dom: "Đơn vị phát hành nhiều nhất", lv1: "Nguồn gốc", lv2: "Thứ cấp", lv3: "1 nguồn – chưa xác nhận", lv0: "Chưa gắn nhãn",
      dir: "Màu chỉ thể hiện chiều tăng/giảm, không phải tốt/xấu.", mov: "Biến động chỉ số giữa hai lượt gần nhất", agent: "Agent", hist: "Xu hướng các lượt gần đây",
      noSrc: "⚠ Lượt này chưa ghi danh sách nguồn – thông tin cần kiểm chứng trước khi dùng.", kNo: "thiếu nguồn", same: "không đổi", basis: "So sánh {a} với {b}", none: "Chưa có chỉ số định lượng để so sánh giữa hai lượt." },
    en: { cmpH: "Quantitative comparison with the previous run", noPrev: "No previous run to compare with.", kpi: "Indicator", prev: "Previous", cur: "Latest",
      d: "Change", dp: "Change %", src: "Data source", pp: "pp", unitDiff: "different unit", nonNum: "not numeric", newK: "New indicators (not in previous run)",
      dropK: "Indicators dropped since previous run", dpChart: "% change of indicators vs previous run", counts: "Volume of information",
      hl: "Key points", srcN: "Cited sources", srcNew: "New sources vs previous run", charts: "Charts", secs: "Report sections", kpis: "Indicators",
      pair: "Category-level comparison", srcH: "Detailed sources", pub: "Publisher", date: "Date", lvl: "Verification", use: "Used for", isNew: "New",
      kSrc: "Sources behind the indicators", mix: "Source reliability mix", dom: "Most cited publishers", lv1: "Primary", lv2: "Secondary", lv3: "Single source – unconfirmed", lv0: "Unlabelled",
      dir: "Colours show direction only, not good/bad.", mov: "Indicator changes between the two latest runs", agent: "Agent", hist: "Trend across recent runs",
      noSrc: "⚠ This run recorded no source list – verify before use.", kNo: "no source", same: "unchanged", basis: "Comparing {a} with {b}", none: "No quantitative indicators to compare between the two runs." }
  };
  const tr = (L, k, v) => String((T[L] || T.vi)[k] || k).replace(/\{(\w+)\}/g, (_, x) => (v && v[x] != null ? v[x] : ""));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const arr = v => (Array.isArray(v) ? v : []);
  const okUrl = u => /^https?:\/\//i.test(u || "") && !/claude\.ai/i.test(u);
  const loc = (L, o, f) => (L === "en" && o && o[f + "_en"]) || (o ? o[f] : "");
  const fmtD = s => (/^\d{4}-\d{2}-\d{2}/.test(s || "") ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : String(s || ""));

  /* ---------- số liệu: "25.790" "166,64" "~5,00%" "55 triệu USD" "130 tr USD" "1.743,07" ---------- */
  const SCALE = [[/^(nghìn|ngàn|k)(?!\p{L})\.?/iu, 1e3], [/^(triệu|tr|m|mn|million)(?!\p{L})\.?/iu, 1e6], [/^(tỷ|tỉ|bn|b|billion)(?!\p{L})\.?/iu, 1e9], [/^(nghìn tỷ|ngàn tỷ|tn|trillion)(?!\p{L})\.?/iu, 1e12]];
  function parse(v, unitHint) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? { n: v, unit: String(unitHint || "").trim().toLowerCase(), pct: /%/.test(unitHint || "") } : null;
    const s = String(v).trim(), m = s.match(/[-−+]?\d[\d.,]*/);
    if (!m) return null;
    let x = m[0].replace("−", "-");
    if (x.includes(",") && x.includes(".")) x = x.lastIndexOf(",") > x.lastIndexOf(".") ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
    else if (x.includes(",")) x = x.replace(/,/g, ".").replace(/\.(?=.*\.)/g, "");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");
    let n = parseFloat(x); if (!isFinite(n)) return null;
    let rest = s.slice(m.index + m[0].length).trim();
    let mul = 1;
    for (const [re, k] of SCALE.slice().reverse()) if (re.test(rest)) { mul = k; rest = rest.replace(re, "").trim(); break; }
    const unit = (rest || String(unitHint || "")).toLowerCase().replace(/\s+/g, " ").replace(/^[\s/·-]+/, "").slice(0, 16);
    return { n: n * mul, unit: mul > 1 ? "×" + unit : unit, pct: /%/.test(rest) || /%/.test(unitHint || "") };
  }
  const nf = (L, n, max) => (isFinite(n) ? n.toLocaleString(L === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: max == null ? 2 : max }) : "—");
  function short(L, n) { const a = Math.abs(n), u = L === "en" ? [[1e12, " tn"], [1e9, " bn"], [1e6, " m"]] : [[1e12, " nghìn tỷ"], [1e9, " tỷ"], [1e6, " triệu"]];
    for (const [k, s] of u) if (a >= k) return nf(L, n / k, 2) + s; return nf(L, n, a < 10 ? 3 : 2); }

  /* ---------- ghép KPI giữa hai lượt theo nhãn ---------- */
  const SYN = [[/vietcombank/g, "vcb"], [/tpcp my|trai phieu chinh phu my|us treasury|treasury/g, "ust"], [/vn index/g, "vnindex"], [/ty gia/g, ""], [/\bban ra\b/g, "ban"]];
  function key(s) { let k = String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9%/ ]+/g, " ");
    k = k.replace(/\//g, " / "); SYN.forEach(([re, r]) => { k = k.replace(re, r); }); return k.replace(/\s+/g, " ").trim(); }
  const toks = s => new Set(key(s).split(" ").filter(w => w.length > 1 || /\d/.test(w)));
  function sim(a, b) { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach(x => { if (B.has(x)) i++; }); return i / Math.max(A.size, B.size); }
  const kLabel = k => (k && (k.label || k.name)) || "";
  function matchKpis(cur, prev) {
    const C = arr(cur && cur.kpis).filter(k => kLabel(k)), P = arr(prev && prev.kpis).filter(k => kLabel(k)), used = new Set(), pairs = [];
    C.forEach(c => { let best = -1, bs = 0; P.forEach((p, j) => { if (used.has(j)) return; const s = key(kLabel(c)) === key(kLabel(p)) ? 2 : sim(kLabel(c), kLabel(p)); if (s > bs) { bs = s; best = j; } });
      if (best >= 0 && bs >= 0.75) { used.add(best); pairs.push([c, P[best]]); } else pairs.push([c, null]); });
    return { pairs, dropped: P.filter((_, j) => !used.has(j)) };
  }
  function delta(c, p) {
    const a = parse(c && (c.num != null ? c.num : c.value), c && c.unit), b = parse(p && (p.num != null ? p.num : p.value), p && p.unit);
    if (!a || !b) return { ok: false, why: "nonNum" };
    if (a.unit !== b.unit && a.unit && b.unit && a.unit.replace(/^×/, "") !== b.unit.replace(/^×/, "")) return { ok: false, why: "unitDiff" };
    const d = a.n - b.n, dp = b.n !== 0 ? d / Math.abs(b.n) * 100 : null;
    return { ok: true, a, b, d, dp, pct: a.pct || b.pct };
  }
  function histOf(c, runs) { // runs: mới → cũ, cùng agent
    const out = []; arr(runs).forEach(r => { const m = arr(r && r.kpis).find(k => key(kLabel(k)) === key(kLabel(c))) || arr(r && r.kpis).find(k => sim(kLabel(k), kLabel(c)) >= 0.75);
      const v = m && parse(m.num != null ? m.num : m.value, m.unit); if (v) out.push({ d: r.date, n: v.n }); });
    return out.slice(0, 10).reverse();
  }

  /* ---------- SVG ---------- */
  const C_UP = "#1D7874", C_DN = "#E07A1F", C_PREV = "#94A3B8", C_ACC = "#0B6E99";
  function spark(h) {
    if (h.length < 3) return "";
    const W = 120, H = 30, V = h.map(x => x.n), mn = Math.min(...V), r = (Math.max(...V) - mn) || 1;
    const pts = V.map((v, i) => [(i * (W - 6) / (V.length - 1) + 3).toFixed(1), (H - 4 - (v - mn) / r * (H - 8)).toFixed(1)]);
    return `<svg class="ins-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="trend"><title>${esc(h.map(x => fmtD(x.d) + ": " + x.n).join(" · "))}</title>` +
      `<polyline fill="none" stroke="${C_ACC}" stroke-width="1.8" points="${pts.map(p => p.join(",")).join(" ")}"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.6" fill="${C_ACC}"/></svg>`;
  }
  function diverge(items, L) { // items: [{label, dp}] – HTML để chữ không bị co trên điện thoại
    items = items.filter(i => i.dp != null && isFinite(i.dp)); if (!items.length) return "";
    const mx = Math.max(5, ...items.map(i => Math.min(Math.abs(i.dp), 300)));
    return `<div class="ins-dv" role="img" aria-label="${esc(tr(L, "dpChart"))}">` + items.map(i => { const v = Math.max(-300, Math.min(300, i.dp)), w = (Math.abs(v) / mx * 100).toFixed(1);
      const bar = `<i style="width:${w}%;background:${v >= 0 ? C_UP : C_DN}"></i>`, val = (i.dp > 0 ? "+" : i.dp < 0 ? "−" : "") + nf(L, Math.abs(i.dp), 1) + "%" + (Math.abs(i.dp) > 300 ? "*" : "");
      return `<div class="ins-dvr"><span class="ins-dvl" title="${esc(i.label)}">${esc(i.label)}</span><span class="ins-dvn">${v < 0 ? bar : ""}</span><span class="ins-dvp">${v >= 0 ? bar : ""}</span><b class="${v >= 0 ? "ins-up" : "ins-dn"}">${val}</b></div>`; }).join("") + `</div>`;
  }
  function pairBars(labels, pv, cv, L) {
    const mx = Math.max(1e-9, ...pv.concat(cv).filter(isFinite).map(Math.abs));
    const bar = (v, c) => `<span class="ins-hbt">${isFinite(v) ? `<i style="width:${(Math.abs(v) / mx * 100).toFixed(1)}%;background:${c}"></i>` : ""}</span><b>${isFinite(v) ? nf(L, v) : "—"}</b>`;
    return `<div class="ins-pb">` + labels.map((l, n) => `<div class="ins-pbr"><span class="ins-hbl" title="${esc(l)}">${esc(l)}</span><div>${`<div class="ins-pbb">${bar(pv[n], C_PREV)}</div><div class="ins-pbb">${bar(cv[n], C_UP)}</div>`}</div></div>`).join("") + `</div>`;
  }
  function hbars(items) { // [{label, value, color}]
    if (!items.length) return ""; const mx = Math.max(1, ...items.map(i => i.value));
    return `<div class="ins-hb">` + items.map(i => `<div class="ins-hbr"><span class="ins-hbl" title="${esc(i.label)}">${esc(i.label)}</span><span class="ins-hbt"><i style="width:${(i.value / mx * 100).toFixed(1)}%;background:${i.color || C_UP}"></i></span><b>${i.value}</b></div>`).join("") + `</div>`;
  }

  /* ---------- 1. Thẻ KPI có biến động + sparkline ---------- */
  function badge(L, dl) {
    if (!dl || !dl.ok) return "";
    if (Math.abs(dl.d) < 1e-12) return `<span class="ins-bd ins-eq">= ${esc(tr(L, "same"))}</span>`;
    const up = dl.d > 0, s = up ? "+" : "−", ad = Math.abs(dl.d);
    const main = dl.pct ? s + nf(L, ad) + " " + tr(L, "pp") : s + short(L, ad);
    return `<span class="ins-bd ${up ? "ins-up" : "ins-dn"}">${up ? "▲" : "▼"} ${esc(main)}${!dl.pct && dl.dp != null ? " (" + s + nf(L, Math.abs(dl.dp), 1) + "%)" : ""}</span>`;
  }
  function kpiTiles(L, cur, prev, runs) {
    const { pairs } = matchKpis(cur, prev); if (!pairs.length) return "";
    return `<div class="ins-kpis">` + pairs.map(([c, p]) => { const dl = p ? delta(c, p) : null, h = histOf(c, runs || [cur]);
      return `<div class="ins-kpi"><b>${esc(c.value)}</b><span>${esc(loc(L, c, "label"))}</span>${badge(L, dl)}${spark(h)}${loc(L, c, "note") ? `<i>${esc(loc(L, c, "note"))}</i>` : (c.source && okUrl(c.source.url)) ? "" : `<i class="ins-warn">⚠ ${esc(tr(L, "kNo"))}</i>`}</div>`; }).join("") + `</div>`;
  }

  /* ---------- 2. Khối so sánh định lượng ---------- */
  const srcList = r => arr(r && r.sources).filter(s => s && okUrl(s.url));
  const normT = s => key(s).replace(/\d+/g, "#");
  function compare(L, cur, prev, opt) {
    opt = opt || {};
    if (!cur) return "";
    if (!prev) return `<details class="ins-box" ${opt.open ? "open" : ""}><summary>${esc(tr(L, "cmpH"))}</summary><p class="ins-mut">${esc(tr(L, "noPrev"))}</p></details>`;
    const { pairs, dropped } = matchKpis(cur, prev), rows = [], dps = [], fresh = [];
    pairs.forEach(([c, p]) => {
      if (!p) { fresh.push(c); return; }
      const dl = delta(c, p), lab = loc(L, c, "label");
      let dTxt = "—", dpTxt = "—";
      if (dl.ok) { const s = dl.d > 0 ? "+" : dl.d < 0 ? "−" : ""; dTxt = Math.abs(dl.d) < 1e-12 ? tr(L, "same") : s + (dl.pct ? nf(L, Math.abs(dl.d)) + " " + tr(L, "pp") : short(L, Math.abs(dl.d)));
        dpTxt = dl.dp == null ? "—" : (dl.dp > 0 ? "+" : dl.dp < 0 ? "−" : "") + nf(L, Math.abs(dl.dp), 1) + "%"; if (dl.dp != null) dps.push({ label: lab, dp: dl.dp }); }
      else dTxt = tr(L, dl.why);
      const cls = dl.ok ? (dl.d > 0 ? "ins-up" : dl.d < 0 ? "ins-dn" : "") : "ins-mut";
      const su = c.source && okUrl(c.source.url) ? ` <a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.title || "link")}</a>` : "";
      rows.push(`<tr><td>${esc(lab)}</td><td class="ins-num">${esc(p.value)}</td><td class="ins-num"><b>${esc(c.value)}</b></td><td class="ins-num ${cls}">${esc(dTxt)}</td><td class="ins-num ${cls}">${esc(dpTxt)}</td><td class="ins-mut">${esc(loc(L, c, "note") || "")}${su}</td></tr>`);
    });
    // khối lượng thông tin
    const ps = srcList(prev), cs = srcList(cur), pu = new Set(ps.map(s => s.url)), newSrc = cs.filter(s => !pu.has(s.url));
    const cnt = [[tr(L, "kpis"), arr(prev.kpis).length, arr(cur.kpis).length], [tr(L, "hl"), arr(prev.highlights).length, arr(cur.highlights).length],
      [tr(L, "srcN"), ps.length, cs.length], [tr(L, "charts"), arr(prev.charts).length, arr(cur.charts).length], [tr(L, "secs"), arr(prev.sections).length, arr(cur.sections).length]].concat(arr(opt.extra));
    const cntH = `<table class="ins-t"><tr><th></th><th>${esc(tr(L, "prev"))} · ${esc(fmtD(prev.date))}</th><th>${esc(tr(L, "cur"))} · ${esc(fmtD(cur.date))}</th><th>${esc(tr(L, "d"))}</th></tr>` +
      cnt.filter(r => r[1] || r[2]).map(r => { const d = r[2] - r[1]; return `<tr><td>${esc(r[0])}</td><td class="ins-num">${r[1]}</td><td class="ins-num"><b>${r[2]}</b></td><td class="ins-num ${d > 0 ? "ins-up" : d < 0 ? "ins-dn" : ""}">${d > 0 ? "+" + d : d < 0 ? "−" + -d : "="}</td></tr>`; }).join("") +
      `<tr><td>${esc(tr(L, "srcNew"))}</td><td class="ins-num">—</td><td class="ins-num"><b>${newSrc.length}</b></td><td></td></tr></table>`;
    // so sánh từng nhóm trong biểu đồ cùng tên
    const pairsCh = [];
    arr(cur.charts).forEach(c => { const p = arr(prev.charts).find(x => normT(x.title) === normT(c.title)); if (!p) return;
      const labs = []; arr(c.labels).concat(arr(p.labels)).forEach(l => { if (!labs.some(x => key(x) === key(l))) labs.push(l); });
      const val = (ch, l) => { const i = arr(ch.labels).findIndex(x => key(x) === key(l)); return i < 0 ? NaN : Number(arr(ch.values)[i]); };
      const pv = labs.map(l => val(p, l)), cv = labs.map(l => val(c, l)); if (labs.length < 2 || labs.filter((_, i) => isFinite(pv[i]) && isFinite(cv[i])).length < 1) return;
      pairsCh.push(`<div class="ins-ch"><h5>${esc(loc(L, c, "title"))}${c.unit ? " (" + esc(c.unit) + ")" : ""}</h5><div class="ins-lg"><i style="background:${C_PREV}"></i>${esc(tr(L, "prev"))} ${esc(fmtD(prev.date))}<i style="background:${C_UP}"></i>${esc(tr(L, "cur"))} ${esc(fmtD(cur.date))}</div>${pairBars(labs, pv, cv, L)}<div class="ins-mut">${esc(tr(L, "src"))}: ${esc(c.source || p.source || "")}</div></div>`); });
    const body = (rows.length ? `<div class="ins-tw"><table class="ins-t"><tr><th>${esc(tr(L, "kpi"))}</th><th>${esc(tr(L, "prev"))} · ${esc(fmtD(prev.date))}</th><th>${esc(tr(L, "cur"))} · ${esc(fmtD(cur.date))}</th><th>${esc(tr(L, "d"))}</th><th>${esc(tr(L, "dp"))}</th><th>${esc(tr(L, "src"))}</th></tr>${rows.join("")}</table></div>` : `<p class="ins-mut">${esc(tr(L, "none"))}</p>`) +
      (dps.length ? `<div class="ins-ch"><h5>${esc(tr(L, "dpChart"))}</h5>${diverge(dps, L)}<div class="ins-mut">${esc(tr(L, "dir"))}</div></div>` : "") +
      (pairsCh.length ? `<h5 class="ins-h5">${esc(tr(L, "pair"))}</h5><div class="ins-grid">${pairsCh.join("")}</div>` : "") +
      (fresh.length ? `<p class="ins-mut"><b>${esc(tr(L, "newK"))}:</b> ${fresh.map(k => esc(loc(L, k, "label") + " = " + k.value)).join("; ")}</p>` : "") +
      (dropped.length ? `<p class="ins-mut"><b>${esc(tr(L, "dropK"))}:</b> ${dropped.map(k => esc(loc(L, k, "label") + " = " + k.value)).join("; ")}</p>` : "") +
      `<h5 class="ins-h5">${esc(tr(L, "counts"))}</h5><div class="ins-tw">${cntH}</div>`;
    return `<details class="ins-box" ${opt.open !== false ? "open" : ""}><summary>${esc(tr(L, "cmpH"))} <span class="ins-tag">${esc(fmtD(prev.date))} → ${esc(fmtD(cur.date))}</span></summary>${body}</details>`;
  }

  /* ---------- 3. Nguồn dẫn chi tiết ---------- */
  function level(lb) { const s = String(lb || "").toLowerCase();
    if (/chưa xác nhận|unconfirmed|1 nguồn|single/.test(s)) return 3; if (/thứ cấp|secondary/.test(s)) return 2; if (/nguồn gốc|primary|chính thức|official/.test(s)) return 1; return 0; }
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  function sDate(s) { if (s.date) return /^\d{4}-\d{2}-\d{2}/.test(s.date) ? fmtD(s.date) : String(s.date);
    const m = String(s.title || "").match(/(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/); return m ? m[1] : "—"; }
  function sources(L, cur, prev, opt) {
    opt = opt || {}; if (!cur) return "";
    const cs = srcList(cur), pu = new Set(srcList(prev).map(s => s.url)), kp = arr(cur.kpis).filter(k => k && (k.note || k.source));
    if (!cs.length && !kp.length) return `<p class="ins-warn">${esc(tr(L, "noSrc"))}</p>`;
    const LV = [["lv1", "#15803D"], ["lv2", "#0B6E99"], ["lv3", "#E07A1F"], ["lv0", "#94A3B8"]], cntL = [0, 0, 0, 0], dom = {};
    cs.forEach(s => { cntL[level(s.label)]++; const h = s.publisher || host(s.url); if (h) dom[h] = (dom[h] || 0) + 1; });
    const mix = hbars([1, 2, 3, 0].filter(i => cntL[i]).map(i => ({ label: tr(L, LV[i === 0 ? 3 : i - 1][0]), value: cntL[i], color: LV[i === 0 ? 3 : i - 1][1] })));
    const top = hbars(Object.entries(dom).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ label: k, value: v, color: C_ACC })));
    const tab = cs.length ? `<div class="ins-tw"><table class="ins-t"><tr><th>#</th><th>${esc(tr(L, "srcN"))}</th><th>${esc(tr(L, "pub"))}</th><th>${esc(tr(L, "date"))}</th><th>${esc(tr(L, "lvl"))}</th>${cs.some(s => s.used_for) ? `<th>${esc(tr(L, "use"))}</th>` : ""}</tr>` +
      cs.map((s, i) => `<tr><td class="ins-num">${i + 1}</td><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>${prev && !pu.has(s.url) ? ` <span class="ins-new">${esc(tr(L, "isNew"))}</span>` : ""}</td><td>${esc(s.publisher || host(s.url))}</td><td class="ins-num">${esc(sDate(s))}</td><td><span class="ins-lv ins-lv${level(s.label)}">${esc(s.label || tr(L, "lv0"))}</span></td>${cs.some(x => x.used_for) ? `<td>${esc(s.used_for || "")}</td>` : ""}</tr>`).join("") + `</table></div>` : `<p class="ins-warn">${esc(tr(L, "noSrc"))}</p>`;
    const kt = kp.length ? `<h5 class="ins-h5">${esc(tr(L, "kSrc"))}</h5><div class="ins-tw"><table class="ins-t"><tr><th>${esc(tr(L, "kpi"))}</th><th>${esc(tr(L, "cur"))}</th><th>${esc(tr(L, "src"))}</th></tr>` +
      kp.map(k => `<tr><td>${esc(loc(L, k, "label"))}</td><td class="ins-num"><b>${esc(k.value)}</b></td><td>${esc(loc(L, k, "note") || "")}${k.source && okUrl(k.source.url) ? ` · <a href="${esc(k.source.url)}" target="_blank" rel="noopener">${esc(k.source.title || host(k.source.url))}</a>` : ""}</td></tr>`).join("") + `</table></div>` : "";
    const chs = arr(cur.charts).filter(c => c && c.source).map(c => `<li>${esc(loc(L, c, "title"))}: ${esc(c.source)}</li>`).join("");
    return `<details class="ins-box" ${opt.open ? "open" : ""}><summary>${esc(tr(L, "srcH"))} <span class="ins-tag">${cs.length}${prev ? " · " + cs.filter(s => !pu.has(s.url)).length + " " + esc(tr(L, "isNew")).toLowerCase() : ""}</span></summary>` +
      (cs.length ? `<div class="ins-grid"><div class="ins-ch"><h5>${esc(tr(L, "mix"))}</h5>${mix}</div><div class="ins-ch"><h5>${esc(tr(L, "dom"))}</h5>${top}</div></div>` : "") + tab + kt +
      (chs ? `<h5 class="ins-h5">${esc(tr(L, "charts"))} – ${esc(tr(L, "src"))}</h5><ul class="ins-ul">${chs}</ul>` : "") + `</details>`;
  }

  /* ---------- 4. Tổng quan: biến động lớn nhất giữa các agent ---------- */
  function moversOf(L, groups) { // groups: [{name, cur, prev}]
    const out = []; arr(groups).forEach(g => { if (!g.cur || !g.prev) return; matchKpis(g.cur, g.prev).pairs.forEach(([c, p]) => { if (!p) return; const dl = delta(c, p);
      if (dl.ok && dl.dp != null) out.push({ agent: g.name, label: loc(L, c, "label"), prev: p.value, cur: c.value, dl, pd: g.prev.date, cd: g.cur.date, note: loc(L, c, "note") }); }); });
    return out.sort((a, b) => Math.abs(b.dl.dp) - Math.abs(a.dl.dp));
  }
  function movers(L, groups, max, ttl, hp, hc) {
    const m = moversOf(L, groups).slice(0, max || 12); if (!m.length) return "";
    const rows = m.map(x => { const up = x.dl.d > 0, cls = up ? "ins-up" : x.dl.d < 0 ? "ins-dn" : ""; const s = up ? "+" : x.dl.d < 0 ? "−" : "";
      return `<tr><td>${esc(x.agent)}</td><td>${esc(x.label)}<div class="ins-mut">${esc(x.note || "")}</div></td><td class="ins-num">${esc(x.prev)}<div class="ins-mut">${esc(fmtD(x.pd))}</div></td><td class="ins-num"><b>${esc(x.cur)}</b><div class="ins-mut">${esc(fmtD(x.cd))}</div></td><td class="ins-num ${cls}">${s}${esc(x.dl.pct ? nf(L, Math.abs(x.dl.d)) + " " + tr(L, "pp") : short(L, Math.abs(x.dl.d)))}</td><td class="ins-num ${cls}">${s}${nf(L, Math.abs(x.dl.dp), 1)}%</td></tr>`; }).join("");
    return `<div class="ins-ch"><h5>${esc(ttl || tr(L, "mov"))}</h5>${diverge(m.map(x => ({ label: x.agent.replace(/^(\d+)\..*/, "A$1") + " · " + x.label, dp: x.dl.dp })), L)}<div class="ins-mut">${esc(tr(L, "dir"))}</div></div>` +
      `<div class="ins-tw"><table class="ins-t"><tr><th>${esc(tr(L, "agent"))}</th><th>${esc(tr(L, "kpi"))}</th><th>${esc(hp || tr(L, "prev"))}</th><th>${esc(hc || tr(L, "cur"))}</th><th>${esc(tr(L, "d"))}</th><th>${esc(tr(L, "dp"))}</th></tr>${rows}</table></div>`;
  }


  /* ---------- 5. Lọc bỏ mục/đoạn "Giả định" do agent ghi ---------- */
  const ASM = /^\s*[\[(]?\s*(giả định|giả thiết|các giả định|assumptions?)\b/iu;
  function stripHTML(h) {
    if (typeof DOMParser === "undefined" || !h) return h;
    const doc = new DOMParser().parseFromString("<div>" + h + "</div>", "text/html"), root = doc.body.firstChild;
    ["p,li,tr,h3,h4,h5,h6", "blockquote,div,section"].forEach(q => root.querySelectorAll(q).forEach(n => { if (n.isConnected && ASM.test(n.textContent || "")) n.remove(); }));
    return root.innerHTML;
  }
  function cleanRun(r) {
    if (!r || typeof r !== "object" || r.__ins) return r;
    const o = Object.assign({}, r); Object.defineProperty(o, "__ins", { value: 1 });
    if (Array.isArray(o.sections)) o.sections = o.sections.filter(x => x && !ASM.test(x.title || "") && !/^\s*(giả định|assumptions?)\s*$/iu.test(x.title || ""))
      .map(x => Object.assign({}, x, { html: stripHTML(x.html) })).filter(x => String(x.html || "").replace(/<[^>]*>/g, "").trim().length > 0);
    ["highlights", "highlights_en"].forEach(f => { if (Array.isArray(o[f])) o[f] = o[f].filter(x => !ASM.test(String(x))); });
    ["note", "note_en"].forEach(f => { if (ASM.test(String(o[f] || ""))) o[f] = ""; });
    ["assumptions", "assumptions_en"].forEach(f => { delete o[f]; });
    return o;
  }
  function cleanDeep(x) {
    if (Array.isArray(x)) return x.map(cleanDeep);
    if (x && typeof x === "object") { if (Array.isArray(x.sections) || Array.isArray(x.highlights)) return cleanRun(x); const o = {}; Object.keys(x).forEach(k => { o[k] = cleanDeep(x[k]); }); return o; }
    return x;
  }

  /* ---------- 6. Tổng hợp tuần (tính từ các lượt ngày trong 7 ngày) ---------- */
  const W = {
    vi: { wkH: "Tổng hợp tuần từ dữ liệu các agent", range: "Khung: {a} → {b} ({n} lượt chạy)", runs: "Lượt chạy", hlT: "Điểm chính trong tuần", uniqSrc: "Nguồn duy nhất", prim: "Tỷ lệ nguồn gốc",
      noKsrc: "Chỉ số thiếu nguồn", noRsrc: "Lượt thiếu danh sách nguồn", kTrend: "Diễn biến chỉ số trong tuần", first: "Đầu tuần", last: "Cuối tuần", range2: "Thấp – cao", wSrc: "Nguồn trích dẫn trong tuần",
      cited: "Số lượt trích", srcOf: "nguồn", srcRun: "nguồn của lượt {d}", noRunSrc: "lượt {d} chưa ghi nguồn – cần kiểm chứng", matchNote: "Nguồn cạnh mỗi điểm chính được ghép theo từ khóa/số liệu trùng với danh sách nguồn của chính lượt đó; nếu không ghép được thì dẫn về toàn bộ nguồn của lượt.",
      reco: "Khuyến nghị mới nhất", mvW: "Biến động chỉ số: đầu tuần → cuối tuần", none: "Chưa có lượt chạy nào trong 7 ngày qua.", warn: "thiếu nguồn", cov: "Kiểm tra nguồn" },
    en: { wkH: "Weekly synthesis from agent data", range: "Window: {a} → {b} ({n} runs)", runs: "Runs", hlT: "Key points of the week", uniqSrc: "Unique sources", prim: "Primary-source share",
      noKsrc: "Indicators without source", noRsrc: "Runs without source list", kTrend: "Indicator trend this week", first: "Start of week", last: "End of week", range2: "Low – high", wSrc: "Sources cited this week",
      cited: "Runs citing", srcOf: "sources", srcRun: "sources of run {d}", noRunSrc: "run {d} recorded no sources – needs verification", matchNote: "Sources next to each key point are matched by shared keywords/figures with that run's own source list; if no match, the whole source list of the run is referenced.",
      reco: "Latest recommendations", mvW: "Indicator changes: start → end of week", none: "No runs in the last 7 days.", warn: "no source", cov: "Source check" }
  };
  const tw = (L, k, v) => String((W[L] || W.vi)[k] || k).replace(/\{(\w+)\}/g, (_, x) => (v && v[x] != null ? v[x] : ""));
  const sig = s => new Set((key(s).match(/[a-z0-9%]{3,}|\d+(?:[.,]\d+)?/g) || []).filter(w => !/^(cua|cho|voi|cac|nhung|trong|theo|nay|the|and|for|with|from|this|that|tai|den|tu|duoc|mot|hai|ba|ngay|nam|thang)$/.test(w)));
  function srcFor(h, run) {
    const cs = srcList(run); if (!cs.length) return { list: [], all: false };
    const H = sig(h), sc = cs.map(s => { const S = sig((s.title || "") + " " + (s.used_for || "") + " " + host(s.url)); let n = 0; H.forEach(w => { if (S.has(w)) n += /\d/.test(w) ? 2 : 1; }); return [n, s]; })
      .filter(x => x[0] >= 2).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
    return sc.length ? { list: sc, all: false } : { list: cs, all: true };
  }
  const lk = s => `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title || "")}">${esc(s.publisher || host(s.url))}</a>${s.label ? `<span class="ins-lv ins-lv${level(s.label)}" style="margin-left:3px">${esc(String(s.label).slice(0, 22))}</span>` : ""}`;
  function weekly(L, groups, endDate) { // groups: [{name, runs (mới → cũ)}]
    const end = endDate || arr(groups).flatMap(g => arr(g.runs).map(r => r.date)).sort().pop(); if (!end) return `<p class="ins-mut">${esc(tw(L, "none"))}</p>`;
    const e = new Date(end + "T00:00:00Z"), st = new Date(e); st.setUTCDate(st.getUTCDate() - 6); const start = st.toISOString().slice(0, 10);
    const G = arr(groups).map(g => ({ name: g.name, runs: arr(g.runs).filter(r => r.date >= start && r.date <= end).map(cleanRun) })).filter(g => g.runs.length);
    if (!G.length) return `<p class="ins-mut">${esc(tw(L, "none"))}</p>`;
    const all = G.flatMap(g => g.runs), srcMap = new Map();
    all.forEach(r => srcList(r).forEach(s => { const x = srcMap.get(s.url) || { s, n: 0, d: r.date }; x.n++; if (r.date > x.d) x.d = r.date; srcMap.set(s.url, x); }));
    const us = [...srcMap.values()], prim = us.filter(x => level(x.s.label) === 1).length;
    const noK = all.reduce((n, r) => n + arr(r.kpis).filter(k => k && !k.note && !(k.source && k.source.url)).length, 0), noR = all.filter(r => !srcList(r).length).length;
    const tile = (v, l, warn) => `<div class="ins-kpi"><b${warn ? ' class="ins-dn"' : ""}>${esc(v)}</b><span>${esc(l)}</span></div>`;
    let h = `<div class="ins-wk"><h3 class="ins-wkh">${esc(tw(L, "wkH"))}</h3><p class="ins-mut">${esc(tw(L, "range", { a: fmtD(start), b: fmtD(end), n: all.length }))}</p>` +
      `<div class="ins-kpis">${tile(all.length, tw(L, "runs"))}${tile(all.reduce((n, r) => n + arr(r.highlights).length, 0), tw(L, "hlT"))}${tile(us.length, tw(L, "uniqSrc"))}${tile(us.length ? Math.round(prim / us.length * 100) + "%" : "—", tw(L, "prim"))}${tile(noK, tw(L, "noKsrc"), noK > 0)}${tile(noR, tw(L, "noRsrc"), noR > 0)}</div>`;
    const mv = movers(L, G.map(g => ({ name: g.name, cur: g.runs[0], prev: g.runs.length > 1 ? g.runs[g.runs.length - 1] : null })), 12, tw(L, "mvW"), tw(L, "first"), tw(L, "last"));
    if (mv) h += `<details class="ins-box" open><summary>${esc(tw(L, "mvW"))}</summary>${mv}</details>`;
    G.forEach(g => {
      const R = g.runs, cur = R[0], first = R[R.length - 1];
      // chỉ số
      let kt = "";
      if (arr(cur.kpis).length) {
        const rows = arr(cur.kpis).filter(k => kLabel(k)).map(c => { const hst = histOf(c, R), p = R.length > 1 ? matchKpis({ kpis: [c] }, first).pairs[0][1] : null, dl = p ? delta(c, p) : null;
          const V = hst.map(x => x.n), rg = V.length > 1 ? nf(L, Math.min(...V)) + " – " + nf(L, Math.max(...V)) : "—", hasSrc = c.note || (c.source && c.source.url);
          return `<tr><td>${esc(loc(L, c, "label"))}</td><td class="ins-num">${p ? esc(p.value) + `<div class="ins-mut">${esc(fmtD(first.date))}</div>` : "—"}</td><td class="ins-num"><b>${esc(c.value)}</b><div class="ins-mut">${esc(fmtD(cur.date))}</div></td><td class="ins-num">${badge(L, dl) || "—"}</td><td class="ins-num">${esc(rg)}</td><td>${spark(hst)}</td><td>${hasSrc ? esc(loc(L, c, "note") || "") + (c.source && okUrl(c.source.url) ? " · " + lk(c.source) : "") : `<span class="ins-warn">⚠ ${esc(tw(L, "warn"))}</span>`}</td></tr>`; }).join("");
        kt = `<h5 class="ins-h5">${esc(tw(L, "kTrend"))}</h5><div class="ins-tw"><table class="ins-t"><tr><th>${esc(tr(L, "kpi"))}</th><th>${esc(tw(L, "first"))}</th><th>${esc(tw(L, "last"))}</th><th>${esc(tr(L, "d"))}</th><th>${esc(tw(L, "range2"))}</th><th></th><th>${esc(tr(L, "src"))}</th></tr>${rows}</table></div>`;
      }
      // điểm chính (bỏ trùng), mỗi điểm kèm nguồn
      const seen = [], items = [];
      R.forEach(r => arr(L === "en" && r.highlights_en ? r.highlights_en : r.highlights).forEach((x, i) => { const tx = String(x); if (seen.some(sx => sim(sx, tx) >= 0.6)) return; seen.push(tx); items.push({ tx, r, vi: arr(r.highlights)[i] || tx }); }));
      const li = items.slice(0, 7).map(it => { const m = srcFor(it.vi, it.r), d = fmtD(it.r.date).slice(0, 5);
        const sx = m.list.length ? (m.all ? `<details class="ins-srcd"><summary>${esc(tw(L, "srcRun", { d }))} (${m.list.length})</summary>${m.list.map(lk).join(" · ")}</details>` : m.list.map(lk).join(" · ")) : `<span class="ins-warn">⚠ ${esc(tw(L, "noRunSrc", { d }))}</span>`;
        return `<li><span class="ins-tag" style="margin:0 6px 0 0">${esc(d)}</span>${esc(it.tx)}<div class="ins-hsrc">${sx}</div></li>`; }).join("");
      const rc = arr(cur.recos).slice(0, 3).map(r => `<li>${esc(loc(L, r, "title"))}${r.confidence ? ` <span class="ins-tag">${esc(r.confidence)}</span>` : ""}</li>`).join("");
      // nguồn của agent trong tuần
      const am = new Map(); R.forEach(r => srcList(r).forEach(s => { const x = am.get(s.url) || { s, n: 0, d: r.date }; x.n++; am.set(s.url, x); }));
      const av = [...am.values()].sort((a, b) => level(a.s.label || "z") - level(b.s.label || "z") || b.n - a.n);
      const cnt = [0, 0, 0, 0]; av.forEach(x => cnt[level(x.s.label)]++);
      const st = av.length ? `<details class="ins-box"><summary>${esc(tw(L, "wSrc"))} <span class="ins-tag">${av.length}</span></summary>${hbars([[1, "lv1", "#15803D"], [2, "lv2", "#0B6E99"], [3, "lv3", "#E07A1F"], [0, "lv0", "#94A3B8"]].filter(x => cnt[x[0]]).map(x => ({ label: tr(L, x[1]), value: cnt[x[0]], color: x[2] })))}` +
        `<div class="ins-tw"><table class="ins-t"><tr><th>#</th><th>${esc(tr(L, "srcN"))}</th><th>${esc(tr(L, "pub"))}</th><th>${esc(tr(L, "date"))}</th><th>${esc(tr(L, "lvl"))}</th><th>${esc(tw(L, "cited"))}</th></tr>` +
        av.map((x, i) => `<tr><td class="ins-num">${i + 1}</td><td><a href="${esc(x.s.url)}" target="_blank" rel="noopener">${esc(x.s.title || x.s.url)}</a></td><td>${esc(x.s.publisher || host(x.s.url))}</td><td class="ins-num">${esc(sDate(x.s))}</td><td><span class="ins-lv ins-lv${level(x.s.label)}">${esc(x.s.label || tr(L, "lv0"))}</span></td><td class="ins-num">${x.n}</td></tr>`).join("") + `</table></div></details>` : "";
      h += `<div class="ins-ch ins-wa"><h4 style="margin:2px 0 4px">${esc(g.name)} <span class="ins-tag">${R.length} ${esc(tw(L, "runs")).toLowerCase()} · ${R.map(r => fmtD(r.date).slice(0, 5)).join(", ")}</span></h4>${kt}` +
        (li ? `<h5 class="ins-h5">${esc(tw(L, "hlT"))}</h5><ul class="ins-ul ins-hl">${li}</ul>` : "") + (rc ? `<h5 class="ins-h5">${esc(tw(L, "reco"))}</h5><ol class="ins-ul">${rc}</ol>` : "") + st + `</div>`;
    });
    return h + `<p class="ins-mut">${esc(tw(L, "matchNote"))}</p></div>`;
  }
  const css = `.ins-box{border:1px solid rgba(127,140,160,.3);border-radius:10px;padding:6px 12px;margin:10px 0}.ins-box>summary{cursor:pointer;font-weight:600;padding:5px 0}
.ins-tag{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;background:rgba(127,140,160,.15);margin-left:6px}
.ins-mut{opacity:.72;font-size:12px}.ins-tw{overflow-x:auto;margin:6px 0}.ins-t{width:100%;border-collapse:collapse;font-size:12.5px;min-width:540px!important;box-shadow:none!important}.ins-t td:first-child,.ins-t th:first-child{min-width:120px}.ins-t td{overflow-wrap:anywhere}
.ins-t th{background:rgba(127,140,160,.14)!important;color:inherit!important;font-weight:600;text-align:left;padding:6px 8px;font-size:12px}.ins-t td{padding:6px 8px;border-bottom:1px solid rgba(127,140,160,.22);vertical-align:top}
.ins-num{white-space:nowrap;font-variant-numeric:tabular-nums}.ins-up{color:${C_UP};font-weight:600}.ins-dn{color:${C_DN};font-weight:600}
.ins-kpis{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin:8px 0}.ins-kpi{background:rgba(127,140,160,.1);border-radius:10px;padding:8px 10px;min-width:0}
.ins-kpi b{display:block;font-size:18px;line-height:1.2;overflow-wrap:anywhere}.ins-kpi span{display:block;font-size:12px;line-height:1.3}.ins-kpi i{display:block;font-style:normal;opacity:.7;font-size:11px;margin-top:2px}
.ins-bd{display:inline-block!important;font-size:11.5px!important;font-weight:600;margin-top:3px}.ins-bd.ins-up{color:${C_UP}}.ins-bd.ins-dn{color:${C_DN}}.ins-bd.ins-eq{opacity:.7}
.ins-spark{display:block;margin-top:4px;max-width:100%}.ins-svg{display:block;width:100%;max-width:680px;height:auto}
.ins-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.ins-ch{border:1px solid rgba(127,140,160,.25);border-radius:10px;padding:8px 10px;margin:6px 0;min-width:0}
.ins-ch h5,.ins-h5{margin:4px 0 6px;font-size:12.5px}.ins-lg{font-size:11.5px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.ins-lg i{width:10px;height:10px;border-radius:2px;display:inline-block;margin-left:6px}
.ins-hb{font-size:12px}.ins-hbr{display:grid;grid-template-columns:minmax(90px,42%) 1fr auto;gap:8px;align-items:center;margin:3px 0}.ins-hbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ins-hbt{height:10px;border-radius:5px;background:rgba(127,140,160,.18);overflow:hidden}.ins-hbt i{display:block;height:100%}
.ins-new{font-size:10.5px;font-weight:700;color:#fff;background:${C_UP};border-radius:4px;padding:0 5px;margin-left:4px}
.ins-lv{font-size:11px;border-radius:5px;padding:1px 6px;white-space:nowrap}.ins-lv1{background:rgba(21,128,61,.14);color:#15803D}.ins-lv2{background:rgba(11,110,153,.14);color:#0B6E99}.ins-lv3{background:rgba(224,122,31,.16);color:#B45309}.ins-lv0{background:rgba(127,140,160,.16)}
.ins-ul{margin:4px 0;padding-left:18px;font-size:12.5px}.ins-warn{color:#B45309;font-weight:600;font-size:11.5px}.ins-hl li{margin:6px 0}.ins-hsrc{font-size:11.5px;margin-top:2px;opacity:.9}.ins-srcd{display:inline}.ins-srcd summary{cursor:pointer;display:inline;opacity:.8}.ins-wa{margin:12px 0;padding:10px 14px}.ins-wkh{margin:0 0 2px}
.ins-dv{font-size:12px}.ins-dvr{display:grid;grid-template-columns:minmax(90px,34%) 1fr 1fr 64px;gap:0 6px;align-items:center;margin:4px 0}.ins-dvl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ins-dvn,.ins-dvp{height:12px;display:flex}.ins-dvn{justify-content:flex-end;border-right:1px solid rgba(127,140,160,.5)}.ins-dvn i,.ins-dvp i{display:block;height:100%;border-radius:3px;min-width:2px}.ins-dvr b{font-variant-numeric:tabular-nums;white-space:nowrap}
.ins-pb{font-size:12px}.ins-pbr{display:grid;grid-template-columns:minmax(80px,30%) 1fr;gap:8px;align-items:center;margin:5px 0}.ins-pbb{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin:1px 0}.ins-pbb b{font-weight:500;font-variant-numeric:tabular-nums;min-width:52px;text-align:right}
@media (prefers-color-scheme:dark){.ins-lv3{color:#F2A35E}.ins-lv1{color:#4ADE80}.ins-lv2{color:#7CC4F2}}`;
  if (typeof document !== "undefined" && !document.getElementById("ins-css")) { const st = document.createElement("style"); st.id = "ins-css"; st.textContent = css; document.head.appendChild(st); }
  const api = { parse, matchKpis, delta, kpiTiles, compare, sources, movers, moversOf, weekly, cleanRun, cleanDeep, css, _key: key };
  if (typeof window !== "undefined") window.Insight = api;
  if (typeof module !== "undefined") module.exports = api;
})();
