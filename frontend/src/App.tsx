import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import HanziWriter from "hanzi-writer";
import { alphabet, BRUSH, LINES, type GlyphData } from "./alphabet";
import { strokeNames } from "./strokeNames";
import { pinyinGlyph, readings } from "./pinyin";
import { api, type HardWord } from "./api";

type Mode = "hanzi" | "symbol";
type Tab = "hanzi" | "letter" | "digit" | "hard";
type Report = (s: string, done?: boolean) => void;
const DATA_URL = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1";
const examples = ["永", "人", "大", "小", "山", "水", "火", "木", "日", "月"];
const groups = [["大写", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], ["小写", "abcdefghijklmnopqrstuvwxyz"]];
const digits = "0123456789";
// 左侧的四个 tab：练什么内容、输入框接受什么、切过去时默认练哪个
const tabs: Record<Tab, { label: string; accepts: RegExp; hint: string; first: string }> = {
  hanzi: { label: "汉", accepts: /\p{Script=Han}/u, hint: "请输入一个汉字", first: "永" },
  letter: { label: "A", accepts: /^[A-Za-z]$/, hint: "请输入一个英文字母", first: "A" },
  digit: { label: "数", accepts: /^[0-9]$/, hint: "请输入一个数字", first: "0" },
  hard: { label: "重难", accepts: /^(\p{Script=Han}|[A-Za-z0-9])$/u, hint: "请输入一个汉字、字母或数字", first: "" },
};
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
const load = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* 无痕模式等情况下存不了，不影响使用 */ } };
const isHan = (c: string) => /\p{Script=Han}/u.test(c);
const loadRecent = (): string[] => { try { const v = JSON.parse(load("bishun-recent", "[]")); return Array.isArray(v) ? v.filter(c => typeof c === "string" && isHan(c)).slice(0, 10) : [] } catch { return [] } };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// 朗读一段中文；有的浏览器不触发 onend，所以按字数估一个最长等待时间
function speak(text: string) {
  return new Promise<void>(resolve => {
    const u = new SpeechSynthesisUtterance(text), timer = setTimeout(resolve, 900 + 380 * text.length);
    u.lang = "zh-CN"; u.rate = 0.95; u.onend = u.onerror = () => { clearTimeout(timer); resolve() };
    speechSynthesis.speak(u);
  });
}

// 和 Hanzi Writer 的 Positioner 一样换算：字形坐标的 y（向上）→ 画布上的 y
function toScreenY(y: number, w: number, h: number, padding: number) {
  const scale = Math.min((w - 2 * padding) / 1024, (h - 2 * padding) / 1024), yOffset = 124 * scale + padding + (h - 2 * padding - scale * 1024) / 2;
  return h - yOffset - y * scale;
}

function Grid() {
  return <svg className="practice-grid" viewBox="0 0 100 100" aria-hidden="true"><rect x="1" y="1" width="98" height="98" rx="5"/><path d="M50 1V99M1 50H99M1 1L99 99M99 1L1 99"/></svg>;
}

function FourLines({ w, h, padding, lines = LINES }: { w: number; h: number; padding: number; lines?: number[] }) {
  return <svg className="four-lines" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><rect x="1" y="1" width={w - 2} height={h - 2} rx="12"/>{lines.map((y, i) => <line key={y} x1="0" x2={w} y1={toScreenY(y, w, h, padding)} y2={toScreenY(y, w, h, padding)} className={i === 2 ? "base-line" : ""}/>)}</svg>;
}

function StrokeStrip({ strokes, fourLines }: { strokes: string[]; fourLines: boolean }) {
  return <section className="breakdown"><div className="section-heading"><h2>笔顺分解</h2><span>每一格新增一笔</span></div><div className="stroke-strip">{strokes.map((_, i) => <div className="stroke-card" key={i}><svg viewBox="0 0 1024 1024"><g transform="scale(1,-1) translate(0,-900)">{fourLines && LINES.map((y, k) => <line key={y} x1="0" x2="1024" y1={y} y2={y} className={k === 2 ? "mini-line base-line" : "mini-line"}/>)}{strokes.slice(0, i + 1).map((d, j) => <path key={j} d={d} className={j === i ? "current-stroke" : "past-stroke"}/>)}</g></svg><b>{i + 1}</b></div>)}</div></section>;
}

