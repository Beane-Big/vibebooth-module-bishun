// 汉字笔画名称：笔顺编码来自 cnchar-order（MIT），每个字母代表一种笔画。
// 编码里有几种“一码两名”的笔画（例如 e 是横撇或横钩），按 Hanzi Writer 数据里这一笔的中线形状区分。
type Median = [number, number][];

const names: Record<string, string | ((m: Median) => string)> = {
  j: "横", f: "竖", s: "撇", l: "捺", k: "点", d: "点", i: "提", c: "横折", r: "横折钩", g: "竖钩", b: "竖弯", o: "横斜钩",
  a: "横折折撇", n: "撇折", z: "竖折折钩", t: "弯钩", p: "横折提", q: "横折折折", h: "竖提", m: "撇点", u: "竖弯钩",
  e: m => tailRatio(m) < 0.3 ? "横钩" : "横撇",
  x: m => { const c = corners(m), a = c.length ? m[c.at(-1)!] : m[0], b = m.at(-1)!; return a[0] - b[0] > 0.3 * Math.abs(a[1] - b[1]) ? "竖折撇" : "竖折折" },
  y: m => { const a = m[0], b = m.at(-1)!; return Math.abs(a[1] - b[1]) > 0.5 * Math.abs(a[0] - b[0]) ? "斜钩" : "卧钩" },
  v: m => corners(m).length >= 2 ? "横折折" : "横折弯",
  w: m => { const c = corners(m); return c.length > 1 && flatRun(m.slice(c[1])) ? "横折折折钩" : "横撇弯钩" },
};

// 把中线按固定间隔重新取点，原始数据的点疏密不一，直接比较相邻点的方向不可靠
function resample(m: Median, step = 8) {
  const out: Median = [m[0]];
  for (let i = 1; i < m.length; i++) {
    const [ax, ay] = m[i - 1], [bx, by] = m[i], n = Math.floor(Math.hypot(bx - ax, by - ay) / step);
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}
const angle = (a: [number, number], b: [number, number]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const turn = (a: number, b: number) => Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
// 急转的拐点（在约 40 个单位的笔段里转过 60° 以上），返回它们在重取点后中线里的位置；圆滑的“弯”不算
function corners(median: Median) {
  const m = resample(median), w = 5, found: number[] = [];
  for (let i = w; i < m.length - w; i++) {
    const d = turn(angle(m[i - w], m[i]), angle(m[i], m[i + w]));
    if (d < Math.PI / 3) continue;
    const last = found.at(-1);
    if (last !== undefined && i - last <= 2 * w) { if (d > turn(angle(m[last - w], m[last]), angle(m[last], m[last + w]))) found[found.length - 1] = i }
    else found.push(i);
  }
  return found.map(i => m[i]).map(p => median.reduce((best, q, j) => Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(median[best][0] - p[0], median[best][1] - p[1]) ? j : best, 0));
}
// 有没有一段向右的横（乃的第二折是横，阝的弯是斜着向右下）
function flatRun(m: Median) {
  const r = resample(m);
  for (let i = 0; i + 8 < r.length; i++) { const a = angle(r[i], r[i + 8]); if (Math.abs(a) < Math.PI / 7) return true }
  return false;
}
// 最大拐点之后那一段占整笔长度的比例：横钩的钩很短，横撇的撇很长
function tailRatio(m: Median) {
  const len = (s: Median) => s.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0), c = corners(m);
  return c.length ? len(m.slice(c[0])) / (len(m) || 1) : 1;
}

let orders: Promise<Record<string, string>> | undefined;

// 返回每一笔的名称；没有编码或笔画数和字形数据对不上时返回 null，只播报“第几笔”。
export async function strokeNames(char: string, medians: Median[]): Promise<string[] | null> {
  orders ??= import("./data/stroke-orders.json").then(m => m.default as Record<string, string>).catch(() => { orders = undefined; return {} });
  const code = (await orders)[char];
  if (!code || code.length !== medians.length) return null;
  return [...code].map((c, i) => { const n = names[c]; return typeof n === "function" ? n(medians[i]) : n ?? "" });
}
