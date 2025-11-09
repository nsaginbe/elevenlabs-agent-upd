import type { StartSessionForm, StartSessionResult, TrainingSession } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${input}`, {
    mode: "cors",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });

  if (!response.ok) {
    let message: string | null = null;
    try {
      const data = await response.clone().json();
      message = typeof data?.detail === "string" ? data.detail : JSON.stringify(data);
    } catch (jsonError) {
      message = await response.text();
    }
    throw new Error(message || "Request failed");
  }

  return response.json() as Promise<T>;
}

export function createTrainingSession(payload: StartSessionForm) {
  return request<StartSessionResult>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchTrainingSession(sessionId: number) {
  return request<TrainingSession>(`/api/sessions/${sessionId}`);
}

export function completeTrainingSession(sessionId: number, conversationLog: string) {
  return request<TrainingSession>(`/api/sessions/${sessionId}/complete`, {
    method: "POST",
    body: JSON.stringify({ conversation_log: conversationLog })
  });
}

