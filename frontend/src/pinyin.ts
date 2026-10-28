// 拼音的四线三格字形：读音来自 pinyin-pro（MIT），字母用 alphabet.ts 的小写字母笔顺拼起来，
// 先按顺序写字母（ü 的两点跟着 u 写），最后标声调，和小学拼音书写的顺序一致。
import { buildGlyph, LINES, lowerShapes, type GlyphData, type Point } from "./alphabet";

const GAP = 70; // 字母之间的距离
const MAX_WIDTH = 2300; // 拼音格是宽的，字形可以超出 0–1024；超过这个宽度就整体缩小
const CENTER_Y = 380; // 缩小时以 x 高度的中线为准，四条线跟着一起缩
// 声调符号，以所在元音的中心为原点；二声从左下往右上，四声从左上往右下，三声先下后上
const TONES: Record<string, Point[]> = {
  "̄": [[-80, 660], [80, 660]],
  "́": [[-50, 620], [60, 730]],
  "̌": [[-75, 730], [0, 620], [75, 730]],
  "̀": [[-60, 730], [50, 620]],
};
const DOTS: Point[][] = [[[-52, 668], [-46, 634]], [[48, 668], [54, 634]]]; // ü 上的两点

export type PinyinGlyph = { glyph: GlyphData; lines: number[] };

let lib: Promise<typeof import("pinyin-pro")> | undefined;
// 一个汉字的所有读音，常用的在前
export async function readings(char: string): Promise<string[]> {
  lib ??= import("pinyin-pro");
  const { pinyin } = await lib;
  return [...new Set(pinyin(char, { multiple: true, type: "array" }) as string[])].filter(p => /^[a-zǜ-̌]+$/u.test(p.normalize("NFD")));
}

export function pinyinGlyph(py: string): PinyinGlyph {
  const letters: { base: string; marks: string }[] = [];
  for (const c of py.normalize("NFD")) { if (/\p{M}/u.test(c) && letters.length) letters.at(-1)!.marks += c; else letters.push({ base: c, marks: "" }) }
  const strokes: Point[][] = [], tones: Point[][] = [];
  let cursor = 0;
  for (const { base, marks } of letters) {
    const tone = [...marks].find(m => TONES[m]), umlaut = marks.includes("̈");
    let shape = lowerShapes[base] ?? [];
    if (base === "i" && tone) shape = shape.slice(0, 1); // 标了声调的 i 不写点
    const xs = shape.flat().map(p => p[0]), minX = Math.min(...xs), maxX = Math.max(...xs), dx = cursor - minX, cx = (minX + maxX) / 2 + dx;
    strokes.push(...shape.map(m => m.map(([x, y]) => [x + dx, y] as Point)));
    if (umlaut) strokes.push(...DOTS.map(m => m.map(([x, y]) => [x + cx, y] as Point)));
    if (tone) tones.push(TONES[tone].map(([x, y]) => [x + cx, y + (umlaut ? 110 : 0)] as Point));
    cursor += maxX - minX + GAP;
  }
  const width = cursor - GAP, s = Math.min(1, MAX_WIDTH / width);
  const fit = ([x, y]: Point): Point => [512 + (x - width / 2) * s, CENTER_Y + (y - CENTER_Y) * s];
  return { glyph: buildGlyph([...strokes, ...tones].map(m => m.map(fit))), lines: LINES.map(y => CENTER_Y + (y - CENTER_Y) * s) };
}
