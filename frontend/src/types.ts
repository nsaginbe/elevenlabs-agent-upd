export type DifficultyLevel = "Лёгкий" | "Средний" | "Сложный" | "Экспертный" | "";

export interface TrainingSession {
  id: number;
  manager_name: string;
  session_start: string;
  session_end: string | null;
  conversation_log: string | null;
  ai_analysis: string | null;
  score: number | null;
  feedback: string | null;
  status: string;
  company_description: string | null;
  difficulty_level: string | null;
  session_system_prompt: string | null;
  signed_ws_url: string | null;
  conversation_id: string | null;
}

export interface StartSessionForm {
  manager_name: string;
  company_description: string;
  difficulty_level: DifficultyLevel;
}

export interface ConversationMessage {
  speaker: "agent" | "user" | "system";
  text: string;
  receivedAt: number;
}

export interface StartSessionResult {
  session: TrainingSession;
  signed_ws_url: string;
  conversation_id: string | null;
  session_system_prompt: string;
  conversation_config_override?: Record<string, unknown> | null;
  dynamic_variables?: Record<string, unknown> | null;
}

