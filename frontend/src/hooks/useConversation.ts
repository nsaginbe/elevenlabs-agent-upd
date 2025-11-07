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

const TARGET_SAMPLE_RATE = 16000;

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * sampleRateRatio);
    const end = Math.floor((i + 1) * sampleRateRatio);
    let sum = 0;
    let count = 0;

    for (let j = start; j < end && j < buffer.length; j += 1) {
      sum += buffer[j];
      count += 1;
    }

    result[i] = count > 0 ? sum / count : 0;
  }

  return result;
}

function floatTo16BitPCM(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return result;
}

function createAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("AudioContext is not available in this environment");
  }

  const AudioContextConstructor = (window.AudioContext || window.webkitAudioContext) as typeof AudioContext | undefined;

  if (!AudioContextConstructor) {
    throw new Error("AudioContext is not supported in this browser");
  }

  return new AudioContextConstructor();
}

export function useConversation() {
  const [sessionData, setSessionData] = useState<StartSessionResult | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TrainingSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setAnalysis(null);
    setError(null);
  }, []);

  const appendMessage = useCallback((message: ConversationMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const stopRecording = useCallback(() => {
    processorNodeRef.current?.disconnect();
    processorNodeRef.current = null;

    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;

    if (audioContextRef.current) {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      context.close().catch((closeError) => {
        console.warn("[Conversation] AudioContext close error", closeError);
      });
    }

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

  const connectWebsocket = useCallback(async (sessionResult: StartSessionResult) => {
    const { signed_ws_url: signedUrl, conversation_config_override, dynamic_variables } = sessionResult;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      try {
        console.info("[Conversation] Opening WebSocket", { url: signedUrl });
        const socket = new WebSocket(signedUrl);
        websocketRef.current = socket;

        socket.onopen = () => {
          console.info("[Conversation] WebSocket connected");
          settled = true;
          try {
            const initiationPayload: Record<string, unknown> = {
              type: "conversation_initiation_client_data",
              source_info: {
                source: "python_sdk",
                version: "2.22.0"
              },
              custom_llm_extra_body: null
            };

            if (conversation_config_override && Object.keys(conversation_config_override).length > 0) {
              initiationPayload.conversation_config_override = conversation_config_override;
            }

            initiationPayload.dynamic_variables = dynamic_variables && Object.keys(dynamic_variables).length > 0 ? dynamic_variables : {};

            console.info("[Conversation] Sending initiation payload", initiationPayload);
            socket.send(JSON.stringify(initiationPayload));
          } catch (sendError) {
            console.error("[Conversation] Failed to send initiation payload", sendError);
          }
          setConnectionStatus("connected");
          resolve();
        };

        socket.onmessage = (event) => {
          console.debug("[Conversation] Incoming message", event.data);
          if (typeof event.data === "string") {
            try {
              const payload = JSON.parse(event.data);
              if (payload.type === "conversation_initiation_metadata") {
                console.info("[Conversation] Conversation metadata", payload);
              } else if (payload.type === "ping" && payload.ping_event?.event_id) {
                const pong = {
                  type: "pong",
                  event_id: payload.ping_event.event_id
                };
                console.debug("[Conversation] Responding with pong", pong);
                socket.send(JSON.stringify(pong));
              } else if (payload.type === "agent_response" || payload.type === "response") {
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
              } else {
                console.warn("[Conversation] Unhandled message type", payload);
              }
            } catch (err) {
              console.error("Failed to parse websocket message", err);
            }
          }
        };

        socket.onerror = (event) => {
          console.error("[Conversation] WebSocket error", event);
          setError("Ошибка соединения с ElevenLabs WebSocket");
          setConnectionStatus("error");
          if (!settled) {
            settled = true;
            reject(new Error("WebSocket error"));
          }
        };

        socket.onclose = (event) => {
          console.info("[Conversation] WebSocket closed", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
          setConnectionStatus("stopped");
          if (!settled) {
            settled = true;
            reject(new Error("WebSocket closed before initialization"));
          }
        };
      } catch (err) {
        console.error("[Conversation] Failed to open WebSocket", err);
        settled = true;
        reject(err);
      }
    });
  }, [appendMessage]);

  const startStreamingAudio = useCallback(async () => {
    if (!websocketRef.current) {
      console.warn("[Conversation] Attempted to start audio before websocket ready");
      return;
    }

    console.info("[Conversation] Requesting microphone access");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TARGET_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    mediaStreamRef.current = stream;

    const audioContext = createAudioContext();
    audioContextRef.current = audioContext;
    await audioContext.resume();

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const gain = audioContext.createGain();
    gain.gain.value = 0;

    processorNodeRef.current = processor;
    gainNodeRef.current = gain;

    let chunkCounter = 0;

    processor.onaudioprocess = (event) => {
      if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      const inputBuffer = event.inputBuffer.getChannelData(0);
      if (!inputBuffer) {
        return;
      }

      const downsampled = downsampleBuffer(inputBuffer, audioContext.sampleRate, TARGET_SAMPLE_RATE);
      const pcmData = floatTo16BitPCM(downsampled);
      const audioChunk = arrayBufferToBase64(pcmData.buffer);

      if (chunkCounter % 10 === 0) {
        console.debug("[Conversation] Sending audio chunk", {
          chunkIndex: chunkCounter,
          pcmLength: pcmData.length,
          base64Length: audioChunk.length
        });
      }
      chunkCounter += 1;

      websocketRef.current.send(
        JSON.stringify({
          user_audio_chunk: audioChunk
        })
      );
    };

    source.connect(processor);
    processor.connect(gain);
    gain.connect(audioContext.destination);

    console.info("[Conversation] Audio context initialized", {
      inputSampleRate: audioContext.sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE
    });
  }, []);

  const startSession = useCallback(
    async (form: StartSessionForm) => {
      console.info("[Conversation] Starting session", form);
      setIsLoading(true);
      resetConversation();
      setConnectionStatus("connecting");

      try {
        const result = await createTrainingSession(form);
        setSessionData(result);
        console.info("[Conversation] Session created", result);
        await connectWebsocket(result);
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
    console.info("[Conversation] Stopping session");
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
    console.info("[Conversation] Completing session", sessionData.session.id);
    setIsLoading(true);
    try {
      const completed = await completeTrainingSession(
        sessionData.session.id,
        conversationLog
      );
      setAnalysis(completed);
      console.info("[Conversation] Analysis received", completed.id, completed.score);
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
      console.info("[Conversation] Complete session finished");
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