function Switch({ label, title, checked, disabled, onChange }: { label: string; title: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <label className="switch" title={title}><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}/><span aria-hidden="true"/>{label}</label>;
}

// 字帖随可用空间缩放：量出格子的实际大小，交给 Hanzi Writer
function useBoxSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!, measure = () => { const r = el.getBoundingClientRect(); setSize(s => Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }) };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, []);
  return size;
}

// Hanzi Writer 的笔刷宽度写死在库里，字母和拼音在它挂上 SVG 后改掉（改尺寸时会重新挂载，所以一直盯着）
function useThinBrush(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    if (!on) return;
    const el = ref.current!, thin = () => el.querySelectorAll("path[clip-path]").forEach(p => p.getAttribute("stroke-width") !== String(BRUSH) && p.setAttribute("stroke-width", String(BRUSH)));
    const mo = new MutationObserver(thin); mo.observe(el, { childList: true, subtree: true }); return () => mo.disconnect();
  }, [on]);
}

const letterStyle = { strokeColor: "#26374f", outlineColor: "#d5dde9", drawingColor: "#2563eb", drawingWidth: 8, highlightColor: "#f59e0b" };

// 汉字上方的拼音格：四线三格，加载后直接可以写，也可以单独演示；多音字可以切换读音
function PinyinBoard({ char, report }: { char: string; report: Report }) {
  const board = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), writer = useRef<HanziWriter | null>(null);
  const [list, setList] = useState<string[]>([]), [pick, setPick] = useState(0), size = useBoxSize(board);
  const py = list[pick], shape = useMemo(() => py ? pinyinGlyph(py) : null, [py]);
  useThinBrush(host, true);
  useEffect(() => { let alive = true; setList([]); setPick(0); readings(char).then(l => { if (alive) setList(l) }).catch(() => { if (alive) setList([]) }); return () => { alive = false } }, [char]);
  useEffect(() => {
    if (!py || !shape || !size.w) return;
    host.current!.replaceChildren();
    const r = host.current!.getBoundingClientRect(), glyph = shape.glyph;
    writer.current = HanziWriter.create(host.current!, py, { width: r.width, height: r.height, padding: 0, showOutline: true, showCharacter: false, strokeAnimationSpeed: 1, delayBetweenStrokes: 200, ...letterStyle, charDataLoader: () => glyph });
    quiz();
    return () => { writer.current = null; host.current?.replaceChildren() };
  }, [py, size.w > 0]);
  useEffect(() => { const r = host.current?.getBoundingClientRect(); if (r && writer.current) writer.current.updateDimensions({ width: r.width, height: r.height }) }, [size]);
  const animate = () => { const w = writer.current; w?.cancelQuiz(); report(`拼音 ${py}：正在逐笔演示…`); w?.animateCharacter({ onComplete: () => { if (writer.current !== w) return; report(`拼音 ${py}：演示完成，试着写一写`); setTimeout(() => writer.current === w && quiz(), 600) } }) };
  const quiz = () => { writer.current?.quiz({ leniency: 0.85, showHintAfterMisses: 2, highlightOnComplete: true, onMistake: () => report(`拼音 ${py}：这一笔不对，再试试`), onCorrectStroke: s => report(`拼音 ${py}：第 ${s.strokeNum + 1} 笔正确！`), onComplete: s => report(`拼音 ${py} 写对了！${s.totalMistakes ? `共调整了 ${s.totalMistakes} 次` : "一次就写对了"}`, true) }) };
  return <div className="pinyin-row">
    <div ref={board} className="pinyin-board">{size.w > 0 && <FourLines w={size.w} h={size.h} padding={0} lines={shape?.lines}/>}<div ref={host} className="writer-host"/>{!list.length && <span className="loading">正在查拼音…</span>}</div>
    <div className="pinyin-side">{list.length > 1 && <div className="pinyin-picks">{list.map((p, i) => <button key={p} className={i === pick ? "active" : ""} onClick={() => setPick(i)}>{p}</button>)}</div>}<div className="pinyin-actions"><button onClick={animate} disabled={!py} title="演示拼音笔顺">▶ 演示</button><button onClick={() => { report(`拼音 ${py}：先写字母，最后标声调`); quiz() }} disabled={!py} title="清掉已写的笔画，重新写拼音">✍ 练习</button></div></div>
  </div>;
}

