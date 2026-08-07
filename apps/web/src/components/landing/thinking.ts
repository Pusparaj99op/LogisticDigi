/**
 * A hand-authored Lottie animation: one hazard-yellow dot, breathing.
 *
 * Written inline rather than fetched so the page carries no external asset and
 * no network request for a 24×24 indicator. It marks the one place a looping
 * micro-animation earns its keep — an agent composing its next offer — and is
 * used nowhere else on the page.
 *
 * Colour is [1, 0.769, 0] in Lottie's 0–1 RGB, which is #FFC400.
 */

export const THINKING_LOTTIE = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 45,
  w: 24,
  h: 24,
  nm: 'thinking',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'dot',
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 0, s: [100], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
            { t: 22, s: [30], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
            { t: 45, s: [100] },
          ],
        },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [12, 12, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            {
              t: 0,
              s: [100, 100],
              i: { x: [0.4, 0.4], y: [1, 1] },
              o: { x: [0.6, 0.6], y: [0, 0] },
            },
            {
              t: 22,
              s: [55, 55],
              i: { x: [0.4, 0.4], y: [1, 1] },
              o: { x: [0.6, 0.6], y: [0, 0] },
            },
            { t: 45, s: [100, 100] },
          ],
        },
      },
      ao: 0,
      shapes: [
        {
          ty: 'gr',
          nm: 'group',
          it: [
            { d: 1, ty: 'el', s: { a: 0, k: [14, 14] }, p: { a: 0, k: [0, 0] }, nm: 'ellipse' },
            {
              ty: 'fl',
              c: { a: 0, k: [1, 0.769, 0, 1] },
              o: { a: 0, k: 100 },
              r: 1,
              nm: 'fill',
            },
            {
              ty: 'tr',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
              nm: 'transform',
            },
          ],
        },
      ],
      ip: 0,
      op: 45,
      st: 0,
      bm: 0,
    },
  ],
  markers: [],
};
