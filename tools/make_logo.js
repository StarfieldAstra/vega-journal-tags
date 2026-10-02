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
 *
 * 设计说明：
 *   黑底圆角方块 + 白色四芒星。
 *   黑底取插件名 Vega（织女星）—— 夜空里的导航星，Historically 也是
 *   天文测光里的「星等零点」；白色四芒星是它最简洁的几何抽象：
 *   四条二次贝塞尔从尖端到尖端内凹收腰，比五角星更接近星芒的物理形态。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- 设计参数
// 坐标系统一为 512×512，最后按目标尺寸缩放 —— 改设计只动这里。
const BOX = 512;
const C = 256;

const DESIGN = {
  corner: 112,        // 背景圆角（≈22%，接近 iOS 图标的比例）
  bgInner: [21, 22, 26],   // 背景中心色（径向渐变的内圈）
  bgOuter: [5, 5, 7],      // 背景边缘色
  R: 150,             // 星芒尖端半径
  pinch: 0.42,        // 收腰指数：|x|^p + |y|^p = R^p 的 p。
                      // p=1 菱形，p→0 细长星芒。0.42 是「一眼是星、又够粗壮」的折中。
  ring: { r: 208, w: 5, opacity: 0.20 },    // 外围细环：暗指「星等」刻度
};

// ---------------------------------------------------------------- 几何
/**
 * 星形曲线：|x/R|^p + |y/R|^p = 1（超椭圆家族的 p<1 分支）
 * 之所以不用二次贝塞尔：贝塞尔从尖端到尖端，腰部最细只能到 ~0.35R，
 * 出来永远是「圆角菱形」而不是星芒；幂曲线要多少细由 p 直接控制，
 * 尖端锐利、腰部干净，且点内测试一行就能写完。
 */
function inStar(x, y, opts) {
  const k = (opts && opts.scale) || 1;
  const R = DESIGN.R * k;
  const dx = Math.abs(x - C) / R;
  const dy = Math.abs(y - C) / R;
  if (dx > 1 || dy > 1) return false;              // 快速排除
  const p = DESIGN.pinch;
  return Math.pow(dx, p) + Math.pow(dy, p) <= 1;
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

  // 外围细环 —— 只在 ≥48px 时画；再小它会糊成一圈灰，反而显脏
  if (opts.ring) {
    const rr = DESIGN.ring;
    const distC = Math.hypot(x - C, y - C);
    const dr = Math.abs(distC - rr.r) - rr.w / 2;
    if (dr < 0) { const w = rr.opacity; sr += 255 * w; sg += 255 * w; sb += 255 * w; sw += w; }
  }

  // 四芒星
  if (inStar(x, y, opts)) { sr += 255; sg += 255; sb += 255; sw += 1; }

  const w = Math.min(1, sw);
  // 抗锯齿：背景边缘用 smoothstep 淡出，避免圆角处出现硬锯齿
  const edge = d > -0.75 && d <= 0.75 ? 1 - (d + 0.75) / 1.5 : (d <= -0.75 ? 1 : 0);
  return [cr * (1 - w) + sr, cg * (1 - w) + sg, cb * (1 - w) + sb, Math.max(0, Math.min(1, edge))];
}

function render(size) {
  const SS = size <= 24 ? 10 : size <= 64 ? 6 : 4;   // 小图多采样，保证边缘干净
  // 小尺寸自适应：细环删掉、星体放大 —— 16px 的工具栏图标上，
  // 细环会退化成一圈脏灰，星体若还按 512 的比例只占三成就什么都看不清。
  const opts = size >= 48
    ? { ring: true }
    : { ring: false, scale: 1.14 };
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
