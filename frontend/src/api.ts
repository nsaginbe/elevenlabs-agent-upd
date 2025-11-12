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

export interface SessionHistoryFilters {
  manager_name?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface SessionHistoryCountResponse {
  count: number;
}

export function fetchSessionHistory(filters?: SessionHistoryFilters) {
  const params = new URLSearchParams();
  if (filters?.manager_name) params.append("manager_name", filters.manager_name);
  if (filters?.status) params.append("status", filters.status);
  if (filters?.limit) params.append("limit", filters.limit.toString());
  if (filters?.offset) params.append("offset", filters.offset.toString());
  if (filters?.sort_by) params.append("sort_by", filters.sort_by);
  if (filters?.sort_order) params.append("sort_order", filters.sort_order);

  const queryString = params.toString();
  return request<TrainingSession[]>(`/api/sessions${queryString ? `?${queryString}` : ""}`);
}

export function fetchSessionHistoryCount(filters?: Pick<SessionHistoryFilters, "manager_name" | "status">) {
  const params = new URLSearchParams();
  if (filters?.manager_name) params.append("manager_name", filters.manager_name);
  if (filters?.status) params.append("status", filters.status);

  const queryString = params.toString();
  return request<SessionHistoryCountResponse>(`/api/sessions/count${queryString ? `?${queryString}` : ""}`);
}

