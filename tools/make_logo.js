/**
 * Vega logo —— 矢量设计 → PNG 图标（纯 Node，无第三方依赖）
 *
 * 为什么不用浏览器截图 / 图片库：
 *   logo 是全矢量图形，自己栅格化能拿到精确的抗锯齿边缘，
 *   且 PNG 由本文件手写编码，同一套代码在任何环境都能重跑出同样的图。
 *
 * 用法：
 *   node tools/make_logo.js            # 生成全部尺寸
 *   node tools/make_logo.js 512        # 只生成某尺寸，便于对比
 *   node tools/make_logo.js 512 --stroke=104 --wide=176 --slant=0.04
 *                                      # 调参试样（只影响本次输出）
 *
 * 设计说明（v2，2026-10）：
 *   学习 ZCode（智谱 AI 编辑器）的 logo 语言 —— 近黑圆角方块 + 一枚白色
 *   超粗体几何字母，除此之外无任何装饰。ZCode 用首字母 Z，Vega 用首字母 V：
 *   等宽笔画 + 斜接尖角（miter join），字怀干净，远看是一块白色箭头形，
 *   近看是 V。星芒/圆环等天文意象全部舍弃 —— 极简字形即品牌。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- 设计参数
// 坐标系统一为 512×512，最后按目标尺寸缩放 —— 改设计只动这里。
const BOX = 512;
const C = 256;

const DESIGN = {
  corner: 112,             // 背景圆角（≈22%，接近 iOS 图标的比例）
  bgInner: [22, 23, 27],   // 背景中心色（径向渐变的内圈）
  bgOuter: [10, 10, 13],   // 背景边缘色
  // —— 白色字母 V（三线段折线 A→B→C 的等宽描边 + 斜接）——
  yTop: 116,               // 顶边 y
  yApex: 396,              // 尖角 y
  halfW: 162,              // 半宽：顶左角 (C-halfW, yTop)，顶右角 (C+halfW, yTop)
  stroke: 112,             // 笔画宽（垂直于笔画方向量取）——ZCode 的 Z 笔画极粗，
                           // 16px 小图上细笔画会糊，112 在各尺寸都立得住
  shear: 0.0,              // 整体斜切量（x' = x - shear*(y-C)），0 = 正体
};

// CLI 参数覆盖（调参试样用）：--stroke=104 --wide=176 --slant=0.04
for (const a of process.argv.slice(3)) {
  const m = a.match(/^--(stroke|wide|slant)=(.+)$/);
  if (!m) continue;
  const v = parseFloat(m[2]);
  if (m[1] === 'stroke') DESIGN.stroke = v;
  if (m[1] === 'wide') DESIGN.halfW = v;
  if (m[1] === 'slant') DESIGN.shear = v;
}

// ---------------------------------------------------------------- 几何
/**
 * 字母 V = 折线 (C-halfW, yTop) → (C, yApex) → (C+halfW, yTop) 的等宽描边。
 * 外轮廓 = 路径左侧（V 的外部）+ 尖角外斜接；
 * 内轮廓 = 路径右侧 + 尖角内斜接（字怀）。
 * 全是闭多边形 + 射线法点内测试，无贝塞尔、无字体依赖。
 */
const LETTER_POLY = (() => {
  const A = [C - DESIGN.halfW, DESIGN.yTop];
  const B = [C, DESIGN.yApex];
  const D = [C + DESIGN.halfW, DESIGN.yTop];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
  const len = (v) => Math.hypot(v[0], v[1]);
  const norm = (v) => { const l = len(v); return [v[0] / l, v[1] / l]; };
  // 左法线（路径前进方向逆时针 90°）
  const left = (u) => [-u[1], u[0]];

  const u1 = norm(sub(B, A));          // 左臂方向（下行）
  const u2 = norm(sub(D, B));          // 右臂方向（上行）
  const n1 = left(u1), n2 = left(u2);  // 外侧法线
  const half = DESIGN.stroke / 2;

  // 尖角斜接：角平分线方向 × 1/cos(半角)
  const bis = norm([n1[0] + n2[0], n1[1] + n2[1]]);
  const cosHalf = bis[0] * n1[0] + bis[1] * n1[1];
  const miter = half / cosHalf;

  return [
    [A[0] + n1[0] * half, A[1] + n1[1] * half],   // 顶左外
    [B[0] + bis[0] * miter, B[1] + bis[1] * miter], // 尖角外（斜接）
    [D[0] + n2[0] * half, D[1] + n2[1] * half],   // 顶右外
    [D[0] - n2[0] * half, D[1] - n2[1] * half],   // 顶右内
    [B[0] - bis[0] * miter, B[1] - bis[1] * miter], // 字怀尖（内斜接）
    [A[0] - n1[0] * half, A[1] - n1[1] * half],   // 顶左内
  ];
})();

