// Tiny client-side fetch helpers used by all module pages.

export async function apiGet<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `GET ${url} failed`);
  return r.json();
}

export async function apiSend<T = any>(url: string, method: string, body?: any): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error || `${method} ${url} failed`), { data: json, status: r.status });
  return json;
}

export const list = (resource: string, qs = "") => apiGet(`/api/crud/${resource}${qs ? `?${qs}` : ""}`);
export const create = (resource: string, body: any) => apiSend(`/api/crud/${resource}`, "POST", body);
export const update = (resource: string, id: number, body: any) => apiSend(`/api/crud/${resource}/${id}`, "PATCH", body);
export const remove = (resource: string, id: number) => apiSend(`/api/crud/${resource}/${id}`, "DELETE");
