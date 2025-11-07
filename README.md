# MoonAI Voice Sales Trainer MVP

Минимально жизнеспособный продукт для тренировки продажников с помощью голосового ИИ-агента ElevenLabs и аналитики OpenAI.

## Архитектура

- **Backend (`backend/`)** — FastAPI + SQLAlchemy.
  - Создание и завершение тренировочных сессий.
  - Генерация signed WebSocket URL для ElevenLabs Conversational AI.
  - Сохранение журналов разговоров и оценка диалогов при помощи OpenAI.
- **Frontend (`frontend/`)** — React + Vite.
  - Форма запуска тренировки (имя менеджера, описание продукта, уровень сложности).
  - Отображение реального времени диалога и обработка WebSocket-сообщений.
  - Запрос голосового анализа и отображение результатов.

## Быстрый старт

1. **Зависимости**

   ```sh
   cd backend
   python -m venv .venv && .venv\Scripts\activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
   pip install -r requirements.txt

   cd ../frontend
   npm install
   ```

2. **Настрой переменные окружения**

   Создай файл `.env` рядом с `backend/app/main.py` (или в корне проекта) со значениями:

   ```ini
   ELEVENLABS_API_KEY=...
   ELEVENLABS_AGENT_ID=...
   OPENAI_API_KEY=...
   DATABASE_URL=sqlite:///./sales_training.db
   HOST=0.0.0.0
   PORT=8000
   DEBUG=true
   ```

   > Для разработки можно оставить `ELEVENLABS_AGENT_ID` пустым — backend вернёт заглушку `wss://example.invalid/...`.

3. **Запуск backend**

   ```sh
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

4. **Запуск frontend**

   ```sh
   cd frontend
   npm run dev -- --host
   ```

   Интерфейс будет доступен на `http://localhost:5173` (прокси на backend настроен автоматически).

## Основной пользовательский поток

1. Продажник заполняет имя, описание продукта и уровень сложности.
2. Приложение вызывает `POST /api/sessions`, backend:
   - Формирует системный промпт на основе `STRUCTURE.md`.
   - Запрашивает signed WebSocket URL у ElevenLabs.
   - Сохраняет сессию в БД.
3. Frontend подключается к WebSocket, запрашивает доступ к микрофону и отправляет аудио чанки.
4. Ответы агента и транскрипты отображаются в UI.
5. По завершении разговора пользователь нажимает «Снять анализ» — фронт отправляет разговор в `POST /api/sessions/{id}/complete`.
6. Backend прогоняет диалог через OpenAI и сохраняет оценку/фидбек.

## Папки и ключевые файлы

- `backend/app/routes/sessions.py` — REST-эндпоинты для сессий.
- `backend/app/elevenlabs_service.py` — создание signed WebSocket URL (с fallback).
- `backend/app/analysis_service.py` — интеграция с OpenAI для постанализа.
- `frontend/src/hooks/useConversation.ts` — управление подключением к ElevenLabs и записью микрофона.
- `frontend/src/App.tsx` — основной UI.

## Следующие шаги

- Подменить заглушку ElevenLabs реальным подписанным URL (проверить структуру ответа API).
- Добавить обработку бинарных ответов (аудио) и визуализацию прогресса.
- Интегрировать автоматическое завершение при ключевом слове «Завершить».
- Добавить авторизацию и сохранение записей / отчетов по пользователям.

