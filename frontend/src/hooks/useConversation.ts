import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  completeTrainingSession,
  createTrainingSession
} from "../api";
import {
  ConversationMessage,
  StartSessionForm,
  StartSessionResult,
  TrainingSession
} from "../types";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "stopped";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function useConversation() {
  const [sessionData, setSessionData] = useState<StartSessionResult | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TrainingSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setAnalysis(null);
    setError(null);
  }, []);

  const appendMessage = useCallback((message: ConversationMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const closeWebsocket = useCallback(() => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      websocketRef.current.close(1000, "Session ended");
    }
    websocketRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
      closeWebsocket();
    };
  }, [closeWebsocket, stopRecording]);

  const connectWebsocket = useCallback(async (signedUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const socket = new WebSocket(signedUrl);
        websocketRef.current = socket;

        socket.onopen = () => {
          setConnectionStatus("connected");
          resolve();
        };

        socket.onmessage = (event) => {
          if (typeof event.data === "string") {
            try {
              const payload = JSON.parse(event.data);
              if (payload.type === "agent_response" || payload.type === "response") {
                appendMessage({
                  speaker: "agent",
                  text: payload.text ?? payload.response ?? JSON.stringify(payload),
                  receivedAt: Date.now()
                });
              } else if (payload.type === "transcript" || payload.type === "user_transcript") {
                appendMessage({
                  speaker: "user",
                  text: payload.text ?? payload.transcript ?? JSON.stringify(payload),
                  receivedAt: Date.now()
                });
              } else if (payload.type === "error") {
                setError(payload.message ?? "Error from ElevenLabs conversation");
              }
            } catch (err) {
              console.error("Failed to parse websocket message", err);
            }
          }
        };

        socket.onerror = (event) => {
          console.error("WebSocket error", event);
          setError("Ошибка соединения с ElevenLabs WebSocket");
          setConnectionStatus("error");
        };

        socket.onclose = () => {
          setConnectionStatus("stopped");
        };
      } catch (err) {
        reject(err);
      }
    });
  }, [appendMessage]);

  const startStreamingAudio = useCallback(async () => {
    if (!websocketRef.current) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"
    });

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (event) => {
      if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!event.data || event.data.size === 0) {
        return;
      }

      const buffer = await event.data.arrayBuffer();
      const audio = arrayBufferToBase64(buffer);
      websocketRef.current.send(
        JSON.stringify({
          type: "audio_chunk",
          audio,
          encoding: "base64",
          format: "webm-opus"
        })
      );
    };

    recorder.start(250);
  }, []);

  const startSession = useCallback(
    async (form: StartSessionForm) => {
      setIsLoading(true);
      resetConversation();
      setConnectionStatus("connecting");

      try {
        const result = await createTrainingSession(form);
        setSessionData(result);
        await connectWebsocket(result.signed_ws_url);
        await startStreamingAudio();
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось создать тренировочную сессию"
        );
        setConnectionStatus("error");
      } finally {
        setIsLoading(false);
      }
    },
    [connectWebsocket, resetConversation, startStreamingAudio]
  );

  const stopSession = useCallback(() => {
    stopRecording();
    closeWebsocket();
  }, [closeWebsocket, stopRecording]);

  const conversationLog = useMemo(
    () => messages.map((m) => `${m.speaker.toUpperCase()}: ${m.text}`).join("\n"),
    [messages]
  );

  const completeSession = useCallback(async () => {
    if (!sessionData) {
      return;
    }
    setIsLoading(true);
    try {
      const completed = await completeTrainingSession(
        sessionData.session.id,
        conversationLog
      );
      setAnalysis(completed);
      return completed;
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось завершить тренировочную сессию"
      );
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [conversationLog, sessionData]);

  return {
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
  };
}

