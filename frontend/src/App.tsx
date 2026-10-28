import { useEffect, useLayoutEffect, useRef, useState } from "react";
import HanziWriter from "hanzi-writer";
import { alphabet, LINES, type GlyphData } from "./alphabet";
import { strokeNames } from "./strokeNames";

type Mode = "hanzi" | "symbol";
type Report = (s: string, done?: boolean) => void;
const DATA_URL = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1";
const examples = ["永", "人", "大", "小", "山", "水", "火", "木", "日", "月"];
const groups = [["大写", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], ["小写", "abcdefghijklmnopqrstuvwxyz"], ["数字", "0123456789"]];
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
const load = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* 无痕模式等情况下存不了，不影响使用 */ } };
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

function FourLines({ w, h, padding }: { w: number; h: number; padding: number }) {
  return <svg className="four-lines" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><rect x="1" y="1" width={w - 2} height={h - 2} rx="12"/>{LINES.map((y, i) => <line key={y} x1="0" x2={w} y1={toScreenY(y, w, h, padding)} y2={toScreenY(y, w, h, padding)} className={i === 2 ? "base-line" : ""}/>)}</svg>;
}

function StrokeStrip({ strokes, fourLines }: { strokes: string[]; fourLines: boolean }) {
  return <section className="breakdown"><div className="section-heading"><h2>笔顺分解</h2><span>每一格新增一笔</span></div><div className="stroke-strip">{strokes.map((_, i) => <div className="stroke-card" key={i}><svg viewBox="0 0 1024 1024"><g transform="scale(1,-1) translate(0,-900)">{fourLines && LINES.map((y, k) => <line key={y} x1="0" x2="1024" y1={y} y2={y} className={k === 2 ? "mini-line base-line" : "mini-line"}/>)}{strokes.slice(0, i + 1).map((d, j) => <path key={j} d={d} className={j === i ? "current-stroke" : "past-stroke"}/>)}</g></svg><b>{i + 1}</b></div>)}</div></section>;
}

