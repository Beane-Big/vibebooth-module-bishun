// 字母和数字的笔顺数据，做成 Hanzi Writer 的字形格式（strokes 轮廓 + medians 中线），
// 这样演示、描红判定和提示都和汉字共用同一个引擎。坐标沿用 Hanzi Writer：x 0–1024，y 向上，-124–900。
export type Point = [number, number];
export type GlyphData = { strokes: string[]; medians: Point[][] };

// 四线三格的四条线：第一线、第二线、第三线（基线）、第四线
export const LINES = [830, 530, 230, -70];
const WIDTH = 24; // 笔画半宽
// 演示动画的笔刷宽度。Hanzi Writer 固定用 200 宽的笔刷再按轮廓裁剪，字母笔画细、弯离得近（s、e），
// 宽笔刷会提前露出同一笔里还没写到的部分，所以字母要换成只比笔画略宽的笔刷
export const BRUSH = WIDTH * 2 + 16;

const line = (...p: Point[]) => p;
// 椭圆弧，角度按数学方向（逆时针为正），每 12° 取一个点
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Point[] {
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / 12)), out: Point[] = [];
  for (let i = 0; i <= n; i++) { const a = (from + (to - from) * i / n) * Math.PI / 180; out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]) }
  return out;
}
// 二次贝塞尔曲线
function curve(a: Point, c: Point, b: Point): Point[] {
  return Array.from({ length: 9 }, (_, i) => { const t = i / 8, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as Point });
}
// 把几段首尾相接的线连成一笔
const join = (...parts: Point[][]) => parts.reduce<Point[]>((all, p) => all.length && p.length && Math.hypot(all.at(-1)![0] - p[0][0], all.at(-1)![1] - p[0][1]) < 1 ? [...all, ...p.slice(1)] : [...all, ...p], []);

const upper: Record<string, Point[][]> = {
  A: [line([512, 830], [300, 230]), line([512, 830], [724, 230]), line([372, 430], [652, 430])],
  B: [line([320, 830], [320, 230]), join(line([320, 830], [540, 830]), arc(540, 680, 150, 150, 90, -90), line([540, 530], [330, 530], [565, 530]), arc(565, 380, 160, 150, 90, -90), line([565, 230], [320, 230]))],
  C: [arc(520, 530, 230, 300, 40, 320)],
  D: [line([320, 830], [320, 230]), join(line([320, 830], [470, 830]), arc(470, 530, 260, 300, 90, -90), line([470, 230], [320, 230]))],
  E: [line([320, 830], [320, 230]), line([320, 830], [700, 830]), line([320, 530], [650, 530]), line([320, 230], [710, 230])],
  F: [line([320, 830], [320, 230]), line([320, 830], [700, 830]), line([320, 530], [650, 530])],
  G: [join(arc(520, 530, 230, 300, 40, 340), line([736, 427], [736, 500])), line([580, 500], [736, 500])],
  H: [line([300, 830], [300, 230]), line([724, 830], [724, 230]), line([300, 530], [724, 530])],
  I: [line([400, 830], [624, 830]), line([512, 830], [512, 230]), line([400, 230], [624, 230])],
  J: [line([400, 830], [700, 830]), join(line([620, 830], [620, 380]), arc(470, 380, 150, 150, 0, -180))],
  K: [line([320, 830], [320, 230]), line([700, 830], [320, 450]), line([450, 580], [720, 230])],
  L: [line([320, 830], [320, 230], [700, 230])],
  M: [line([270, 830], [270, 230]), line([270, 830], [512, 300]), line([754, 830], [512, 300]), line([754, 830], [754, 230])],
  N: [line([300, 830], [300, 230]), line([300, 830], [724, 230]), line([724, 830], [724, 230])],
  O: [arc(512, 530, 250, 300, 90, 450)],
  P: [line([320, 830], [320, 230]), join(line([320, 830], [520, 830]), arc(520, 680, 160, 150, 90, -90), line([520, 530], [320, 530]))],
  Q: [arc(512, 530, 250, 300, 90, 450), line([590, 360], [770, 190])],
  R: [line([320, 830], [320, 230]), join(line([320, 830], [520, 830]), arc(520, 680, 160, 150, 90, -90), line([520, 530], [320, 530])), line([500, 530], [720, 230])],
  S: [join(arc(512, 680, 200, 150, 20, 270), arc(512, 380, 210, 150, 90, -160))],
  T: [line([292, 830], [732, 830]), line([512, 830], [512, 230])],
  U: [join(line([300, 830], [300, 430]), arc(512, 430, 212, 200, 180, 360), line([724, 430], [724, 830]))],
  V: [line([300, 830], [512, 230], [724, 830])],
  W: [line([230, 830], [360, 230], [512, 700], [664, 230], [794, 830])],
  X: [line([300, 830], [724, 230]), line([724, 830], [300, 230])],
  Y: [line([300, 830], [512, 530]), line([724, 830], [512, 530]), line([512, 530], [512, 230])],
  Z: [line([300, 830], [724, 830], [300, 230], [724, 230])],
};

