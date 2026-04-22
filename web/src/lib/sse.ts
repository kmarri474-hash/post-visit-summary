import { API_BASE } from "./api";

export type AgentEvent = {
  type: "node_started" | "node_completed" | "node_error" | "log" | "run_completed";
  node?: string;
  message?: string;
  data?: Record<string, any>;
};

/**
 * SSE streaming via POST using fetch + ReadableStream. EventSource only supports GET.
 */
export async function runEncounterSSE(
  encounterId: string,
  onEvent: (ev: AgentEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/encounters/${encounterId}/run`, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames may be separated by \n\n (LF) or \r\n\r\n (CRLF) depending on
    // the server library. `sse_starlette` uses CRLF. Find whichever comes first.
    while (true) {
      const lfIdx = buffer.indexOf("\n\n");
      const crlfIdx = buffer.indexOf("\r\n\r\n");
      let idx = -1;
      let sepLen = 0;
      if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx < lfIdx)) {
        idx = crlfIdx;
        sepLen = 4;
      } else if (lfIdx !== -1) {
        idx = lfIdx;
        sepLen = 2;
      }
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + sepLen);
      const lines = frame.split(/\r?\n/);
      let dataStr = "";
      let eventName = "message";
      for (const line of lines) {
        if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        else if (line.startsWith("event:")) eventName = line.slice(6).trim();
      }
      if (!dataStr) continue;
      try {
        const parsed = JSON.parse(dataStr) as AgentEvent;
        onEvent(parsed);
      } catch {
        onEvent({ type: eventName as any, message: dataStr });
      }
    }
  }
}
