import { useEffect, useState, useCallback } from "react";
import { fetchSessionHistory, fetchSessionHistoryCount, type SessionHistoryFilters } from "../api";
import type { TrainingSession } from "../types";

export function SessionHistory() {
  const [sessionHistory, setSessionHistory] = useState<TrainingSession[]>([]);
  const [historyFilters, setHistoryFilters] = useState<SessionHistoryFilters>({
    limit: 10,
    offset: 0,
    sort_by: "session_start",
    sort_order: "desc"
  });
  const [historyCount, setHistoryCount] = useState<number>(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedHistorySession, setSelectedHistorySession] = useState<TrainingSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessionHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setError(null);
    try {
      const [sessions, countData] = await Promise.all([
        fetchSessionHistory(historyFilters),
        fetchSessionHistoryCount({
          manager_name: historyFilters.manager_name,
          status: historyFilters.status
        })
      ]);
      setSessionHistory(sessions);
      setHistoryCount(countData.count);
    } catch (err) {
      console.error("Failed to load session history:", err);
      setError(err instanceof Error ? err.message : "Failed to load session history");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [historyFilters]);

  useEffect(() => {
    loadSessionHistory();
  }, [loadSessionHistory]);

  const handleFilterChange = (updates: Partial<SessionHistoryFilters>) => {
    setHistoryFilters(prev => ({ ...prev, ...updates, offset: 0 }));
  };

  const handlePageChange = (direction: "prev" | "next") => {
    const limit = historyFilters.limit || 10;
    const currentOffset = historyFilters.offset || 0;
    if (direction === "prev") {
      setHistoryFilters(prev => ({ ...prev, offset: Math.max(0, currentOffset - limit) }));
    } else {
      setHistoryFilters(prev => ({ ...prev, offset: currentOffset + limit }));
    }
  };

  const parseAnalysis = (analysisJson: string | null) => {
    if (!analysisJson) return null;
    try {
      return JSON.parse(analysisJson);
    } catch {
      return null;
    }
  };

  const currentPage = Math.floor((historyFilters.offset || 0) / (historyFilters.limit || 10)) + 1;
  const totalPages = Math.ceil(historyCount / (historyFilters.limit || 10));

  return (
    <section className="card">
      <h2>История сессий</h2>

      {error && <p className="error">{error}</p>}

      {/* Filters */}
      <div className="history-filters">
        <input
          type="text"
          placeholder="Фильтр по имени менеджера"
          value={historyFilters.manager_name || ""}
          onChange={(e) => handleFilterChange({ manager_name: e.target.value || undefined })}
        />
        <select
          value={historyFilters.status || ""}
          onChange={(e) => handleFilterChange({ status: e.target.value || undefined })}
        >
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="completed">Завершённые</option>
        </select>
        <select
          value={historyFilters.sort_by || "session_start"}
          onChange={(e) => handleFilterChange({ sort_by: e.target.value })}
        >
          <option value="session_start">По дате</option>
          <option value="score">По оценке</option>
          <option value="manager_name">По имени</option>
        </select>
        <select
          value={historyFilters.sort_order || "desc"}
          onChange={(e) => handleFilterChange({ sort_order: e.target.value as "asc" | "desc" })}
        >
          <option value="desc">По убыванию</option>
          <option value="asc">По возрастанию</option>
        </select>
      </div>

      {/* Session List */}
      {isLoadingHistory ? (
        <p>Загрузка...</p>
      ) : sessionHistory.length === 0 ? (
        <p className="muted">Нет сессий</p>
      ) : (
        <>
          <p style={{ marginBottom: "1rem" }}>Найдено сессий: {historyCount}</p>
          <div className="session-list">
            {sessionHistory.map((session) => (
              <div
                key={session.id}
                className={`session-item ${selectedHistorySession?.id === session.id ? "selected" : ""}`}
                onClick={() => setSelectedHistorySession(session.id === selectedHistorySession?.id ? null : session)}
              >
                <div className="session-item-header">
                  <div className="session-item-meta">
                    <span className="session-item-name">{session.manager_name}</span>
                    <span className="session-item-date">
                      {new Date(session.session_start).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  {session.score !== null && (
                    <span
                      className="session-item-score"
                      style={{
                        color:
                          session.score >= 7
                            ? "#10b981"
                            : session.score >= 5
                            ? "#f59e0b"
                            : "#ef4444"
                      }}
                    >
                      {session.score}/10
                    </span>
                  )}
                </div>
                <div className="session-item-details">
                  <span>Сложность: {session.difficulty_level || "—"}</span>
                  <span>Тип клиента: {session.client_type || "—"}</span>
                  <span>Статус: {session.status}</span>
                </div>
                {session.client_description && (
                  <div className="session-item-product">
                    Продукт: {session.client_description.substring(0, 100)}
                    {session.client_description.length > 100 ? "..." : ""}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="history-pagination">
            <button disabled={currentPage === 1} onClick={() => handlePageChange("prev")}>
              Назад
            </button>
            <span>
              Страница {currentPage} из {totalPages}
            </span>
            <button disabled={currentPage >= totalPages} onClick={() => handlePageChange("next")}>
              Вперёд
            </button>
          </div>
        </>
      )}

      {/* Selected Session Details */}
      {selectedHistorySession && (
        <div className="selected-session-details">
          <div className="selected-session-header">
            <h3>Детали сессии #{selectedHistorySession.id}</h3>
            <button onClick={() => setSelectedHistorySession(null)}>Закрыть</button>
          </div>

          {/* Settings */}
          <div>
            <h4>Настройки сессии:</h4>
            <div className="selected-session-settings">
              <div>
                <strong>Менеджер:</strong>
                <span>{selectedHistorySession.manager_name}</span>
              </div>
              <div>
                <strong>Продукт:</strong>
                <span>{selectedHistorySession.client_description || "—"}</span>
              </div>
              <div>
                <strong>Уровень сложности:</strong>
                <span>{selectedHistorySession.difficulty_level || "—"}</span>
              </div>
              <div>
                <strong>Тип клиента:</strong>
                <span>{selectedHistorySession.client_type || "—"}</span>
              </div>
              <div>
                <strong>Первое сообщение:</strong>
                <span>{selectedHistorySession.first_message || "—"}</span>
              </div>
              <div>
                <strong>Начало:</strong>
                <span>{new Date(selectedHistorySession.session_start).toLocaleString("ru-RU")}</span>
              </div>
              {selectedHistorySession.session_end && (
                <div>
                  <strong>Завершение:</strong>
                  <span>{new Date(selectedHistorySession.session_end).toLocaleString("ru-RU")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Conversation */}
          {selectedHistorySession.conversation_log && (
            <div className="selected-session-conversation">
              <h4>Разговор:</h4>
              <textarea readOnly rows={10} value={selectedHistorySession.conversation_log} />
            </div>
          )}

          {/* Analysis */}
          {selectedHistorySession.ai_analysis && (
            <div className="selected-session-analysis">
              <h4>Анализ:</h4>
              <div className="selected-session-analysis-content">
                {(() => {
                  const analysis = parseAnalysis(selectedHistorySession.ai_analysis);
                  if (analysis) {
                    return (
                      <>
                        {analysis.strengths && analysis.strengths.length > 0 && (
                          <div className="selected-session-analysis-section">
                            <strong style={{ color: "#10b981" }}>✅ Сильные стороны:</strong>
                            <ul>
                              {analysis.strengths.map((s: string, idx: number) => (
                                <li key={idx}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.areas_for_improvement && analysis.areas_for_improvement.length > 0 && (
                          <div className="selected-session-analysis-section">
                            <strong style={{ color: "#f59e0b" }}>📈 Области для улучшения:</strong>
                            <ul>
                              {analysis.areas_for_improvement.map((a: string, idx: number) => (
                                <li key={idx}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.key_moments && analysis.key_moments.length > 0 && (
                          <div className="selected-session-analysis-section">
                            <strong style={{ color: "#06b6d4" }}>⭐ Ключевые моменты:</strong>
                            <ul>
                              {analysis.key_moments.map((m: string, idx: number) => (
                                <li key={idx}>{m}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.specific_feedback && (
                          <div className="selected-session-analysis-section">
                            <strong>💬 Детальная обратная связь:</strong>
                            <p>{analysis.specific_feedback}</p>
                          </div>
                        )}
                      </>
                    );
                  } else {
                    return (
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", color: "#e2e8f0" }}>
                        {selectedHistorySession.ai_analysis}
                      </pre>
                    );
                  }
                })()}
              </div>
              {selectedHistorySession.score !== null && (
                <div className="selected-session-score">
                  <strong>Оценка: </strong>
                  <span
                    style={{
                      fontSize: "1.2rem",
                      fontWeight: "bold",
                      color:
                        selectedHistorySession.score >= 7
                          ? "#10b981"
                          : selectedHistorySession.score >= 5
                          ? "#f59e0b"
                          : "#ef4444"
                    }}
                  >
                    {selectedHistorySession.score}/10
                  </span>
                </div>
              )}
              {selectedHistorySession.feedback && (
                <div className="selected-session-feedback">
                  <strong>Фидбек:</strong>
                  <p>{selectedHistorySession.feedback}</p>
                </div>
              )}
            </div>
          )}

          {/* System Prompt (collapsible) */}
          {selectedHistorySession.session_system_prompt && (
            <details style={{ marginTop: "1rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: "bold", marginBottom: "0.5rem", color: "#cbd5f5" }}>
                📝 Системный промпт сессии
              </summary>
              <pre
                style={{
                  padding: "1rem",
                  backgroundColor: "rgba(15, 23, 42, 0.9)",
                  border: "1px solid rgba(148, 163, 184, 0.2)",
                  borderRadius: "8px",
                  fontSize: "0.8rem",
                  whiteSpace: "pre-wrap",
                  overflowX: "auto",
                  color: "#e2e8f0",
                  marginTop: "0.5rem"
                }}
              >
                {selectedHistorySession.session_system_prompt}
              </pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

