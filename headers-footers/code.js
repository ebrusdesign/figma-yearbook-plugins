// Header & Footer — flips HEADER/FOOTER instances Left/Right alternately, numbers the footers,
// and rewrites the header texts, for the book pages in the selection (or the whole Figma page).
figma.showUI(__html__, { width: 380, height: 640, themeColors: true });

var LR = /^(left|right)$/i;
var NUMRX = /^\s*(#+|\d+)\s*$/;

function topPage(n) {                         // the book-page frame: walk up to just below the canvas/section
  var t = n;
  while (t.parent && t.parent.type !== 'PAGE' && t.parent.type !== 'SECTION') t = t.parent;
  return t;
}
function pos(n) { var m = n.absoluteTransform; return { x: m[0][2], y: m[1][2] }; }
function sortPages(ps) {
  ps.sort(function (a, b) { return pos(a).y - pos(b).y; });
  var rows = [];
  ps.forEach(function (p) {
    var r = rows[rows.length - 1];
    if (r && Math.abs(pos(p).y - pos(r[0]).y) < Math.max(20, r[0].height * 0.5)) r.push(p); else rows.push([p]);
  });
  var out = [];
  rows.forEach(function (r) { r.sort(function (a, b) { return pos(a).x - pos(b).x; }); out = out.concat(r); });
  return out;
}

var mainCache = {};
async function info(inst) {                   // {name, set} of the component this instance comes from
  var m = null;
  try { m = await inst.getMainComponentAsync(); } catch (e) { m = null; }
  if (!m) return { name: '', set: null };
  var set = m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent : null;
  return { name: set ? set.name : m.name, set: set };
}
function sideProp(inst) {
  var cp = inst.componentProperties || {};
  for (var k in cp) if (cp[k].type === 'VARIANT' && LR.test(String(cp[k].value))) return k;
  return null;
}
function texts(inst) {                        // text layers keyed by name (duplicates get " (2)", " (3)"…)
  var seen = {}, out = [];
  inst.findAll(function (n) { return n.type === 'TEXT'; }).forEach(function (n) {
    var c = (seen[n.name] = (seen[n.name] || 0) + 1);
    out.push({ key: c > 1 ? n.name + ' (' + c + ')' : n.name, node: n });
  });
  return out;
}
function numberNode(inst) {
  var t = texts(inst).map(function (x) { return x.node; });
  return t.filter(function (n) { return n.name.trim() === '###'; })[0] ||
         t.filter(function (n) { return NUMRX.test(n.characters); })[0] ||
         (t.length === 1 ? t[0] : null);
}

async function gather(scope, headerName, footerName) {
  var roots = scope === 'page' ? [figma.currentPage] : figma.currentPage.selection.slice();
  var insts = [];
  roots.forEach(function (r) {
    if (r.type === 'INSTANCE') insts.push(r);
    if ('findAll' in r) insts = insts.concat(r.findAll(function (n) { return n.type === 'INSTANCE'; }));
  });
  var names = {}, pages = {}, order = [];
  for (var i = 0; i < insts.length; i++) {
    var inst = insts[i], inf = await info(inst);
    if (!inf.name) continue;
    names[inf.name] = (names[inf.name] || 0) + 1;
    var kind = inf.name === headerName ? 'header' : inf.name === footerName ? 'footer' : null;
    if (!kind) continue;
    var pg = topPage(inst);
    if (!pages[pg.id]) { pages[pg.id] = { node: pg, header: [], footer: [] }; order.push(pg); }
    pages[pg.id][kind].push({ inst: inst, set: inf.set });
  }
  return { names: names, pages: sortPages(order).map(function (p) { return pages[p.id]; }) };
}
function guess(names, word) {
  var ks = Object.keys(names), rx = new RegExp(word, 'i');
  return ks.filter(function (k) { return k.toLowerCase() === word; })[0] || ks.filter(function (k) { return rx.test(k); })[0] || '';
}

async function scan(msg) {
  var g0 = await gather(msg.scope, '', '');
  var headerName = msg.headerName && g0.names[msg.headerName] ? msg.headerName : guess(g0.names, 'header');
  var footerName = msg.footerName && g0.names[msg.footerName] ? msg.footerName : guess(g0.names, 'footer');
  var g = await gather(msg.scope, headerName, footerName);
  var fields = [], fseen = {};
  g.pages.forEach(function (p) {
    p.header.forEach(function (h) { texts(h.inst).forEach(function (t) {
      if (!fseen[t.key]) { fseen[t.key] = 1; fields.push({ key: t.key, sample: t.node.characters }); }
    }); });
  });
  var pages = g.pages.map(function (p) {
    var h = p.header[0], f = p.footer[0], nn = f && numberNode(f.inst);
    return { id: p.node.id, name: p.node.name, nh: p.header.length, nf: p.footer.length,
             hSide: h && sideProp(h.inst) ? h.inst.componentProperties[sideProp(h.inst)].value : '',
             fSide: f && sideProp(f.inst) ? f.inst.componentProperties[sideProp(f.inst)].value : '',
             num: nn ? nn.characters : '', numLayer: !!nn };
  });
  return { type: 'scan', names: Object.keys(g0.names).sort(), headerName: headerName, footerName: footerName,
           fields: fields, pages: pages, selCount: figma.currentPage.selection.length };
}

async function loadFonts(n) {
  if (n.hasMissingFont) throw new Error('missing font');
  var fonts = n.characters.length ? n.getRangeAllFontNames(0, n.characters.length) : [n.fontName];
  for (var i = 0; i < fonts.length; i++) await figma.loadFontAsync(fonts[i]);
}
async function setText(inst, node, value) {
  if (node.characters === value) return;
  var ref = node.componentPropertyReferences && node.componentPropertyReferences.characters;
  if (ref && inst.componentProperties && inst.componentProperties[ref]) { var o = {}; o[ref] = value; inst.setProperties(o); return; }
  await loadFonts(node);
  node.characters = value;
}
function optionFor(set, prop, want) {
  try {
    var defs = set && set.componentPropertyDefinitions, d = defs && defs[prop];
    var opts = (d && d.variantOptions) || [];
    var hit = opts.filter(function (o) { return o.toLowerCase() === want.toLowerCase(); })[0];
    if (hit) return hit;
  } catch (e) { /* fall through */ }
  return want;
}
async function flip(item, want) {               // swap variant, then put back any text the swap reset
  var inst = item.inst, prop = sideProp(inst);
  if (!prop) throw new Error('no Left/Right property');
  var cur = String(inst.componentProperties[prop].value);
  if (cur.toLowerCase() === want.toLowerCase()) return false;
  var before = texts(inst), keep = {};
  before.forEach(function (t) { keep[t.key] = t.node.characters; });
  var o = {}; o[prop] = optionFor(item.set, prop, want);
  inst.setProperties(o);
  var after = texts(inst), sameShape = after.length === before.length;
  for (var i = 0; i < after.length; i++) {
    var t = after[i], v = keep[t.key] !== undefined ? keep[t.key] : (sameShape ? before[i].node.characters : undefined);
    if (v !== undefined && t.node.characters !== v) await setText(inst, t.node, v);
  }
  return true;
}

async function apply(msg) {
  var g = await gather(msg.scope, msg.headerName, msg.footerName);
  var res = { flipped: 0, numbered: 0, texted: 0, renamed: 0, problems: [] };
  function problem(p, what, e) { res.problems.push({ id: p.node.id, page: p.node.name, what: what + (e ? ': ' + (e.message || e) : '') }); }
  var startLeft = msg.start === 'Left';
  for (var i = 0; i < g.pages.length; i++) {
    var p = g.pages[i], side = (i % 2 === 0) === startLeft ? 'Left' : 'Right';
    if (msg.doSides) {
      var both = p.header.concat(p.footer);
      for (var a = 0; a < both.length; a++) {
        try { if (await flip(both[a], side)) res.flipped++; } catch (e) { problem(p, 'flip', e); }
      }
    }
    if (msg.doText) {
      for (var b = 0; b < p.header.length; b++) {
        var h = p.header[b], did = false;
        var ts = texts(h.inst);
        for (var c = 0; c < ts.length; c++) {
          var k = msg.fieldOrder.indexOf(ts[c].key) >= 0 ? ts[c].key : msg.fieldOrder[c];   // match by name, else by position
          var v = msg.texts[k];
          if (v === undefined || v === '') continue;
          try { if (ts[c].node.characters !== v) { await setText(h.inst, ts[c].node, v); did = true; } } catch (e) { problem(p, 'header text "' + ts[c].key + '"', e); }
        }
        if (did) res.texted++;
      }
    }
    if (msg.doRename) {
      var nm = String(msg.startNum + i);
      try { if (p.node.name !== nm) { p.node.name = nm; res.renamed++; } } catch (e) { problem(p, 'rename frame', e); }
    }
    if (msg.doNums) {
      if (!p.footer.length) problem(p, 'no footer — number ' + (msg.startNum + i) + ' skipped');
      for (var f = 0; f < p.footer.length; f++) {
        var nn = numberNode(p.footer[f].inst);
        if (!nn) { problem(p, 'no number layer found in footer'); continue; }
        try { await setText(p.footer[f].inst, nn, String(msg.startNum + i)); res.numbered++; } catch (e) { problem(p, 'page number', e); }
      }
    }
  }
  figma.commitUndo();
  return res;
}

var last = { scope: 'selection', headerName: '', footerName: '' };
async function rescan() { figma.ui.postMessage(await scan(last)); }
figma.on('selectionchange', function () { if (last.scope === 'selection') rescan(); });
figma.on('currentpagechange', rescan);

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'scan') { last = { scope: msg.scope, headerName: msg.headerName, footerName: msg.footerName }; await rescan(); }
    else if (msg.type === 'apply') {
      var r = await apply(msg);
      figma.ui.postMessage({ type: 'done', res: r });
      figma.notify('Updated ' + (r.flipped + r.numbered + r.texted + r.renamed) + ' layers — Cmd+Z to undo');
      await rescan();
    }
    else if (msg.type === 'goto') {
      var n = await figma.getNodeByIdAsync(msg.id);
      if (n) figma.viewport.scrollAndZoomIntoView([n]);   // zoom only, so the selection (and preview) stays
    }
  } catch (e) { figma.ui.postMessage({ type: 'error', message: String(e && e.message || e) }); }
};
rescan();
