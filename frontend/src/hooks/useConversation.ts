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
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingAudioRef = useRef(false);

  const resetConversation = useCallback(() => {
    setMessages([]);
    setAnalysis(null);
    setError(null);
  }, []);

  const appendMessage = useCallback((message: ConversationMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  // Инициализация AudioContext для воспроизведения
  const getPlaybackAudioContext = useCallback(() => {
    if (!playbackAudioContextRef.current) {
      playbackAudioContextRef.current = createAudioContext();
    }
    return playbackAudioContextRef.current;
  }, []);

  // Воспроизведение аудио из ArrayBuffer
  const playPCMAudio = useCallback(async (audioData: ArrayBuffer | ArrayBufferLike) => {
    // Конвертируем в ArrayBuffer если нужно
    let buffer: ArrayBuffer;
    if (audioData instanceof ArrayBuffer) {
      buffer = audioData;
    } else {
      // Для SharedArrayBuffer или TypedArray - создаем новый ArrayBuffer и копируем
      const uint8 = new Uint8Array(audioData);
      const newBuffer = new ArrayBuffer(uint8.length);
      new Uint8Array(newBuffer).set(uint8);
      buffer = newBuffer;
    }
    
    if (buffer.byteLength === 0) {
      console.warn("[Conversation] Empty audio buffer received");
      return;
    }
    
    try {
      const context = getPlaybackAudioContext();
      await context.resume();

      // Сначала пробуем декодировать как сжатый аудио (MP3, AAC и т.д.)
      try {
        const audioBuffer = await context.decodeAudioData(buffer.slice(0));
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(context.destination);
        source.start(0);
        
        console.info("[Conversation] Playing decoded audio (MP3/AAC/etc)", {
          duration: audioBuffer.duration.toFixed(2) + "s",
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels,
          bufferSize: buffer.byteLength
        });
        return;
      } catch (decodeError) {
        // Если не удалось декодировать как сжатый формат, пробуем PCM
        console.debug("[Conversation] Not a compressed format, trying PCM", decodeError);
      }

      // Пробуем декодировать как PCM 16-bit
      const possibleSampleRates = [24000, 22050, 44100, 16000];
      const bytesPerSample = 2; // 16-bit PCM
      const numSamples = buffer.byteLength / bytesPerSample;
      
      if (numSamples <= 0 || !Number.isInteger(numSamples)) {
        console.error("[Conversation] Invalid PCM data size", {
          bufferSize: buffer.byteLength,
          numSamples
        });
        return;
      }
      
      // Пробуем декодировать как PCM с разными sample rates
      let audioBuffer: AudioBuffer | null = null;
      let usedSampleRate = 24000;
      
      for (const sampleRate of possibleSampleRates) {
        try {
          audioBuffer = context.createBuffer(1, numSamples, sampleRate);
          const channelData = audioBuffer.getChannelData(0);
          
          // Конвертируем 16-bit PCM в Float32Array
          const int16Array = new Int16Array(buffer);
          for (let i = 0; i < numSamples && i < channelData.length; i++) {
            channelData[i] = int16Array[i] / 32768.0;
          }
          usedSampleRate = sampleRate;
          break;
        } catch (err) {
          console.debug(`[Conversation] Failed to create buffer with ${sampleRate}Hz, trying next...`);
        }
      }
      
      if (!audioBuffer) {
        console.error("[Conversation] Failed to create audio buffer with any sample rate");
        return;
      }

      // Воспроизводим
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);
      source.start(0);

      console.info("[Conversation] Playing PCM audio chunk", {
        samples: numSamples,
        sampleRate: usedSampleRate,
        duration: (numSamples / usedSampleRate).toFixed(2) + "s",
        bufferSize: buffer.byteLength
      });
    } catch (err) {
      console.error("[Conversation] Failed to play audio", err, {
        bufferSize: buffer.byteLength
      });
    }
  }, [getPlaybackAudioContext]);

  // Обработка бинарных аудио чанков
  const handleAgentAudioChunk = useCallback((audioData: ArrayBuffer) => {
    playPCMAudio(audioData);
  }, [playPCMAudio]);

  // Обработка base64 аудио
  const handleAgentAudioBase64 = useCallback((base64Audio: string) => {
    try {
      // Декодируем base64 в ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      playPCMAudio(bytes.buffer);
    } catch (err) {
      console.error("[Conversation] Failed to decode base64 audio", err);
    }
  }, [playPCMAudio]);

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

    if (playbackAudioContextRef.current) {
      const context = playbackAudioContextRef.current;
      playbackAudioContextRef.current = null;
      context.close().catch((closeError) => {
        console.warn("[Conversation] Playback AudioContext close error", closeError);
      });
    }

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;
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
        // Настраиваем для приема бинарных данных
        socket.binaryType = "arraybuffer";
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
              }
            };

            if (conversation_config_override && Object.keys(conversation_config_override).length > 0) {
              initiationPayload.conversation_config_override = conversation_config_override;
            }

            if (dynamic_variables && Object.keys(dynamic_variables).length > 0) {
              initiationPayload.dynamic_variables = dynamic_variables;
            }

            console.info("[Conversation] Sending initiation payload", initiationPayload);
            socket.send(JSON.stringify(initiationPayload));
          } catch (sendError) {
            console.error("[Conversation] Failed to send initiation payload", sendError);
          }
          setConnectionStatus("connected");
          resolve();
        };

        socket.onmessage = (event) => {
          // Обработка бинарных данных (аудио)
          if (event.data instanceof ArrayBuffer) {
            console.info("[Conversation] Received binary audio data", {
              size: event.data.byteLength,
              type: "ArrayBuffer"
            });
            handleAgentAudioChunk(event.data);
            return;
          }
          
          // Также проверяем Blob (может быть обернут в Blob)
          if (event.data instanceof Blob) {
            console.info("[Conversation] Received Blob audio data", {
              size: event.data.size,
              type: event.data.type
            });
            event.data.arrayBuffer().then((buffer) => {
              handleAgentAudioChunk(buffer);
            });
            return;
          }
          
          // Логируем все входящие сообщения для отладки
          console.log("[Conversation] Incoming message", {
            data: event.data,
            type: typeof event.data,
            length: typeof event.data === "string" ? event.data.length : "N/A"
          });
          
          if (typeof event.data === "string") {
            try {
              const payload = JSON.parse(event.data);
              
              // Логируем все типы сообщений для отладки
              console.log("[Conversation] Parsed payload", {
              type: payload.type,
              keys: Object.keys(payload),
              hasAudio: !!(payload.audio || payload.agent_audio_chunk || payload.audio_chunk),
              fullPayload: payload
            });
              
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
                // Извлекаем текст из agent_response_event.agent_response или других возможных полей
                const agentText = payload.agent_response_event?.agent_response 
                  ?? payload.agent_response 
                  ?? payload.text 
                  ?? payload.response 
                  ?? "";
                
                if (agentText) {
                  appendMessage({
                    speaker: "agent",
                    text: agentText,
                    receivedAt: Date.now()
                  });
                }
                
                // Проверяем, есть ли аудио в этом же событии
                const audioInResponse = payload.agent_response_event?.audio
                  ?? payload.agent_response_event?.audio_chunk
                  ?? payload.audio
                  ?? payload.audio_chunk;
                
                if (audioInResponse && typeof audioInResponse === "string") {
                  console.info("[Conversation] Found audio in agent_response", {
                    audioLength: audioInResponse.length
                  });
                  handleAgentAudioBase64(audioInResponse);
                }
              } else if (payload.type === "audio") {
                // Обработка аудио в base64 формате из audio_event
                const audioBase64 = payload.audio_event?.audio_base_64
                  ?? payload.audio_event?.audio_base64
                  ?? payload.audio_event?.audio
                  ?? payload.audio 
                  ?? payload.agent_audio_chunk 
                  ?? payload.audio_chunk
                  ?? payload.data;
                
                if (audioBase64 && typeof audioBase64 === "string") {
                  console.info("[Conversation] Received base64 audio from audio_event", {
                    type: payload.type,
                    length: audioBase64.length,
                    eventId: payload.audio_event?.event_id
                  });
                  handleAgentAudioBase64(audioBase64);
                } else {
                  console.warn("[Conversation] Audio event received but no audio data found", {
                    payloadKeys: Object.keys(payload),
                    audioEventKeys: payload.audio_event ? Object.keys(payload.audio_event) : null
                  });
                }
              } else if (payload.type === "agent_audio_chunk" || payload.type === "audio_chunk") {
                // Обработка других форматов аудио
                const audioBase64 = payload.agent_audio_chunk 
                  ?? payload.audio_chunk
                  ?? payload.data;
                
                if (audioBase64 && typeof audioBase64 === "string") {
                  console.info("[Conversation] Received base64 audio", {
                    type: payload.type,
                    length: audioBase64.length
                  });
                  handleAgentAudioBase64(audioBase64);
                }
              } else if (payload.audio_chunk || payload.agent_audio) {
                // Проверяем другие возможные поля с аудио
                const audioData = payload.audio_chunk ?? payload.agent_audio;
                if (typeof audioData === "string") {
                  console.info("[Conversation] Found audio in payload", Object.keys(payload));
                  handleAgentAudioBase64(audioData);
                }
              } else if (payload.type === "user_transcription" || payload.type === "transcript" || payload.type === "user_transcript") {
                // Извлекаем текст из user_transcription_event.user_transcript или других возможных полей
                const userText = payload.user_transcription_event?.user_transcript 
                  ?? payload.user_transcript 
                  ?? payload.transcript 
                  ?? payload.text 
                  ?? "";
                
                if (userText) {
                  appendMessage({
                    speaker: "user",
                    text: userText,
                    receivedAt: Date.now()
                  });
                }
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
  }, [appendMessage, handleAgentAudioChunk, handleAgentAudioBase64]);

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
      // Создаем новый ArrayBuffer для совместимости типов
      const bufferSlice = new ArrayBuffer(pcmData.byteLength);
      new Uint8Array(bufferSlice).set(new Uint8Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength));
      const audioChunk = arrayBufferToBase64(bufferSlice);

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

