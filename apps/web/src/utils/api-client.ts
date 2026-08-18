// wjz新建文件，新建原因：统一封装前端 API 请求客户端 requestJson，修改时间：2026-08-17。
// 文件内容概述：封装 fetch 请求并自动处理 JSON 解析与错误抛出。
// wjz新建文件结束。

export async function requestJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `请求失败 (${res.status})`);
  }
  return res.json();
}
