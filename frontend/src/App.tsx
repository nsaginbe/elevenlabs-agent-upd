import type { FormEvent } from "react";
import { useState } from "react";

import { useConversation } from "./hooks/useConversation";
import type { DifficultyLevel, ClientType, StartSessionForm } from "./types";

const difficultyOptions: DifficultyLevel[] = [
  "",
  "Лёгкий",
  "Средний",
  "Сложный",
  "Экспертный"
];

const clientTypeOptions: ClientType[] = [
  "",
  "Дружелюбный",
  "Скептик",
  "Агрессивный",
  "Безразличный",
  "Энтузиаст",
  "Рациональный",
  "Пассивно-агрессивный"
];

const formDefaults: StartSessionForm = {
  manager_name: "",
  product_description: "",
  difficulty_level: "",
  client_type: "",
  first_message: ""
};

export default function App() {
  const [form, setForm] = useState<StartSessionForm>(formDefaults);
  const {
    startSession,
    stopSession,
    completeSession,
    sessionData,
    messages,
    analysis,
    isLoading,
    connectionStatus,
    error,
    conversationLog
  } = useConversation();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await startSession(form);
  };

  const sessionActive = Boolean(
    sessionData && (connectionStatus === "connected" || connectionStatus === "connecting")
  );

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>MoonAI Voice Sales Trainer</h1>
        <p>
          Запусти тренировку с ИИ-клиентом ElevenLabs. Укажи продукт, уровень сложности и
          начни реальный голосовой диалог.
        </p>
      </header>

      <main className="app-content">
        <section className="card">
          <h2>Настройки сессии</h2>
          <form className="session-form" onSubmit={handleSubmit}>
            <label>
              Имя менеджера
              <input
                required
                placeholder="Анна Петрова"
                value={form.manager_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, manager_name: event.target.value }))
                }
              />
            </label>

            <label>
              Описание продукта
              <textarea
                rows={4}
                placeholder="Например: Платформа автоматизации лидов через ИИ-чатботов"
                value={form.product_description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, product_description: event.target.value }))
                }
              />
            </label>

            <label>
              Уровень сложности
              <select
                value={form.difficulty_level}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    difficulty_level: event.target.value as DifficultyLevel
                  }))
                }
              >
                {difficultyOptions.map((value) => (
                  <option key={value || "default"} value={value}>
                    {value || "Средний (по умолчанию)"}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Тип клиента
              <select
                value={form.client_type}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    client_type: event.target.value as ClientType
                  }))
                }
              >
                {clientTypeOptions.map((value) => (
                  <option key={value || "default"} value={value}>
                    {value || "Выберите тип клиента"}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Первое сообщение (опционально)
              <input
                type="text"
                placeholder="Например: Привет! Как дела?"
                value={form.first_message}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, first_message: event.target.value }))
                }
              />
            </label>

            <div className="form-actions">
              <button type="submit" disabled={isLoading}>
                {sessionActive ? "Перезапустить" : "Начать тренировку"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!sessionActive}
                onClick={stopSession}
              >
                Завершить разговор
              </button>
            </div>

            {error && <p className="error">{error}</p>}

            {sessionData && (
              <div className="session-meta">
                <p>
                  Статус соединения: <strong>{connectionStatus}</strong>
                </p>
                <p>
                  Conversation ID: <code>{sessionData.conversation_id}</code>
                </p>
              </div>
            )}
          </form>
        </section>

        <section className="card">
          <h2>Диалог в реальном времени</h2>
          <div className="conversation-log">
            {messages.length === 0 ? (
              <p className="muted">Сообщения появятся после подключения к разговору</p>
            ) : (
              messages.map((message) => (
                <div key={message.receivedAt + message.text} className={`bubble ${message.speaker}`}>
                  <div className="message-header">
                    <span className="speaker-label">
                      {message.speaker === "agent" ? "ИИ" : "Вы"}
                    </span>
                  </div>
                  <span className="message-text">{message.text}</span>
                </div>
              ))
            )}
          </div>

          {sessionActive && (
            <p className="hint">
              Включи микрофон при запросе браузера. После командного слова «Завершить» останови
              запись и нажми «Снять анализ».
            </p>
          )}

          <button
            type="button"
            className="accent"
            disabled={!sessionData || isLoading}
            onClick={async () => {
              try {
                await completeSession();
              } catch (err) {
                console.error(err);
              }
            }}
          >
            Снять анализ
          </button>
        </section>

        <section className="card">
          <h2>Анализ разговора</h2>
          {analysis ? (
            <div className="analysis">
              {(() => {
                let parsedAnalysis: {
                  score?: number;
                  strengths?: string[];
                  areas_for_improvement?: string[];
                  specific_feedback?: string;
                  key_moments?: string[];
                } | null = null;

                if (analysis.ai_analysis) {
                  try {
                    parsedAnalysis = JSON.parse(analysis.ai_analysis);
                  } catch (e) {
                    // If parsing fails, show raw text
                    console.warn("Failed to parse analysis JSON", e);
                  }
                }

                return (
                  <>
                    <div className="analysis-score">
                      <div className="score-circle">
                        <span className="score-value">{analysis.score ?? parsedAnalysis?.score ?? "—"}</span>
                        <span className="score-max">/10</span>
                      </div>
                    </div>

                    {parsedAnalysis ? (
                      <div className="analysis-details">
                        {parsedAnalysis.strengths && parsedAnalysis.strengths.length > 0 && (
                          <div className="analysis-section strengths">
                            <h3>✅ Сильные стороны</h3>
                            <ul>
                              {parsedAnalysis.strengths.map((strength, idx) => (
                                <li key={idx}>{strength}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {parsedAnalysis.areas_for_improvement && parsedAnalysis.areas_for_improvement.length > 0 && (
                          <div className="analysis-section improvements">
                            <h3>📈 Области для улучшения</h3>
                            <ul>
                              {parsedAnalysis.areas_for_improvement.map((area, idx) => (
                                <li key={idx}>{area}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {parsedAnalysis.specific_feedback && (
                          <div className="analysis-section feedback">
                            <h3>💬 Детальная обратная связь</h3>
                            <p>{parsedAnalysis.specific_feedback}</p>
                          </div>
                        )}

                        {parsedAnalysis.key_moments && parsedAnalysis.key_moments.length > 0 && (
                          <div className="analysis-section moments">
                            <h3>⭐ Ключевые моменты</h3>
                            <ul>
                              {parsedAnalysis.key_moments.map((moment, idx) => (
                                <li key={idx}>{moment}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="analysis-section feedback">
                        <h3>💬 Обратная связь</h3>
                        <p>{analysis.feedback ?? "—"}</p>
                      </div>
                    )}

                    {analysis.ai_analysis && (
                      <details className="raw-json">
                        <summary>📄 Показать JSON отчёт</summary>
                        <pre>{analysis.ai_analysis}</pre>
                      </details>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <p className="muted">Анализ появится после завершения разговора</p>
          )}
        </section>

        <section className="card">
          <h2>Лог разговора (черновик)</h2>
          <textarea readOnly rows={12} value={conversationLog} />
        </section>
      </main>

      <footer className="app-footer">
        <small>
          Подготовлено на базе ElevenLabs Conversational AI и OpenAI. Настрой .env и запусти
          backend (`uvicorn app.main:app --reload`) и фронтенд (`npm run dev`).
        </small>
      </footer>
    </div>
  );
}

