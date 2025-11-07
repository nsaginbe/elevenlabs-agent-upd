import { FormEvent, useState } from "react";

import { useConversation } from "./hooks/useConversation";
import { DifficultyLevel, StartSessionForm } from "./types";

const difficultyOptions: DifficultyLevel[] = [
  "",
  "Лёгкий",
  "Средний",
  "Сложный",
  "Экспертный"
];

const formDefaults: StartSessionForm = {
  manager_name: "",
  company_description: "",
  difficulty_level: ""
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
                value={form.company_description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, company_description: event.target.value }))
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
                  <span>{message.text}</span>
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
              <p>
                Оценка: <strong>{analysis.score ?? "—"}/10</strong>
              </p>
              <p>
                Обратная связь: <span>{analysis.feedback ?? "—"}</span>
              </p>
              <details>
                <summary>JSON отчёт</summary>
                <pre>{analysis.ai_analysis}</pre>
              </details>
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