function Practice({ mode, value, voice, setVoice, showPinyin, setShowPinyin, report, onLoaded, onMiss }: { mode: Mode; value: string; voice: boolean; setVoice: (v: boolean) => void; showPinyin: boolean; setShowPinyin: (v: boolean) => void; report: Report; onLoaded: (c: string) => void; onMiss: (c: string) => void }) {
  const board = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), writer = useRef<HanziWriter | null>(null), run = useRef(0), names = useRef<string[] | null>(null), missed = useRef(false), voiceOn = useRef(voice);
  voiceOn.current = voice;
  const [data, setData] = useState<GlyphData | null>(null), [loading, setLoading] = useState(true), size = useBoxSize(board);
  const letters = mode === "symbol", padding = letters ? 0 : 18, ready = size.w > 0;
  useThinBrush(host, letters);
  useEffect(() => {
    if (!ready) return;
    let alive = true; run.current++; missed.current = false; setLoading(true); setData(null); host.current?.replaceChildren();
    const r = host.current!.getBoundingClientRect();
    writer.current = HanziWriter.create(host.current!, value, {
      width: r.width, height: r.height, padding, showOutline: true, showCharacter: false, strokeAnimationSpeed: letters ? 1 : 1.2, delayBetweenStrokes: 260,
      ...(letters ? letterStyle : { strokeColor: "#555", outlineColor: "#ddd", drawingColor: "#2563eb", drawingWidth: 10, highlightColor: "#f59e0b" }),
      charDataLoader: char => (letters ? Promise.resolve(alphabet[char]) : fetch(`${DATA_URL}/${encodeURIComponent(char)}.json`).then(res => { if (!res.ok) throw Error(); return res.json() })).then(j => { if (alive) setData(j); return j }),
      onLoadCharDataError: () => { if (alive) { setLoading(false); report("暂不支持这个字，请换一个常用汉字") } },
      onLoadCharDataSuccess: () => { if (alive) { setLoading(false); quiz(); report("直接在格子里写，从第一笔开始；不会写就点“演示”"); onLoaded(value) } },
    });
    return () => { alive = false; run.current++; if (canSpeak) speechSynthesis.cancel(); writer.current = null; host.current?.replaceChildren() };
  }, [value, mode, ready]);
  // 提前取好笔画名称，点“演示”时就能马上开口
  useEffect(() => { let alive = true; names.current = null; if (data && !letters) strokeNames(value, data.medians).then(n => { if (alive) names.current = n }); return () => { alive = false } }, [data]);
  useEffect(() => { const r = host.current?.getBoundingClientRect(); if (r && writer.current) writer.current.updateDimensions({ width: r.width, height: r.height }) }, [size]);
  const stop = () => { run.current++; if (canSpeak) speechSynthesis.cancel(); writer.current?.cancelQuiz() };
  // 汉字开了笔画播报时逐笔演示：先报“第几笔、笔画名”，读完、这一笔也画完再进入下一笔。
  // 第一句要在点击里同步开始读，iPad 上不是用户操作直接触发的朗读会被拦下。
  const animate = async () => {
    stop(); const w = writer.current, token = run.current;
    if (!w || !data) return;
    // 演示完稍停一下，回到练习状态，不用再点按钮
    const after = () => { if (run.current !== token) return; report("演示完成，现在轮到你啦！"); setTimeout(() => run.current === token && quiz(), 600) };
    if (letters || !voice || !canSpeak) { report("正在逐笔演示…"); w.animateCharacter({ onComplete: after }); return }
    const say = (i: number) => { const text = names.current?.[i] ? `第${i + 1}笔，${names.current[i]}` : `第${i + 1}笔`; report(text.replace("，", "：")); return voiceOn.current ? speak(text) : Promise.resolve() };
    let speech = say(0);
    await w.hideCharacter();
    for (let i = 0; i < data.strokes.length; i++) {
      if (run.current !== token) return;
      if (i) speech = say(i);
      await Promise.all([speech, w.animateStroke(i)]);
      await wait(200);
    }
    after();
  };
  // 字帖一加载就进入练习。选一次字只在第一次写错时记进重难点，演示、重新练习后再错不重复记
  const quiz = () => { writer.current?.cancelQuiz(); writer.current?.quiz({ leniency: letters ? 0.85 : 1, showHintAfterMisses: 2, highlightOnComplete: true, onMistake: s => { report(`这一笔方向或位置不对，再试试（已提醒 ${s.totalMistakes} 次）`); if (!missed.current) { missed.current = true; onMiss(value) } }, onCorrectStroke: s => report(`第 ${s.strokeNum + 1} 笔正确！`), onComplete: s => report(`太棒了！${s.totalMistakes ? `共调整了 ${s.totalMistakes} 次` : "一次就写对了"}`, true) }) };
  return <>
    <div className="board-area" style={{ "--board": `${size.w}px` } as React.CSSProperties}>{!letters && showPinyin && <PinyinBoard char={value} report={report}/>}<div className="board-main"><div className={letters ? "board-stage letters" : "board-stage"}><div ref={board} className="board-wrap">{letters ? ready && <FourLines w={size.w} h={size.h} padding={padding}/> : <Grid/>}<div ref={host} className="writer-host"/>{loading && <span className="loading">正在准备字帖…</span>}</div>
    <div className="controls"><button onClick={animate} disabled={loading} title="逐笔演示笔顺">▶ 演示</button><button onClick={() => { stop(); quiz(); report("已清空，从第一笔开始书写") }} disabled={loading} title="清掉已写的笔画，重新写">✍ 练习</button>{!letters && <><Switch label="笔画播报" title={canSpeak ? "演示时读出每一笔的名称" : "当前浏览器不支持语音播报"} checked={voice && canSpeak} disabled={!canSpeak} onChange={v => { setVoice(v); if (!v && canSpeak) speechSynthesis.cancel() }}/><Switch label="拼音" title="在字帖上方显示拼音，拼音也能看笔顺、练习" checked={showPinyin} onChange={setShowPinyin}/></>}</div></div></div></div>
    {data && <StrokeStrip strokes={data.strokes} fourLines={letters}/>}
  </>;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("hanzi"), [value, setValue] = useState("永"), [draft, setDraft] = useState("永"), [group, setGroup] = useState(0), [message, setMessage] = useState("准备好了，先看动画，再动手写一写"), [stars, setStars] = useState(() => Number(load("bishun-stars", "0"))), [voice, setVoiceState] = useState(() => load("bishun-voice", "1") === "1"), [showPinyin, setPinyinState] = useState(() => load("bishun-pinyin", "0") === "1");
  const [recent, setRecent] = useState(loadRecent), [hard, setHard] = useState<HardWord[] | null>(null), searched = useRef("");
  useEffect(() => { api.hardWords().then(setHard).catch(() => setHard(null)) }, []);
  // 搜索过、并且能加载出来的汉字留在本机，显示在常用字前面
  const onLoaded = (c: string) => { if (c !== searched.current) return; searched.current = ""; setRecent(list => { const next = [c, ...list.filter(x => x !== c)].slice(0, 10); save("bishun-recent", JSON.stringify(next)); return next }) };
  const onMiss = (c: string) => { api.addMiss(c).then(w => setHard(list => [w, ...(list ?? []).filter(x => x.char !== w.char)])).catch(() => { /* 后端不可用时不影响练习 */ }) };
  const removeHard = (c: string) => { api.removeHardWord(c).then(() => setHard(list => list?.filter(x => x.char !== c) ?? null)).catch(() => setMessage("移出失败，请稍后再试")) };
  const report = (s: string, done = false) => { setMessage(s); if (done) setStars(n => { const x = n + 1; save("bishun-stars", String(x)); return x }) };
  const setVoice = (v: boolean) => { setVoiceState(v); save("bishun-voice", v ? "1" : "0") };
  const setShowPinyin = (v: boolean) => { setPinyinState(v); save("bishun-pinyin", v ? "1" : "0") };
  // 汉字和字母、数字用不同的字帖；重难点 tab 里按当前选中的字决定
  const mode: Mode = isHan(value) ? "hanzi" : "symbol";
  const select = (v: string) => { setValue(v); setDraft(v); const g = groups.findIndex(([, chars]) => chars.includes(v)); if (g >= 0) setGroup(g) };
  // 切 tab 时当前的字也属于这个 tab 就接着练，否则换成这个 tab 的第一个
  const switchTab = (t: Tab) => { if (t === tab) return; setTab(t); if (t !== "hard" && !tabs[t].accepts.test(value)) { select(tabs[t].first); setMessage(t === "hanzi" ? "选择一个汉字开始练习" : t === "letter" ? "选择一个字母开始练习" : "选择一个数字开始练习") } };
  const submit = (e: React.FormEvent) => { e.preventDefault(); const v = [...draft.trim()][0]; if (!v) return; if (!tabs[tab].accepts.test(v)) { setMessage(tabs[tab].hint); return } if (isHan(v)) searched.current = v; select(v) };
  const quick = [...new Set([...recent, ...examples])].slice(0, 15), current = hard?.find(w => w.char === value);
  const pick = (chars: string[]) => chars.map(c => <button key={c} className={c === value ? "selected" : ""} onClick={() => select(c)}>{c}</button>);
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="./icon.svg" alt=""/><span><strong>笔顺小课堂</strong><small>一笔一画，写好每个字</small></span></div><div className="stars" aria-label={`获得 ${stars} 颗星`}>★ {stars}</div></header>
    <main className="workspace">
      <aside className="picker card">
        <div className="picker-head">
          <nav className="mode-tabs">{(Object.keys(tabs) as Tab[]).map(t => <button key={t} className={t === tab ? "active" : ""} onClick={() => switchTab(t)}>{tabs[t].label}</button>)}</nav>
          <form onSubmit={submit}><input value={draft} maxLength={2} onChange={e => setDraft(e.target.value)} aria-label="练习内容" placeholder={tab === "hanzi" ? "输入汉字" : tab === "letter" ? "输入字母" : tab === "digit" ? "输入数字" : "输入要练的字"}/><button className="primary" type="submit">练习</button></form>
        </div>
        {tab === "hanzi" && <div className="quick-grid">{pick(quick)}</div>}
        {tab === "letter" && <><nav className="group-tabs">{groups.map(([label], i) => <button key={label} className={i === group ? "active" : ""} onClick={() => setGroup(i)}>{label}</button>)}</nav><div className="letter-picker">{pick([...groups[group][1]])}</div></>}
        {tab === "digit" && <div className="letter-picker">{pick([...digits])}</div>}
        {tab === "hard" && <section className="hard-words"><div className="section-heading"><h2>重难点</h2><span>{hard === null ? "暂时取不到，稍后再试" : hard.length ? `${hard.length} 个` : "写错的字会自动收进来"}</span></div>{hard && hard.length > 0 && <div className="hard-list">{hard.map(w => <button key={w.char} className={w.char === value ? "selected" : ""} onClick={() => select(w.char)} title={`错过 ${w.misses} 次`}>{w.char}<i>{w.misses}</i></button>)}</div>}</section>}
      </aside>
      <section className="practice card"><div className="practice-title"><div><span>正在练习</span><h2>{value}</h2>{current && <span className="hard-tag">重难点 · 错过 {current.misses} 次<button onClick={() => removeHard(value)}>已掌握，移出</button></span>}</div><p role="status">{message}</p></div><Practice key={mode} mode={mode} value={value} voice={voice} setVoice={setVoice} showPinyin={showPinyin} setShowPinyin={setShowPinyin} report={report} onLoaded={onLoaded} onMiss={onMiss}/></section>
    </main>
    <footer>笔顺引擎：Hanzi Writer（MIT） · 汉字数据：Make Me a Hanzi / Arphic Public License · 笔画名称：cnchar（MIT） · 拼音：pinyin-pro（MIT）</footer>
  </div>;
}
