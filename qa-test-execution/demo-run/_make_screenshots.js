// Generate solid-color PNGs as fake screenshots for the demo report.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(w, h, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * rowLen + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const root = __dirname;
const W = 320, H = 200;

const shots = [
  ['TC001', '01_form_filled.png',    [180, 220, 240]], // light blue
  ['TC001', '02_ticket_saved.png',   [200, 240, 200]], // light green
  ['TC002', '01_status_dropdown.png',[230, 230, 240]], // light gray
  ['TC002', '02_save_500.png',       [255, 200, 200]], // light red
  ['TC003', '01_assignee_picked.png',[230, 220, 250]], // lavender
  ['TC003', '02_assigned.png',       [200, 240, 220]], // mint
  ['TC004', '01_no_results.png',     [255, 220, 180]], // peach
  ['TC006', '01_badge_wrong.png',    [255, 240, 180]], // light yellow
];

for (const [tc, file, [r, g, b]] of shots) {
  const out = path.join(root, tc, 'screenshots', file);
  fs.writeFileSync(out, makePNG(W, H, r, g, b));
  console.log(`wrote ${tc}/${file}  rgb(${r},${g},${b})`);
}
