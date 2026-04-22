export const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000";

const USER_ID_KEY = "pvs.userId";
export function getUserId(): string {
  let v = localStorage.getItem(USER_ID_KEY);
  if (!v) {
    v = "dr-" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(USER_ID_KEY, v);
  }
  return v;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getUserId(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; azure_configured: boolean }>("/api/health"),
  listSamples: () => request<any[]>("/api/encounters/samples"),
  listEncounters: () => request<any[]>("/api/encounters"),
  createEncounter: (body: any) => request<any>("/api/encounters", { method: "POST", body: JSON.stringify(body) }),
  createFromSample: (id: string) =>
    request<any>(`/api/encounters/from-sample/${encodeURIComponent(id)}`, { method: "POST" }),
  getEncounter: (id: string) => request<any>(`/api/encounters/${id}`),
  getArtifact: (id: string) => request<any>(`/api/artifacts/${id}`),
  patchArtifact: (id: string, content: any, reason?: string) =>
    request<any>(`/api/artifacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content, reason }),
    }),
  signoffArtifact: (id: string, comment: string, override = false) =>
    request<any>(`/api/artifacts/${id}/signoff`, {
      method: "POST",
      body: JSON.stringify({ comment, override_gaps: override }),
    }),
  audit: (id: string) => request<any[]>(`/api/encounters/${id}/audit`),
  transcribe: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/api/transcribe`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as { text: string };
  },
};