function Practice({ mode, value, voice, setVoice, report }: { mode: Mode; value: string; voice: boolean; setVoice: (v: boolean) => void; report: Report }) {
  const board = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), writer = useRef<HanziWriter | null>(null), run = useRef(0), names = useRef<string[] | null>(null), voiceOn = useRef(voice);
  voiceOn.current = voice;
  const [data, setData] = useState<GlyphData | null>(null), [loading, setLoading] = useState(true), [size, setSize] = useState({ w: 0, h: 0 });
  const letters = mode === "symbol", padding = letters ? 0 : 18;
  // 字帖随可用空间缩放：量出格子的实际大小，交给 Hanzi Writer
  useLayoutEffect(() => {
    const el = board.current!, measure = () => { const r = el.getBoundingClientRect(); setSize(s => Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }) };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [mode]);
  const ready = size.w > 0;
  useEffect(() => {
    if (!ready) return;
    let alive = true; run.current++; setLoading(true); setData(null); host.current?.replaceChildren();
    const r = host.current!.getBoundingClientRect();
    writer.current = HanziWriter.create(host.current!, value, {
      width: r.width, height: r.height, padding, showOutline: true, showCharacter: false, strokeAnimationSpeed: letters ? 1 : 1.2, delayBetweenStrokes: 260,
      strokeColor: letters ? "#26374f" : "#555", outlineColor: letters ? "#d5dde9" : "#ddd", drawingColor: "#2563eb", drawingWidth: letters ? 8 : 10, highlightColor: "#f59e0b",
      charDataLoader: char => (letters ? Promise.resolve(alphabet[char]) : fetch(`${DATA_URL}/${encodeURIComponent(char)}.json`).then(res => { if (!res.ok) throw Error(); return res.json() })).then(j => { if (alive) setData(j); return j }),
      onLoadCharDataError: () => { if (alive) { setLoading(false); report("暂不支持这个字，请换一个常用汉字") } },
      onLoadCharDataSuccess: () => { if (alive) { setLoading(false); report("准备好了，点“开始练习”吧") } },
    });
    return () => { alive = false; run.current++; if (canSpeak) speechSynthesis.cancel(); writer.current = null; host.current?.replaceChildren() };
  }, [value, mode, ready]);
  // 提前取好笔画名称，点“动画演示”时就能马上开口
  useEffect(() => { let alive = true; names.current = null; if (data && !letters) strokeNames(value, data.medians).then(n => { if (alive) names.current = n }); return () => { alive = false } }, [data]);
  useEffect(() => { const r = host.current?.getBoundingClientRect(); if (r && writer.current) writer.current.updateDimensions({ width: r.width, height: r.height }) }, [size]);
  const stop = () => { run.current++; if (canSpeak) speechSynthesis.cancel(); writer.current?.cancelQuiz() };
  // 汉字开了笔画播报时逐笔演示：先报“第几笔、笔画名”，读完、这一笔也画完再进入下一笔。
  // 第一句要在点击里同步开始读，iPad 上不是用户操作直接触发的朗读会被拦下。
  const animate = async () => {
    stop(); const w = writer.current, token = run.current;
    if (!w || !data) return;
    if (letters || !voice || !canSpeak) { report("正在逐笔演示…"); w.animateCharacter({ onComplete: () => { if (run.current === token) report("演示完成，现在轮到你啦！") } }); return }
    const say = (i: number) => { const text = names.current?.[i] ? `第${i + 1}笔，${names.current[i]}` : `第${i + 1}笔`; report(text.replace("，", "：")); return voiceOn.current ? speak(text) : Promise.resolve() };
    let speech = say(0);
    await w.hideCharacter();
    for (let i = 0; i < data.strokes.length; i++) {
      if (run.current !== token) return;
      if (i) speech = say(i);
      await Promise.all([speech, w.animateStroke(i)]);
      await wait(200);
    }
    if (run.current === token) report("演示完成，现在轮到你啦！");
  };
  const quiz = () => { stop(); report("请从第一笔开始书写"); writer.current?.quiz({ leniency: letters ? 0.85 : 1, showHintAfterMisses: 2, highlightOnComplete: true, onMistake: s => report(`这一笔方向或位置不对，再试试（已提醒 ${s.totalMistakes} 次）`), onCorrectStroke: s => report(`第 ${s.strokeNum + 1} 笔正确！`), onComplete: s => report(`太棒了！${s.totalMistakes ? `共调整了 ${s.totalMistakes} 次` : "一次就写对了"}`, true) }) };
  return <>
    <div className="board-area"><div ref={board} className={letters ? "board-wrap letter-board" : "board-wrap"}>{letters ? ready && <FourLines w={size.w} h={size.h} padding={padding}/> : <Grid/>}<div ref={host} className="writer-host"/>{loading && <span className="loading">正在准备字帖…</span>}</div></div>
    <div className="controls"><button onClick={animate} disabled={loading}>▶ 动画演示</button><button className="primary" onClick={quiz} disabled={loading}>✍ 开始练习</button>{!letters && <label className="switch" title={canSpeak ? "动画演示时读出每一笔的名称" : "当前浏览器不支持语音播报"}><input type="checkbox" role="switch" checked={voice && canSpeak} disabled={!canSpeak} onChange={e => { setVoice(e.target.checked); if (!e.target.checked && canSpeak) speechSynthesis.cancel() }}/><span aria-hidden="true"/>笔画播报</label>}</div>
    {data && <StrokeStrip strokes={data.strokes} fourLines={letters}/>}
  </>;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("hanzi"), [value, setValue] = useState("永"), [draft, setDraft] = useState("永"), [group, setGroup] = useState(0), [message, setMessage] = useState("准备好了，先看动画，再动手写一写"), [stars, setStars] = useState(() => Number(load("bishun-stars", "0"))), [voice, setVoiceState] = useState(() => load("bishun-voice", "1") === "1");
  const report = (s: string, done = false) => { setMessage(s); if (done) setStars(n => { const x = n + 1; save("bishun-stars", String(x)); return x }) };
  const setVoice = (v: boolean) => { setVoiceState(v); save("bishun-voice", v ? "1" : "0") };
  const select = (v: string) => { setValue(v); setDraft(v); const g = groups.findIndex(([, chars]) => chars.includes(v)); if (g >= 0) setGroup(g) };
  const switchMode = (m: Mode) => { if (m === mode) return; setMode(m); select(m === "hanzi" ? "永" : "A"); setMessage(m === "hanzi" ? "选择一个汉字开始练习" : "选择一个字母或数字开始练习") };
  const submit = (e: React.FormEvent) => { e.preventDefault(); const v = [...draft.trim()][0]; if (!v) return; if (mode === "hanzi" && !/\p{Script=Han}/u.test(v)) { setMessage("请输入一个汉字"); return } if (mode === "symbol" && !/[A-Za-z0-9]/.test(v)) { setMessage("请输入一个英文字母或数字"); return } select(v) };
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img src="./icon.svg" alt=""/><span><strong>笔顺小课堂</strong><small>一笔一画，写好每个字</small></span></div><div className="stars" aria-label={`获得 ${stars} 颗星`}>★ {stars}</div></header>
    <main className="workspace">
      <aside className="picker card">
        <div className="picker-head">
          <nav className="mode-tabs"><button className={mode === "hanzi" ? "active" : ""} onClick={() => switchMode("hanzi")}>汉字笔顺</button><button className={mode === "symbol" ? "active" : ""} onClick={() => switchMode("symbol")}>字母与数字</button></nav>
          <form onSubmit={submit}><input value={draft} maxLength={2} onChange={e => setDraft(e.target.value)} aria-label="练习内容" placeholder={mode === "hanzi" ? "输入汉字" : "输入字母"}/><button className="primary" type="submit">练习</button></form>
        </div>
        {mode === "hanzi" ? <div className="quick-grid">{examples.map(c => <button key={c} className={c === value ? "selected" : ""} onClick={() => select(c)}>{c}</button>)}</div>
          : <><nav className="group-tabs">{groups.map(([label], i) => <button key={label} className={i === group ? "active" : ""} onClick={() => setGroup(i)}>{label}</button>)}</nav><div className="letter-picker">{[...groups[group][1]].map(c => <button key={c} className={c === value ? "selected" : ""} onClick={() => select(c)}>{c}</button>)}</div></>}
      </aside>
      <section className="practice card"><div className="practice-title"><div><span>正在练习</span><h2>{value}</h2></div><p role="status">{message}</p></div><Practice key={mode} mode={mode} value={value} voice={voice} setVoice={setVoice} report={report}/></section>
    </main>
    <footer>笔顺引擎：Hanzi Writer（MIT） · 汉字数据：Make Me a Hanzi / Arphic Public License · 笔画名称：cnchar（MIT）</footer>
  </div>;
}
