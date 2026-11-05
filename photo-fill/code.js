// Yearbook Photo Fill — Figma main thread.
// The UI does decoding and layout; this side reads the selection and creates / moves image layers.
figma.showUI(__html__, { width: 380, height: 680, themeColors: true });

var PD = 'yearbookPhoto';
var PAGE_FRAME_NAME = /photo\s*page/i;

function isFrameLike(n) { return n && (n.type === 'FRAME' || n.type === 'COMPONENT'); }

// The selected node itself, or (if a whole book page was selected) the "PHOTO PAGE" frame inside it.
function resolvePhotoFrame(node) {
  // a photo inside a filled frame → that frame
  if (node && !isFrameLike(node) && node.parent && isFrameLike(node.parent)) return node.parent;
  if (!isFrameLike(node)) return null;
  if (PAGE_FRAME_NAME.test(node.name)) return node;
  if ('findOne' in node) {
    var inner = node.findOne(function (c) { return isFrameLike(c) && PAGE_FRAME_NAME.test(c.name); });
    if (inner) return inner;
  }
  return node;
}

// pixels per printed inch: outermost frame above the photo frame is the book page
function pxPerInch(frame, pageWidthIn) { return outerFrame(frame).width / pageWidthIn; }

function imageChildren(frame) {
  // layers-panel order (top first) = reading order
  var out = [];
  for (var i = frame.children.length - 1; i >= 0; i--) {
    var c = frame.children[i];
    if (!('fills' in c) || !Array.isArray(c.fills)) continue;
    var f = c.fills.filter(function (p) { return p.type === 'IMAGE' && p.imageHash; })[0];
    if (f) out.push({ node: c, hash: f.imageHash });
  }
  return out;
}


function pageOf(n) { while (n && n.type !== 'PAGE') n = n.parent; return n; }
function shown(n) { while (n && n.type !== 'PAGE') { if (n.visible === false || n.opacity === 0) return false; n = n.parent; } return true; }
function bbox(n) { var b = n.absoluteBoundingBox; return b ? { x: b.x, y: b.y } : { x: n.x || 0, y: n.y || 0 }; }
function imageFill(n) {
  if (!('fills' in n) || !Array.isArray(n.fills)) return null;
  for (var i = n.fills.length - 1; i >= 0; i--) { var f = n.fills[i]; if (f.type === 'IMAGE' && f.imageHash && f.visible !== false) return f; }
  return null;
}

var settings = { pageWidthIn: 11 };

function selectedFrames() {
  var seen = {}, frames = [];
  figma.currentPage.selection.forEach(function (n) {
    var f = resolvePhotoFrame(n);
    if (f && !seen[f.id]) { seen[f.id] = 1; frames.push(f); }
  });
  // book order: top-to-bottom rows, then left-to-right
  frames.sort(function (a, b) {
    var ba = a.absoluteBoundingBox || { x: 0, y: 0 }, bb = b.absoluteBoundingBox || { x: 0, y: 0 };
    var tol = Math.min(a.height, b.height) / 2;
    if (Math.abs(ba.y - bb.y) > tol) return ba.y - bb.y;
    return ba.x - bb.x;
  });
  return frames;
}