const bowl = arc(500, 380, 140, 150, 20, 340); // a、d、g、q 左边的圆
const lower: Record<string, Point[][]> = {
  a: [bowl, line([640, 530], [640, 230])],
  b: [line([360, 830], [360, 230]), arc(500, 380, 140, 150, 165, -165)],
  c: [arc(512, 380, 140, 150, 40, 320)],
  d: [bowl, line([640, 830], [640, 230])],
  e: [join(line([372, 380], [652, 380]), arc(512, 380, 140, 150, 0, 320))],
  f: [join(arc(580, 730, 100, 100, 30, 180), line([480, 730], [480, 230])), line([390, 530], [620, 530])],
  g: [bowl, join(line([640, 530], [640, 30]), arc(500, 30, 140, 100, 0, -160))],
  h: [line([360, 830], [360, 230]), join(arc(500, 400, 140, 130, 170, 0), line([640, 400], [640, 230]))],
  i: [line([512, 530], [512, 230]), line([505, 665], [519, 630])],
  j: [join(line([560, 530], [560, 30]), arc(440, 30, 120, 100, 0, -160)), line([553, 665], [567, 630])],
  k: [line([360, 830], [360, 230]), line([640, 530], [370, 370], [650, 230])],
  l: [line([512, 830], [512, 230])],
  m: [line([300, 530], [300, 230]), join(arc(400, 430, 100, 100, 180, 0), line([500, 430], [500, 230])), join(arc(600, 430, 100, 100, 180, 0), line([700, 430], [700, 230]))],
  n: [line([370, 530], [370, 230]), join(arc(505, 410, 135, 120, 180, 0), line([640, 410], [640, 230]))],
  o: [arc(512, 380, 145, 150, 90, 450)],
  p: [line([370, 530], [370, -70]), arc(510, 380, 140, 150, 170, -170)],
  q: [bowl, line([640, 530], [640, -70])],
  r: [line([400, 530], [400, 230]), arc(530, 410, 130, 110, 180, 30)],
  s: [join(arc(512, 455, 130, 75, 20, 270), arc(512, 305, 135, 75, 90, -160))],
  t: [join(line([490, 730], [490, 300]), arc(560, 300, 70, 70, 180, 300)), line([400, 530], [620, 530])],
  u: [join(line([370, 530], [370, 340]), arc(505, 340, 135, 110, 180, 360), line([640, 340], [640, 530])), line([640, 530], [640, 230])],
  v: [line([370, 530], [512, 230], [654, 530])],
  w: [line([300, 530], [390, 230], [512, 450], [634, 230], [724, 530])],
  x: [line([380, 530], [644, 230]), line([644, 530], [380, 230])],
  y: [line([380, 530], [540, 240]), line([654, 530], [440, -70])],
  z: [line([380, 530], [644, 530], [380, 230], [644, 230])],
};

const digits: Record<string, Point[][]> = {
  "0": [arc(512, 530, 190, 300, 90, 450)],
  "1": [line([512, 830], [512, 230])],
  "2": [join(arc(512, 680, 180, 150, 160, -20), line([681, 629], [330, 230], [700, 230]))],
  "3": [join(arc(505, 690, 170, 140, 160, -90), arc(505, 390, 185, 160, 90, -160))],
  "4": [line([580, 830], [320, 400], [720, 400]), line([600, 760], [600, 230])],
  "5": [join(line([385, 830], [367, 524]), arc(505, 415, 180, 170, 140, -150)), line([385, 830], [690, 830])],
  "6": [join(curve([650, 810], [350, 760], [342, 380]), arc(512, 380, 170, 150, 180, 510))],
  "7": [line([320, 830], [700, 830], [470, 230])],
  "8": [join(arc(512, 680, 150, 150, 30, 270), arc(512, 380, 175, 150, 90, -270), arc(512, 680, 150, 150, -90, 30))],
  "9": [join(arc(512, 650, 170, 180, 0, 360), line([682, 650], [640, 230]))],
};

const r = (n: number) => Math.round(n);
// Hanzi Writer 判定时按“到中线各点的最近距离”算偏差，中线点要足够密，长直线也要拆成小段
function densify(m: Point[], step = 40) {
  return m.flatMap((b, i) => { if (!i) return [b]; const a = m[i - 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); return Array.from({ length: n }, (_, k) => [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n] as Point) });
}
// 由中线生成填充轮廓：每一段是一个矩形，每个点是一个圆，同方向绘制，nonzero 填充后就是一条粗细均匀、两头圆润的笔画
function outline(m: Point[]) {
  const ring = (pts: Point[]) => `M${pts.map(p => `${r(p[0])} ${r(p[1])}`).join("L")}Z`;
  const ccw = (pts: Point[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) >= 0 ? pts : pts.reverse();
  const disc = ([x, y]: Point) => ring(Array.from({ length: 16 }, (_, i) => [x + WIDTH * Math.cos(i * Math.PI / 8), y + WIDTH * Math.sin(i * Math.PI / 8)] as Point));
  const parts = m.map(disc);
  for (let i = 1; i < m.length; i++) {
    const [a, b] = [m[i - 1], m[i]], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len * WIDTH, ny = (b[0] - a[0]) / len * WIDTH;
    parts.push(ring(ccw([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]])));
  }
  return parts.join("");
}

// 由各笔中线生成 Hanzi Writer 的字形数据；拼音把几个字母拼起来后也用它
export const buildGlyph = (medians: Point[][]): GlyphData => ({ medians: medians.map(m => densify(m).map(([x, y]) => [r(x), r(y)] as Point)), strokes: medians.map(outline) });

// 小写字母的中线，拼音按它拼字母
export const lowerShapes = lower;
const all: Record<string, Point[][]> = { ...upper, ...lower, ...digits };
export const alphabet: Record<string, GlyphData> = Object.fromEntries(Object.entries(all).map(([k, medians]) => [k, buildGlyph(medians)]));
