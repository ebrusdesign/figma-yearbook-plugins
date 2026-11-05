// Checks the layout engine on random photo sets: every photo placed once, inside the page,
// no overlaps, crops within the limit. Run: node photo-fill/test/layout.test.js
const assert = require('assert');
require('../src/layout.js');
const o = { gap: 10, maxTrim: 0.03 }, W = 1618, H = 1014;
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shapes = [3 / 2, 2 / 3, 4 / 3, 3 / 4, 1, 16 / 9];
for (let trial = 0; trial < 8; trial++) {
  const n = 18 + Math.floor(rnd() * 20);
  const A = Array.from({ length: n }, () => shapes[Math.floor(rnd() * shapes.length)]);
  const plan = RL.planCounts(n, 4, 13);
  const pages = RL.layoutBook(A, plan.counts.map(() => ({ w: W, h: H })), plan.counts, o);
  const seen = new Set();
  pages.forEach((p, k) => {
    assert.strictEqual(p.rects.length, plan.counts[k], 'page gets its planned count');
    p.rects.forEach((r, a) => {
      assert(!seen.has(r.i), 'photo used twice'); seen.add(r.i);
      assert(r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5, 'inside page');
      p.rects.slice(a + 1).forEach(q => assert(r.x + r.w <= q.x + 0.5 || q.x + q.w <= r.x + 0.5 || r.y + r.h <= q.y + 0.5 || q.y + q.h <= r.y + 0.5, 'no overlap'));
    });
    assert(p.maxCrop <= 0.25, 'crop sane: ' + p.maxCrop);
  });
  assert.strictEqual(seen.size, plan.counts.reduce((s, c) => s + c, 0), 'all planned photos placed');
}
console.log('photo-fill layout: all checks passed');
