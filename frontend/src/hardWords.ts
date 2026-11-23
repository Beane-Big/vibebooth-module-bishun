// 重难点只保存在当前浏览器，不关联平台账号。misses 是写错过的练习次数。
export type HardWord = { char: string; misses: number; updatedAt: string };
const storageKey = "bishun-hard-words";

// 缓存损坏或浏览器禁止读取时从空列表开始，避免影响正常练习。
export function loadHardWords(): HardWord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((word): word is HardWord => {
      if (!word || typeof word.char !== "string" || !/^(\p{Script=Han}|[A-Za-z0-9])$/u.test(word.char)
        || !Number.isSafeInteger(word.misses) || word.misses < 1
        || typeof word.updatedAt !== "string" || !Number.isFinite(Date.parse(word.updatedAt)) || seen.has(word.char)) return false;
      seen.add(word.char);
      return true;
    });
  } catch { return [] }
}

// 浏览器禁止存储或空间不足时保留本次页面中的数据，练习仍可继续。
export function saveHardWords(words: HardWord[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(words)) } catch { /* 与现有本地设置一致，存储失败不打断练习 */ }
}
