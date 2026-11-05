// Reset Photo Exposure — sets the Exposure adjustment of image fills back to 0.
// Changes ONLY the adjustment values: the image, crop, fill mode, size, position, rotation,
// opacity and every other property are copied over untouched.
figma.showUI(__html__, { width: 330, height: 470, themeColors: true });

var OTHER = ['contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'];
function off(v) { return typeof v === 'number' && Math.abs(v) > 1e-6; }
function expOff(p) { return p.type === 'IMAGE' && p.filters && off(p.filters.exposure); }
function otherOff(p) { return p.type === 'IMAGE' && p.filters && OTHER.some(function (k) { return off(p.filters[k]); }); }
function needs(p, all) { return expOff(p) || (all && otherOff(p)); }
function imageFills(n) {
  if (!('fills' in n)) return null;
  var f = n.fills;
  if (!Array.isArray(f)) return null;               // figma.mixed (text with mixed fills)
  return f.some(function (p) { return p.type === 'IMAGE'; }) ? f : null;
}

async function roots(scope) {
  if (scope === 'selection') return figma.currentPage.selection.slice();
  if (scope === 'page') return [figma.currentPage];
  await figma.loadAllPagesAsync();
  return figma.root.children.slice();
}
function pageOf(n) { while (n && n.type !== 'PAGE') n = n.parent; return n; }
function topFrame(n) { var t = n; while (t.parent && t.parent.type !== 'PAGE') t = t.parent; return t; }

async function collect(scope) {
  var seen = {}, out = [];
  function add(n) { if (!seen[n.id] && imageFills(n)) { seen[n.id] = 1; out.push(n); } }
  var rs = await roots(scope);
  for (var i = 0; i < rs.length; i++) {
    var r = rs[i];
    if (r.type !== 'PAGE') add(r);
    if ('findAll' in r) r.findAll(function (n) { return !!imageFills(n); }).forEach(add);
  }
  return out;
}

async function scan(scope, all) {
  var nodes = await collect(scope), groups = {}, order = [], exp = 0, oth = 0, need = 0;
  nodes.forEach(function (n) {
    var f = n.fills, e = f.some(expOff), o = f.some(otherOff);
    if (e) exp++;
    if (o) oth++;
    if (e || (all && o)) {
      need++;
      var t = topFrame(n), pg = pageOf(n), key = t.id;
      if (!groups[key]) { groups[key] = { name: t.name, page: pg ? pg.name : '', ids: [] }; order.push(key); }
      groups[key].ids.push(n.id);
    }
  });
  return { type: 'scan', total: nodes.length, exp: exp, other: oth, need: need,
           groups: order.map(function (k) { return groups[k]; }), multiPage: scope === 'all' };
}

async function reset(scope, all) {
  var nodes = await collect(scope), fixed = 0, failed = [];
  nodes.forEach(function (n) {
    var f = n.fills;
    if (!f.some(function (p) { return needs(p, all); })) return;
    var nf = f.map(function (p) {
      if (!needs(p, all)) return p;
      var filt = Object.assign({}, p.filters, { exposure: 0 });
      if (all) OTHER.forEach(function (k) { if (k in filt) filt[k] = 0; });
      return Object.assign({}, p, { filters: filt });   // every other paint field is kept as-is
    });
    try { n.fills = nf; fixed++; } catch (e) { failed.push(n.name); }
  });
  figma.commitUndo();
  return { type: 'done', fixed: fixed, failed: failed };
}

function sendSel() { figma.ui.postMessage({ type: 'sel', count: figma.currentPage.selection.length }); }
figma.on('selectionchange', sendSel);
figma.on('currentpagechange', sendSel);
sendSel();

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'scan') figma.ui.postMessage(await scan(msg.scope, msg.all));
    else if (msg.type === 'reset') {
      var res = await reset(msg.scope, msg.all);
      figma.ui.postMessage(res);
      figma.ui.postMessage(await scan(msg.scope, msg.all));
      figma.notify('Reset ' + res.fixed + ' photo' + (res.fixed === 1 ? '' : 's') + ' — Cmd+Z to undo');
    }
    else if (msg.type === 'select') {
      var ns = [];
      for (var i = 0; i < msg.ids.length; i++) { var n = await figma.getNodeByIdAsync(msg.ids[i]); if (n) ns.push(n); }
      if (!ns.length) return;
      var pg = pageOf(ns[0]);
      if (pg && pg !== figma.currentPage) await figma.setCurrentPageAsync(pg);
      ns = ns.filter(function (n) { return pageOf(n) === figma.currentPage; });
      figma.currentPage.selection = ns;
      figma.viewport.scrollAndZoomIntoView(ns);
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};