/** 射线法点内测试（多边形顶点顺时针/逆时针均可） */
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inLetter(x, y, opts) {
  const k = (opts && opts.scale) || 1;
  if (k !== 1) { x = C + (x - C) / k; y = C + (y - C) / k; }
  if (DESIGN.shear) x = x + DESIGN.shear * (y - C);
  return inPoly(x, y, LETTER_POLY);
}

/** 圆角矩形的内部/边界判定（返回到边界的有符号距离，≤0 表示在内部） */
function roundedRectDist(x, y, half, r) {
  const dx = Math.abs(x - C) - (half - r);
  const dy = Math.abs(y - C) - (half - r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

// ---------------------------------------------------------------- 采样渲染
/** 单个采样点返回颜色 [r,g,b] 与背景是否命中（作为 alpha） */
function sample(x, y, opts) {
  const half = BOX / 2;
  const d = roundedRectDist(x, y, half, DESIGN.corner);
  if (d > 0.75) return null;                       // 在背景之外 → 透明
  // 背景：径向渐变
  const t = Math.min(1, Math.hypot(x - C, y - C * 0.92) / (BOX * 0.72));
  const i = DESIGN.bgInner, o = DESIGN.bgOuter;
  let cr = o[0] + (i[0] - o[0]) * (1 - t);
  let cg = o[1] + (i[1] - o[1]) * (1 - t);
  let cb = o[2] + (i[2] - o[2]) * (1 - t);
  let sr = 0, sg = 0, sb = 0, sw = 0;              // 白色图元的累计权重

  // 字母 V
  if (inLetter(x, y, opts)) { sr += 255; sg += 255; sb += 255; sw += 1; }

  const w = Math.min(1, sw);
  // 抗锯齿：背景边缘用 smoothstep 淡出，避免圆角处出现硬锯齿
  const edge = d > -0.75 && d <= 0.75 ? 1 - (d + 0.75) / 1.5 : (d <= -0.75 ? 1 : 0);
  return [cr * (1 - w) + sr, cg * (1 - w) + sg, cb * (1 - w) + sb, Math.max(0, Math.min(1, edge))];
}

function render(size) {
  const SS = size <= 24 ? 10 : size <= 64 ? 6 : 4;   // 小图多采样，保证边缘干净
  // 小尺寸自适应：字宽放大 —— 16px 的工具栏图标上，笔画按 512 比例会糊成一块
  const opts = { scale: size >= 48 ? 1.0 : size >= 32 ? 1.06 : 1.14 };
  const out = new Uint8Array(size * size * 4);
  const scale = BOX / size;
  let p = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) * scale;
          const py = (y + (sy + 0.5) / SS) * scale;
          const c = sample(px, py, opts);
          hits++;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += c[3]; }
        }
      }
      out[p++] = Math.round(r / hits);
      out[p++] = Math.round(g / hits);
      out[p++] = Math.round(b / hits);
      out[p++] = Math.round((a / hits) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------- PNG 编码
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
/** 写 8-bit RGBA PNG（filter 0，交给 zlib 压） */
function writePNG(file, size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, o);
    o += size * 4;
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/** 黑底铺满的版本（商店封面要求不透明） */
function opacify(rgba, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(rgba[i * 4 + k] * a + 0 * (1 - a));
    out[i * 4 + 3] = 255;
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- 主流程
(function main() {
  const only = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const ext = path.join(__dirname, '..', 'extension');
  const rel = path.join(__dirname, '..', 'release');
  if (!fs.existsSync(rel)) fs.mkdirSync(rel, { recursive: true });

  // 扩展图标必须接受：Chrome 把这四处尺寸用于工具栏/管理页/商店
  const targets = only
    ? [{ size: only, file: path.join(rel, `logo-${only}.png`) }]
    : [
        { size: 16, file: path.join(ext, 'icon16.png') },
        { size: 32, file: path.join(ext, 'icon32.png') },
        { size: 48, file: path.join(ext, 'icon48.png') },
        { size: 128, file: path.join(ext, 'icon128.png') },
        { size: 128, file: path.join(rel, 'logo-black-128.png') },
        { size: 300, file: path.join(rel, 'store-logo-300.png') },
        { size: 1024, file: path.join(rel, 'logo-1024.png') },
      ];

  for (const t of targets) {
    const rgba = render(t.size);
    // 铺满黑底的版本
    const solid = opacify(rgba, t.size);
    const use = /store-logo|logo-black/.test(path.basename(t.file)) ? solid : rgba;
    const bytes = writePNG(t.file, t.size, use);
    console.log(
      `${path.relative(path.join(__dirname, '..'), t.file).padEnd(34)} ${String(t.size).padStart(4)}px  ${(bytes / 1024).toFixed(1)} KB`
    );
  }
})();
