// 重难点字：练习时写错过的字，按用户保存在后端。misses 是写错过的练习次数。
export type HardWord = { char: string; misses: number; updatedAt: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 调用本模块后端的对内接口；登录 Cookie 由浏览器自动带上，网关负责校验。
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "请求失败");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  hardWords: () => request<HardWord[]>("/api/bishun/hard-words"),
  addMiss: (char: string) => request<HardWord>("/api/bishun/hard-words", { method: "POST", body: JSON.stringify({ char }) }),
  removeHardWord: (char: string) => request<void>(`/api/bishun/hard-words/${encodeURIComponent(char)}`, { method: "DELETE" }),
};
