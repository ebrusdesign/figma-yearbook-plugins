// Yearbook photo layout engine (pure JS, no DOM).
// Justified rows with equal gaps everywhere; photos keep their shape, with tiny trims (<= maxTrim)
// so pages finish flush. A row element is one photo, or a small stack: two sub-rows of 1–2 photos.
(function (root) {
  'use strict';

  function rng(seed) { // mulberry32 – deterministic so the same input gives the same pages
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var PORTRAIT = 0.9;      // aspect (w/h) below this counts as vertical
  var SUBROW_MIN = 1.15;   // a sub-row inside a stack must be at least this wide (no lone portraits)

  // element = [subrow] or [subrow, subrow]; subrow = [photoIndex, ...]
  // linear model: element width = a * height + b
  function elLin(el, A, g) {
    if (el.length === 1) { var s = 0; for (var k = 0; k < el[0].length; k++) s += A[el[0][k]]; return { a: s, b: g * (el[0].length - 1) }; }
    var inv = 0, bs = 0;
    for (var q = 0; q < el.length; q++) {
      var sa = 0; for (k = 0; k < el[q].length; k++) sa += A[el[q][k]];
      var sb = g * (el[q].length - 1);
      inv += 1 / sa; bs += sb / sa;
    }
    var a = 1 / inv; return { a: a, b: a * (bs - g * (el.length - 1)) };
  }
  function elCount(el) { var c = 0; for (var q = 0; q < el.length; q++) c += el[q].length; return c; }
  function crop(imgAR, cellAR) { return 1 - Math.min(cellAR / imgAR, imgAR / cellAR); }

  // ---------- evaluation ----------
  function evaluate(rows, A, W, H, o, wantRects) {
    var g = o.gap, mt = o.maxTrim, r = rows.length, n = 0, j, k, q, z;
    var hNat = new Array(r), lins = new Array(r), stacks = 0, stackPhotos = 0, singlesRows = 0;
    for (j = 0; j < r; j++) {
      var row = rows[j]; if (!row.length) return { cost: 1e9 };
      var sa = 0, sb = (row.length - 1) * g; lins[j] = [];
      for (k = 0; k < row.length; k++) {
        var L = elLin(row[k], A, g); lins[j].push(L); sa += L.a; sb += L.b;
        var c = elCount(row[k]); n += c;
        if (row[k].length > 1) { stacks++; stackPhotos += c; }
      }
      hNat[j] = (W - sb) / sa;
      if (row.length === 1 && row[0].length === 1) singlesRows++;
    }
    var sumH = 0; for (j = 0; j < r; j++) sumH += hNat[j];
    var Hv = H - g * (r - 1), s = Hv / sumH;
    var lo = 1 - mt, hi = 1 / (1 - mt);
    var t = s < lo ? lo : (s > hi ? hi : s), u = s / t;
    var shrink = u < 1 ? u : 1;   // too tall → shrink photos and centre rows horizontally
    var rowH = new Array(r), total = 0;
    for (j = 0; j < r; j++) { rowH[j] = hNat[j] * t * shrink; total += rowH[j]; }
    total += g * (r - 1);
    var ws = u < 1 ? 1 - u : (H - total) / H; if (ws < 1e-9) ws = 0;

    var rects = wantRects ? [] : null, maxCrop = 0, sumCrop = 0, minArea = Infinity, invalid = 0;
    var y = u > 1 ? (H - total) / 2 : 0, portPen = 0, P = 0, pcs = [];
    function put(i, x, yy, w, h) {
      if (w <= 1 || h <= 1) { invalid++; return; }
      var c = crop(A[i], w / h); if (c > maxCrop) maxCrop = c; sumCrop += c;
      if (w * h < minArea) minArea = w * h;
      // vertical = top/bottom trimmed (cell wider than photo) — the direction that can clip heads
      if (rects) rects.push({ i: i, x: x, y: yy, w: w, h: h, crop: c, vertical: w / h > A[i] });
    }
    for (j = 0; j < r; j++) {
      var row2 = rows[j], Hj = rowH[j], widths = [], rowW = (row2.length - 1) * g, pc = 0;
      for (k = 0; k < row2.length; k++) {
        var w = (lins[j][k].a * hNat[j] + lins[j][k].b) * shrink; widths.push(w); rowW += w;
        if (row2[k].length === 1 && A[row2[k][0][0]] < PORTRAIT) pc++;
      }
      P += pc; pcs.push(pc);
      var x = (W - rowW) / 2;
      for (k = 0; k < row2.length; k++) {
        var el = row2[k], we = widths[k];
        if (el.length === 1) put(el[0][0], x, y, we, Hj);
        else {
          // sub-rows: natural heights at this width, scaled to fill the row height
          var hs = [], sh = 0;
          for (q = 0; q < el.length; q++) {
            var a2 = 0; for (z = 0; z < el[q].length; z++) a2 += A[el[q][z]];
            var h2 = (we - g * (el[q].length - 1)) / a2; hs.push(h2); sh += h2;
          }
          var f = (Hj - g * (el.length - 1)) / sh, yy = y;
          for (q = 0; q < el.length; q++) {
            var hq = hs[q] * f, xx = x;
            for (z = 0; z < el[q].length; z++) {
              var wz = A[el[q][z]] * hs[q];
              if (z === el[q].length - 1) wz = x + we - xx; // absorb rounding
              put(el[q][z], xx, yy, wz, hq); xx += wz + g;
            }
            yy += hq + g;
          }
        }
        x += we + g;
      }
      y += Hj + g;
      if (pc > 2) portPen += pc - 2;
    }
    if (invalid) return { cost: 1e9 };
    if (P >= r) for (j = 0; j < r; j++) if (pcs[j] === 0) portPen += 0.5;
    var mean = 0; for (j = 0; j < r; j++) mean += rowH[j]; mean /= r;
    var vr = 0; for (j = 0; j < r; j++) vr += (rowH[j] - mean) * (rowH[j] - mean);
    var cv = Math.sqrt(vr / r) / mean;
    var avgArea = (W * H * (1 - ws)) / n, small = Math.max(0, 0.4 - minArea / avgArea);
    var cntPen = 0, ideal = n / r;
    for (j = 0; j < r; j++) {
      var cnt = 0; for (k = 0; k < rows[j].length; k++) cnt += elCount(rows[j][k]);
      cntPen += Math.max(0, Math.abs(cnt - ideal) - 1.5) + Math.max(0, cnt - 7);
    }
    var cost = 60 * ws + 10 * maxCrop + 45 * (sumCrop / n) + 25 * cv * cv + 6 * cv + 0.4 * portPen + 25 * small +
      0.6 * cntPen + (n >= 4 ? 1.5 * singlesRows : 0) + 0.45 * stacks + 0.2 * (stackPhotos - 2 * stacks);
    return { cost: cost, rects: rects, maxCrop: maxCrop, whitespace: ws, rows: r, stacks: stacks };
  }

  function rowCandidates(n, idx, A, W, H) {
    var T = 0; for (var k = 0; k < idx.length; k++) T += A[idx[k]];
    var r0 = Math.sqrt(T * H / W), lo = Math.max(1, Math.floor(r0) - 1), hi = Math.min(n, Math.ceil(r0) + 1, 6);
    var out = []; for (var r = lo; r <= hi; r++) out.push(r);
    return out.length ? out : [1];
  }

  // ---------- free-order optimisation of one page ----------
  function clone(rows) { return rows.map(function (row) { return row.map(function (el) { return el.map(function (sr) { return sr.slice(); }); }); }); }

  function optimisePage(idx, A, W, H, o, effort, rand) {
    var best = null, cands = rowCandidates(idx.length, idx, A, W, H);
    var restarts = effort === 'quick' ? 1 : 4, iters = effort === 'quick' ? 600 : 4000;
    for (var ci = 0; ci < cands.length; ci++) {
      for (var rs = 0; rs < restarts; rs++) {
        var cur = initRows(idx, A, cands[ci], rand), curE = evaluate(cur, A, W, H, o, false), temp = 0.3;
        for (var it = 0; it < iters; it++) {
          var nxt = mutate(cur, A, rand);
          if (nxt) {
            var e2 = evaluate(nxt, A, W, H, o, false);
            if (e2.cost < curE.cost || rand() < Math.exp((curE.cost - e2.cost) / temp)) { cur = nxt; curE = e2; }
            if (!best || curE.cost < best.e.cost) best = { rows: clone(cur), e: curE };
          }
          temp *= 0.997;
        }
        if (!best || curE.cost < best.e.cost) best = { rows: clone(cur), e: curE };
      }
    }
    return best;
  }

  function initRows(idx, A, r, rand) {
    var order = idx.slice().sort(function (a, b) { return A[b] - A[a] + (rand() - 0.5) * 0.3; });
    var rows = [], sums = [];
    for (var j = 0; j < r; j++) { rows.push([]); sums.push(0); }
    for (var k = 0; k < order.length; k++) {
      var m = 0; for (j = 1; j < r; j++) if (sums[j] < sums[m] || (rows[m].length && !rows[j].length)) m = j;
      rows[m].push([[order[k]]]); sums[m] += A[order[k]];
    }
    return rows;
  }

  function validEl(el, A) {
    if (el.length === 1) return el[0].length === 1;
    if (el.length !== 2) return false;
    for (var q = 0; q < 2; q++) {
      if (!el[q].length || el[q].length > 2) return false;
      var s = 0; for (var z = 0; z < el[q].length; z++) s += A[el[q][z]];
      if (s < SUBROW_MIN) return false;
    }
    return true;
  }
  // turn invalid/degenerate elements back into singles
  function normaliseRow(row) {
    var out = [];
    row.forEach(function (el) {
      el = el.filter(function (sr) { return sr.length; });
      if (!el.length) return;
      if (el.length === 1) el[0].forEach(function (i) { out.push([[i]]); });
      else out.push(el);
    });
    return out;
  }

  function mutate(rows, A, rand) {
    var R = clone(rows), r = R.length, type = rand(), j, k;
    var a = (rand() * r) | 0, b = (rand() * r) | 0;
    if (type < 0.3) { // move an element to another row
      if (r < 2 || a === b || R[a].length < 2) return null;
      R[b].push(R[a].splice((rand() * R[a].length) | 0, 1)[0]);
    } else if (type < 0.65) { // swap two photos anywhere
      var pa = pick(R, rand), pb = pick(R, rand); if (!pa || !pb) return null;
      var sa = R[pa[0]][pa[1]][pa[2]], sb = R[pb[0]][pb[1]][pb[2]];
      if (sa === sb) return null;
      var t = sa[pa[3]]; sa[pa[3]] = sb[pb[3]]; sb[pb[3]] = t;
    } else if (type < 0.8) { // stack two single photos of a row into a pair
      var row = R[a]; if (row.length < 3) return null;
      var x = (rand() * row.length) | 0, y = (rand() * row.length) | 0;
      if (x === y || row[x].length !== 1 || row[y].length !== 1) return null;
      row[x] = [[row[x][0][0]], [row[y][0][0]]]; row.splice(y, 1);
    } else if (type < 0.9) { // add a single photo of the row into a stack's sub-row
      var row3 = R[a], st = [], si = [];
      for (k = 0; k < row3.length; k++) (row3[k].length > 1 ? st : si).push(k);
      if (!st.length || !si.length) return null;
      var sk = st[(rand() * st.length) | 0], ik = si[(rand() * si.length) | 0], sub = (rand() * 2) | 0;
      if (row3[sk][sub].length >= 2) return null;
      row3[sk][sub].push(row3[ik][0][0]); row3.splice(ik, 1);
    } else { // pull one photo out of a stack
      var found = [];
      for (j = 0; j < r; j++) for (k = 0; k < R[j].length; k++) if (R[j][k].length > 1) found.push([j, k]);
      if (!found.length) return null;
      var f = found[(rand() * found.length) | 0], el = R[f[0]][f[1]], q = (rand() * el.length) | 0;
      var i = el[q].splice((rand() * el[q].length) | 0, 1)[0];
      R[f[0]].push([[i]]);
    }
    for (j = 0; j < r; j++) {
      R[j] = normaliseRow(R[j]);
      if (!R[j].length) return null;
      for (k = 0; k < R[j].length; k++) if (!validEl(R[j][k], A)) return null;
    }
    return R;
  }
  function pick(R, rand) {
    var j = (rand() * R.length) | 0; if (!R[j].length) return null;
    var k = (rand() * R[j].length) | 0, q = (rand() * R[j][k].length) | 0;
    return [j, k, q, (rand() * R[j][k][q].length) | 0];
  }

  // order elements inside each row so verticals are spread out and don't line up in a column
  function arrangeRows(rows, A) {
    return rows.map(function (row, j) {
      var tall = [], wide = [];
      row.forEach(function (el) {
        var L = elLin(el, A, 0);
        (L.a < PORTRAIT ? tall : wide).push(el);
      });
      var m = row.length, out = new Array(m), p = tall.length, used = {};
      var off = [0.15, -0.2, 0.35, -0.05][j % 4];
      for (var k = 0; k < p; k++) {
        var pos = Math.round((k + 0.5 + off) * m / p - 0.5);
        pos = Math.max(0, Math.min(m - 1, pos));
        while (used[pos]) pos = (pos + 1) % m;
        used[pos] = 1; out[pos] = tall[k];
      }
      var wi = 0; for (k = 0; k < m; k++) if (!out[k]) out[k] = wide[wi++];
      return out;
    });
  }

  // ---------- keep-order layout (Re-flow in my order) ----------
  // Photos stay in reading order; consecutive photos may form a stack. State = groups + row cuts.
  var SHAPES = { 1: [[1]], 2: [[1, 1]], 3: [[2, 1], [1, 2]], 4: [[2, 2]] };
  function buildOrdered(idx, st) {
    var els = [], p = 0;
    st.groups.forEach(function (gp) {
      var shape = SHAPES[gp.size][gp.shape], el = [];
      shape.forEach(function (cnt) { el.push(idx.slice(p, p + cnt)); p += cnt; });
      els.push(el);
    });
    var rows = [], s = 0;
    st.cuts.concat([els.length]).forEach(function (c) { rows.push(els.slice(s, c)); s = c; });
    return rows;
  }
  function orderedPage(idx, A, W, H, o) {
    var n = idx.length, best = null, rand = rng(4242);
    function score(st) {
      var rows = buildOrdered(idx, st);
      for (var j = 0; j < rows.length; j++) {
        if (!rows[j].length) return null;
        for (var k = 0; k < rows[j].length; k++) if (!validEl(rows[j][k], A)) return null;
      }
      return { rows: rows, e: evaluate(rows, A, W, H, o, false) };
    }
    rowCandidates(n, idx, A, W, H).forEach(function (r) {
      if (r > n) return;
      for (var rs = 0; rs < 3; rs++) {
        var groups = idx.map(function () { return { size: 1, shape: 0 }; }), cuts = [];
        for (var c = 1; c < r; c++) cuts.push(Math.round(c * n / r));
        var cur = { groups: groups, cuts: cuts }, curS = score(cur), temp = 0.3;
        if (!curS) continue;
        for (var it = 0; it < 3000; it++) {
          var nx = { groups: cur.groups.map(function (g) { return { size: g.size, shape: g.shape }; }), cuts: cur.cuts.slice() };
          var G = nx.groups, m = rand();
          if (m < 0.35 && nx.cuts.length) { // move a row break
            var ci = (rand() * nx.cuts.length) | 0; nx.cuts[ci] += rand() < 0.5 ? -1 : 1;
          } else if (m < 0.6) { // merge 2–3 neighbouring groups into one stack (≤ 4 photos)
            var span = rand() < 0.5 ? 2 : 3, gi = (rand() * (G.length - span + 1)) | 0;
            if (G.length < span) continue;
            var tot = 0, cutInside = false;
            for (var w2 = 0; w2 < span; w2++) tot += G[gi + w2].size;
            for (w2 = 1; w2 < span; w2++) if (nx.cuts.indexOf(gi + w2) >= 0) cutInside = true;
            if (tot > 4 || tot < 2 || cutInside) continue;
            G.splice(gi, span, { size: tot, shape: tot === 3 ? ((rand() * 2) | 0) : 0 });
            nx.cuts = nx.cuts.map(function (c2) { return c2 > gi ? c2 - (span - 1) : c2; });
          } else if (m < 0.85) { // split a group back into singles
            var big = []; G.forEach(function (g, k) { if (g.size > 1) big.push(k); });
            if (!big.length) continue;
            var bi = big[(rand() * big.length) | 0], sz = G[bi].size, add = [];
            for (var z = 0; z < sz; z++) add.push({ size: 1, shape: 0 });
            G.splice.apply(G, [bi, 1].concat(add));
            nx.cuts = nx.cuts.map(function (c2) { return c2 > bi ? c2 + sz - 1 : c2; });
          } else { // flip a 3-photo stack's shape
            var th = []; G.forEach(function (g, k) { if (g.size === 3) th.push(k); });
            if (!th.length) continue;
            var t3 = th[(rand() * th.length) | 0]; G[t3].shape = 1 - G[t3].shape;
          }
          // cuts must be strictly increasing and inside the group list
          var ok = true;
          for (var q = 0; q < nx.cuts.length; q++) if (nx.cuts[q] <= (q ? nx.cuts[q - 1] : 0) || nx.cuts[q] >= G.length) ok = false;
          if (!ok) continue;
          var sc = score(nx); if (!sc) continue;
          if (sc.e.cost < curS.e.cost || rand() < Math.exp((curS.e.cost - sc.e.cost) / temp)) { cur = nx; curS = sc; }
          if (!best || curS.e.cost < best.e.cost) best = curS;
          temp *= 0.997;
        }
        if (!best || curS.e.cost < best.e.cost) best = curS;
      }
    });
    return best;
  }

  // ---------- multi-page planning ----------
  function planCounts(N, K, maxPer, hardMax, fitSelected) {
    hardMax = hardMax || 16;
    if (!N) return { error: 'No photos loaded yet.' };
    if (!K) return { error: 'Select at least one empty photo frame in Figma.' };
    if (fitSelected && N > K * maxPer) {
      var cs = []; for (var k = 0; k < K; k++) cs.push(maxPer);
      return { pages: K, counts: cs, unused: 0, leftOut: N - K * maxPer };
    }
    if (N > K * hardMax) return { error: N + ' photos need at least ' + Math.ceil(N / hardMax) + ' frames (max ' + hardMax + ' per page). You selected ' + K + '.', tooMany: true };
    var P = Math.min(K, Math.ceil(N / maxPer)), base = Math.floor(N / P), rem = N % P, counts = [];
    for (var p = 0; p < P; p++) counts.push(base + (p < rem ? 1 : 0));
    return { pages: P, counts: counts, unused: K - P };
  }

  function layoutBook(aspects, frames, counts, o, onProgress) {
    var rand = rng(12345), N = aspects.length, P = counts.length, A = aspects.slice(), i;
    // deal photos (sorted by shape) in a snake so every page gets a similar mix
    var order = []; for (i = 0; i < N; i++) order.push(i);
    order.sort(function (a, b) { return A[a] - A[b]; });
    // more photos than slots: start from an even sample of shapes; the rest wait in a pool
    var slots = 0; counts.forEach(function (c) { slots += c; });
    var pool = [];
    if (slots < N) {
      var take = {}, chosen = [];
      for (i = 0; i < slots; i++) take[order[Math.floor((i + 0.5) * N / slots)]] = 1;
      order.forEach(function (ix) { (take[ix] ? chosen : pool).push(ix); });
      order = chosen;
    }
    var pages = counts.map(function () { return []; }), seq = [];
    for (i = 0; i < P; i++) seq.push(i);
    for (i = P - 1; i >= 0; i--) seq.push(i);
    var si = 0;
    order.forEach(function (ix) {
      for (var guard = 0; guard < seq.length; guard++) {
        var p = seq[si % seq.length]; si++;
        if (pages[p].length < counts[p]) { pages[p].push(ix); return; }
      }
    });
    var results;
    if (P > 1 || pool.length) {
      var q = pages.map(function (ix, k) { return optimisePage(ix, A, frames[k].w, frames[k].h, o, 'quick', rand).e.cost; });
      var swaps = Math.min(1200, 150 * P + (pool.length ? 300 : 0));
      for (var s = 0; s < swaps; s++) {
        var x = (rand() * P) | 0, y = (rand() * (P + (pool.length ? 1 : 0))) | 0; if (x === y) continue;
        if (y === P) { // swap with a photo that isn't placed yet — keep it if the page fits better
          var px = (rand() * pages[x].length) | 0, pp = (rand() * pool.length) | 0;
          var nxp = pages[x].slice(), tp = nxp[px]; nxp[px] = pool[pp];
          var cxp = optimisePage(nxp, A, frames[x].w, frames[x].h, o, 'quick', rand).e.cost;
          if (cxp < q[x] - 1e-6) { pages[x] = nxp; pool[pp] = tp; q[x] = cxp; }
          if (onProgress && s % 30 === 0) onProgress('Choosing best-fitting photos… ' + Math.round(100 * s / swaps) + '%');
          continue;
        }
        var ix = (rand() * pages[x].length) | 0, iy = (rand() * pages[y].length) | 0;
        if (Math.abs(A[pages[x][ix]] - A[pages[y][iy]]) < 0.12) continue;
        var nx = pages[x].slice(), ny = pages[y].slice(), t = nx[ix]; nx[ix] = ny[iy]; ny[iy] = t;
        var cx = optimisePage(nx, A, frames[x].w, frames[x].h, o, 'quick', rand).e.cost;
        var cy = optimisePage(ny, A, frames[y].w, frames[y].h, o, 'quick', rand).e.cost;
        if (cx + cy < q[x] + q[y] - 1e-6) { pages[x] = nx; pages[y] = ny; q[x] = cx; q[y] = cy; }
        if (onProgress && s % 30 === 0) onProgress('Balancing pages… ' + Math.round(100 * s / swaps) + '%');
      }
    }
    results = pages.map(function (ix, k) {
      if (onProgress) onProgress('Laying out page ' + (k + 1) + ' of ' + P + '…');
      return optimisePage(ix, A, frames[k].w, frames[k].h, o, 'full', rand);
    });
    var final = results.map(function (best, k) {
      var out = evaluate(arrangeRows(best.rows, A), A, frames[k].w, frames[k].h, o, true);
      out.photos = pages[k].slice();
      return out;
    });
    final.leftOut = pool.slice(); // photo indices not placed (only when there were more photos than slots)
    return final;
  }

  function layoutOrdered(aspects, W, H, o) {
    var idx = aspects.map(function (_, i) { return i; });
    return evaluate(orderedPage(idx, aspects, W, H, o).rows, aspects, W, H, o, true);
  }
  function layoutFree(aspects, W, H, o) {
    var idx = aspects.map(function (_, i) { return i; });
    var best = optimisePage(idx, aspects, W, H, o, 'full', rng(777));
    return evaluate(arrangeRows(best.rows, aspects), aspects, W, H, o, true);
  }

  root.RL = { planCounts: planCounts, layoutBook: layoutBook, layoutOrdered: layoutOrdered, layoutFree: layoutFree };
})(typeof window !== 'undefined' ? window : globalThis);