function outerFrame(f) {
  var top = f, n = f.parent;
  while (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') { if (isFrameLike(n)) top = n; n = n.parent; }
  return top;
}

function describe(f) {
  var outer = outerFrame(f);
  return {
    id: f.id, name: f.name, label: outer !== f ? outer.name : f.name, w: f.width, h: f.height,
    ppi: pxPerInch(f, settings.pageWidthIn),
    children: f.children.length,
    images: imageChildren(f).length,
    texts: f.findAll ? f.findAll(function (c) { return c.type === 'TEXT'; }).length : 0,
    autoLayout: f.layoutMode && f.layoutMode !== 'NONE'
  };
}

function sendSelection() {
  var invalid = figma.currentPage.selection.filter(function (n) { return !resolvePhotoFrame(n); }).length;
  figma.ui.postMessage({ type: 'selection', frames: selectedFrames().map(describe), invalid: invalid });
}

figma.on('selectionchange', sendSelection);
figma.on('currentpagechange', sendSelection);

function prepFrame(f) {
  if (f.layoutMode && f.layoutMode !== 'NONE') f.layoutMode = 'NONE';
  f.clipsContent = true;
}

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'init') {
      var saved = await figma.clientStorage.getAsync('settings');
      if (saved) for (var k in saved) settings[k] = saved[k];
      figma.ui.postMessage({ type: 'settings', settings: settings });
      sendSelection();
    }

    else if (msg.type === 'saveSettings') {
      settings = msg.settings;
      await figma.clientStorage.setAsync('settings', settings);
      sendSelection();
    }

    else if (msg.type === 'place') {
      var f = await figma.getNodeByIdAsync(msg.frameId);
      if (!f) throw new Error('Frame not found — was it deleted?');
      if (msg.clear) f.children.slice().forEach(function (c) { c.remove(); });
      prepFrame(f);
      var made = [];
      for (var i = 0; i < msg.items.length; i++) {
        var it = msg.items[i];
        var img = figma.createImage(it.bytes);
        var r = figma.createRectangle();
        r.name = it.name;
        r.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: img.hash }];
        r.setPluginData(PD, JSON.stringify({ w: it.srcW, h: it.srcH, src: it.src || '', from: it.from || '' }));
        made.push({ node: r, it: it });
      }
      // append in reverse so the first photo sits at the top of the layers panel
      for (var j = made.length - 1; j >= 0; j--) f.appendChild(made[j].node);
      made.forEach(function (m) { m.node.resize(m.it.w, m.it.h); m.node.x = m.it.x; m.node.y = m.it.y; });
      figma.ui.postMessage({ type: 'placed', frameId: msg.frameId, ids: made.map(function (m) { return m.node.id; }) });
      sendSelection();
    }

    else if (msg.type === 'reflowRead') {
      var frames = selectedFrames(), out = [];
      for (var a = 0; a < frames.length; a++) {
        var fr = frames[a], kids = imageChildren(fr), items = [];
        for (var b = 0; b < kids.length; b++) {
          var size = null, image = figma.getImageByHash(kids[b].hash);
          if (image) { try { size = await image.getSizeAsync(); } catch (e) { size = null; } }
          if (!size) { var pd = kids[b].node.getPluginData(PD); if (pd) size = { width: JSON.parse(pd).w, height: JSON.parse(pd).h }; }
          if (!size) size = { width: kids[b].node.width, height: kids[b].node.height };
          items.push({ id: kids[b].node.id, name: kids[b].node.name, iw: size.width, ih: size.height });
        }
        out.push({ frame: describe(fr), items: items });
      }
      figma.ui.postMessage({ type: 'reflowData', mode: msg.mode, frames: out });
    }

    else if (msg.type === 'reflowApply') {
      var f2 = await figma.getNodeByIdAsync(msg.frameId);
      prepFrame(f2);
      var nodes = [];
      for (var c = 0; c < msg.items.length; c++) {
        var it2 = msg.items[c], n = await figma.getNodeByIdAsync(it2.id);
        if (!n) continue;
        n.resize(it2.w, it2.h); n.x = it2.x; n.y = it2.y;
        nodes.push(n);
      }
      // keep the layers panel in reading order
      for (var d = nodes.length - 1; d >= 0; d--) f2.appendChild(nodes[d]);
      figma.ui.postMessage({ type: 'reflowed', frameId: msg.frameId });
      sendSelection();
    }

    else if (msg.type === 'checkPlaced') {
      // Safeguard: are any of these photos already placed somewhere in this file (outside the frames being filled)?
      var byHash = {}, bySrc = {};
      msg.items.forEach(function (it) {
        var h = figma.createImage(it.bytes).hash;
        (byHash[h] = byHash[h] || []).push(it.i);
        if (it.src) (bySrc[it.src] = bySrc[it.src] || []).push(it.i);
      });
      var excl = {}; (msg.exclude || []).forEach(function (id) { excl[id] = 1; });
      var found = {};
      var pages = figma.root.children;
      for (var pi = 0; pi < pages.length; pi++) {
        var pg = pages[pi];
        if (pg.loadAsync) await pg.loadAsync();
        var rects = pg.findAllWithCriteria({ types: ['RECTANGLE'] });
        for (var ri = 0; ri < rects.length; ri++) {
          var rn = rects[ri];
          if (rn.parent && excl[rn.parent.id]) continue;
          if (!Array.isArray(rn.fills)) continue;
          var hits = [];
          rn.fills.forEach(function (fl) { if (fl.type === 'IMAGE' && fl.imageHash && byHash[fl.imageHash]) hits = hits.concat(byHash[fl.imageHash]); });
          var pdx = rn.getPluginData(PD);
          if (pdx) { try { var sx = JSON.parse(pdx).src; if (sx && bySrc[sx]) hits = hits.concat(bySrc[sx]); } catch (e) { /* ignore */ } }
          if (!hits.length) continue;
          var where = outerFrame(rn).name + (pg !== figma.currentPage ? ' (' + pg.name + ')' : '');
          hits.forEach(function (i) { if (!found[i]) found[i] = { where: where, id: rn.id }; });
        }
      }
      figma.ui.postMessage({ type: 'placedCheck', found: found });
    }

    else if (msg.type === 'auditScan') {
      // Proof check: every visible image layer in the file (or in the selection), placed by the plugin or by hand.
      var scopeSel = msg.scope === 'selection';
      var pagesA = scopeSel ? [figma.currentPage] : figma.root.children;
      var itemsA = [], emptyA = [], small = 0;
      for (var p2 = 0; p2 < pagesA.length; p2++) {
        var pgA = pagesA[p2];
        if (pgA.loadAsync) await pgA.loadAsync();
        figma.ui.postMessage({ type: 'auditProgress', text: 'Scanning ' + pgA.name + '…' });
        var rootsA = scopeSel ? figma.currentPage.selection.slice() : [pgA];
        var nodesA = [], framesA = [], seenA = {};
        var isImg = function (n) { return !!imageFill(n); };
        var isPF = function (n) { return isFrameLike(n) && PAGE_FRAME_NAME.test(n.name); };
        rootsA.forEach(function (r) {
          if (r.type !== 'PAGE') { if (isImg(r)) nodesA.push(r); if (isPF(r)) framesA.push(r); }
          if (r.findAll) { nodesA = nodesA.concat(r.findAll(isImg)); framesA = framesA.concat(r.findAll(isPF)); }
        });
        var pIdx = figma.root.children.indexOf(pgA);
        nodesA.forEach(function (n) {
          if (seenA[n.id] || !shown(n)) return; seenA[n.id] = 1;
          if (n.width < 40 || n.height < 40) { small++; return; }
          var fl = imageFill(n), outer = outerFrame(n), ob = bbox(outer), nb = bbox(n);
          itemsA.push({
            id: n.id, name: n.name, hash: fl.imageHash, page: pgA.name, pageIdx: pIdx,
            label: outer !== n ? outer.name : '(loose on canvas)', loose: outer === n,
            ppi: outer !== n ? outer.width / settings.pageWidthIn : 0,
            w: n.width, h: n.height, mode: fl.scaleMode, t: fl.imageTransform || null,
            ord: [pIdx, Math.round(ob.y), Math.round(ob.x), Math.round(nb.y), Math.round(nb.x)]
          });
        });
        framesA.forEach(function (f) {
          if (!shown(f)) return;
          var has = f.findAll ? f.findAll(function (c) { return !!imageFill(c) && shown(c); }).length : 0;
          if (!has) { var o = outerFrame(f), b = bbox(o); emptyA.push({ id: f.id, label: o !== f ? o.name : f.name, page: pgA.name, ord: [pIdx, Math.round(b.y), Math.round(b.x), 0, 0] }); }
        });
      }
      figma.ui.postMessage({ type: 'auditList', items: itemsA, empty: emptyA, small: small, pages: figma.root.children.length });
    }

    else if (msg.type === 'auditBytes') {
      var outB = [];
      for (var q = 0; q < msg.hashes.length; q++) {
        var im = figma.getImageByHash(msg.hashes[q]), by = null;
        if (im) { try { by = await im.getBytesAsync(); } catch (e) { by = null; } }
        outB.push({ hash: msg.hashes[q], bytes: by });
      }
      figma.ui.postMessage({ type: 'auditBytesRes', list: outB });
    }

    else if (msg.type === 'select') {
      // nodes can live on other Figma pages: jump to the page of the first one, select those on it
      var sel = [], selPage = null;
      for (var e = 0; e < msg.ids.length; e++) {
        var nd = await figma.getNodeByIdAsync(msg.ids[e]); if (!nd) continue;
        var ndp = pageOf(nd); if (!selPage) selPage = ndp;
        if (ndp === selPage) sel.push(nd);
      }
      if (selPage && selPage !== figma.currentPage) await figma.setCurrentPageAsync(selPage);
      if (sel.length) { figma.currentPage.selection = sel; figma.viewport.scrollAndZoomIntoView(sel); }
    }

    else if (msg.type === 'notify') {
      figma.notify(msg.text, { timeout: msg.timeout || 3000 });
    }
  } catch (err) {
    figma.ui.postMessage({ type: 'error', text: String(err && err.message || err), frameId: msg.frameId });
  }
};
