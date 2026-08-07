const fs = require('fs');
const path = require('path');

const lottiesDir = path.join(process.cwd(), 'apps/web/public/lotties');
if (!fs.existsSync(lottiesDir)) {
  fs.mkdirSync(lottiesDir, { recursive: true });
}

const files = [
  'inventory.json', 'procurement.json', 'negotiation.json', 'compliance.json',
  'settlement.json', 'logistics.json', 'warehouse.json', 'globe.json',
  'liquidation.json', 'shield.json', 'alert.json', 'handshake-three.json'
];

const minimalLottie = {
  v: '5.7.4', fr: 30, ip: 0, op: 60, w: 100, h: 100, nm: 'Placeholder', ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0, ind: 1, ty: 4, nm: 'Shape', sr: 1,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      ao: 0,
      shapes: [
        { ty: 'rc', d: 1, s: { a: 0, k: [50, 50] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 10 }, nm: 'Rect', mn: 'ADBE Vector Shape - Rect' },
        { ty: 'fl', c: { a: 0, k: [0.43, 0.9, 0.71, 1] }, o: { a: 0, k: 100 }, r: 1, bm: 0, nm: 'Fill', mn: 'ADBE Vector Graphic - Fill' }
      ],
      ip: 0, op: 60, st: 0, bm: 0
    }
  ]
};

files.forEach(f => {
  fs.writeFileSync(path.join(lottiesDir, f), JSON.stringify(minimalLottie));
});

console.log('Created ' + files.length + ' placeholder Lottie files in ' + lottiesDir);
