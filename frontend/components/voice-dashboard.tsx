"use client";

import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import {
  API_BASE_URL,
  confirmVoiceIntentPlan,
  getDeviceCommandStatus,
  getVoiceIntentUserReplyAudio,
  listRecentVoiceIntents,
  pingBackend,
  sendVoiceIntentPreview,
  type BackendConnectionState,
  type DeviceCommandDelivery,
  type MqttLightPayload,
  type VoiceIntentAuditRecord,
  type VoiceIntentConfirmResponse,
  type VoiceIntentResponse,
} from "@/lib/backend-api";

type DeviceCard = {
  id: DeviceDetailId;
  title: string;
  buttonLabel: string;
  count: number;
  description: string;
  status: string;
  items: string[];
  tone: string;
  Icon: (props: { className?: string }) => ReactElement;
};

type DeviceDetailId = "lights" | "doors" | "cameras" | "drones";
type ActiveDetail = "ia" | DeviceDetailId;
type DebugLogLevel = "info" | "success" | "warning" | "error";
type AiSpeechStatus = "idle" | "loading" | "playing" | "paused" | "error" | "unavailable";
type DebugLogEntry = {
  id: string;
  timestamp: string;
  level: DebugLogLevel;
  message: string;
  details?: string;
};

type LightCommandView = {
  espacio?: string;
  accion?: string;
};

const SILENT_AUDIO_MIN_BYTES = 1500;
const SILENT_AUDIO_PEAK_THRESHOLD = 0.03;

type DetailDashboardConfig = {
  id: DeviceDetailId;
  eyebrow: string;
  title: string;
  description: string;
  aiMessage: string;
  metrics: Array<{ label: string; value: string }>;
  items: Array<{ name: string; status: string; meta: string }>;
  actions: [string, string];
};

const devices: DeviceCard[] = [
  {
    id: "lights",
    title: "Luces por ambiente",
    buttonLabel: "Entrar a Luces por ambiente",
    count: 4,
    description: "Un ESP32 multiambiente puede controlar sala, cocina, comedor y dormitorio; MQTT legacy sigue disponible para Luces.",
    status: "4 ambientes mapeados",
    items: ["Sala", "Cocina", "Comedor", "Dormitorio"],
    tone: "text-[#9edfff] bg-[#44c7f4]/10 border-[#44c7f4]/20",
    Icon: LightIcon,
  },
  {
    id: "doors",
    title: "Puertas conectadas",
    buttonLabel: "Entrar a Puertas conectadas",
    count: 4,
    description: "Control visual del perimetro y de los puntos de entrada.",
    status: "3 cerradas / 1 monitoreada",
    items: ["Puerta frontal", "Cuarto tecnico", "Porton lateral"],
    tone: "text-[#ffe0a3] bg-[#f6c563]/10 border-[#f6c563]/20",
    Icon: DoorIcon,
  },
  {
    id: "cameras",
    title: "Camaras conectadas",
    buttonLabel: "Entrar a Camaras conectadas",
    count: 6,
    description: "Vision del sistema lista para crecer con nuevos modulos.",
    status: "4 en linea / 2 en standby",
    items: ["Entrada", "Patio", "Zona de pruebas"],
    tone: "text-[#b4f4be] bg-[#8ee89d]/10 border-[#8ee89d]/20",
    Icon: CameraIcon,
  },
  {
    id: "drones",
    title: "Drones",
    buttonLabel: "Entrar drones",
    count: 2,
    description: "Unidades aereas listas para vigilancia y recorridos autonomos.",
    status: "1 activo / 1 en carga",
    items: ["Drone patio", "Drone perimetro"],
    tone: "text-[#d8c7ff] bg-[#9b7cff]/10 border-[#9b7cff]/20",
    Icon: DroneIcon,
  },
];

const dashboardCards: Array<{
  detail: DeviceDetailId;
  device: DeviceCard;
  className: string;
}> = [
  {
    detail: "cameras",
    device: devices[2],
    className: "order-2 xl:order-none xl:col-start-2 xl:row-start-1",
  },
  {
    detail: "lights",
    device: devices[0],
    className: "order-3 xl:order-none xl:col-start-2 xl:row-start-2",
  },
  {
    detail: "doors",
    device: devices[1],
    className: "order-4 xl:order-none xl:col-start-2 xl:row-start-3",
  },
  {
    detail: "drones",
    device: devices[3],
    className: "order-5 xl:order-none xl:col-start-2 xl:row-start-4",
  },
];

const detailDashboards: Record<DeviceDetailId, DetailDashboardConfig> = {
  cameras: {
    id: "cameras",
    eyebrow: "vision conectada",
    title: "Dashboard de camaras",
    description: "Supervisa las camaras conectadas y revisa puntos clave del sistema.",
    aiMessage: "La IA sigue orquestando la vision y prioriza eventos relevantes.",
    metrics: [
      { label: "En linea", value: "4" },
      { label: "Standby", value: "2" },
      { label: "Eventos", value: "12" },
    ],
    items: [
      { name: "Camara entrada", status: "En linea", meta: "Vista principal" },
      { name: "Camara patio", status: "En linea", meta: "Movimiento activo" },
      { name: "Zona de pruebas", status: "Standby", meta: "Monitoreo bajo demanda" },
    ],
    actions: ["Ver camara", "Capturar"],
  },
  lights: {
    id: "lights",
    eyebrow: "control de iluminacion",
    title: "Dashboard de luces",
    description: "Gestiona cuatro LEDs por ambiente desde un ESP32 multiambiente.",
    aiMessage: "La IA traduce la voz a sala, cocina, comedor o dormitorio antes de confirmar la ejecucion.",
    metrics: [
      { label: "Ambientes", value: "4" },
      { label: "Encendidas", value: "1" },
      { label: "Apagadas", value: "3" },
    ],
    items: [
      { name: "Sala", status: "OFF", meta: "GPIO 16" },
      { name: "Cocina", status: "ON", meta: "GPIO 17" },
      { name: "Comedor", status: "OFF", meta: "GPIO 18" },
      { name: "Dormitorio", status: "OFF", meta: "GPIO 19" },
    ],
    actions: ["Encender", "Apagar"],
  },
  doors: {
    id: "doors",
    eyebrow: "perimetro conectado",
    title: "Dashboard de puertas",
    description: "Revisa accesos conectados y estados del perimetro.",
    aiMessage: "La IA conserva contexto del perimetro para coordinar alertas y accesos.",
    metrics: [
      { label: "Cerradas", value: "3" },
      { label: "Monitoreada", value: "1" },
      { label: "Alertas", value: "0" },
    ],
    items: [
      { name: "Puerta frontal", status: "Cerrada", meta: "Acceso principal" },
      { name: "Cuarto tecnico", status: "Cerrada", meta: "Zona restringida" },
      { name: "Porton lateral", status: "Monitoreada", meta: "Revision visual" },
    ],
    actions: ["Ver estado", "Bloquear"],
  },
  drones: {
    id: "drones",
    eyebrow: "movilidad aerea",
    title: "Dashboard de drones",
    description: "Consulta unidades aereas, bateria y recorridos simulados.",
    aiMessage: "La IA actua como orquestador de rutas y telemetria de drones.",
    metrics: [
      { label: "Activos", value: "1" },
      { label: "En carga", value: "1" },
      { label: "Bateria", value: "82%" },
    ],
    items: [
      { name: "Drone patio", status: "Activo", meta: "Ruta corta disponible" },
      { name: "Drone perimetro", status: "En carga", meta: "Bateria 64%" },
    ],
    actions: ["Iniciar ruta", "Ver telemetria"],
  },
};

export function VoiceDashboard({ resetSignal }: { resetSignal?: number }) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioLevelFrameRef = useRef<number | null>(null);
  const audioLevelStatsRef = useRef({ samples: 0, sum: 0, peak: 0 });
  const aiReplyAudioRef = useRef<HTMLAudioElement | null>(null);
  const aiReplyAudioUrlRef = useRef<string | null>(null);
  const aiReplyAudioTokenRef = useRef(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [connection, setConnection] =
    useState<BackendConnectionState>("checking");
  const [lastFileName, setLastFileName] = useState<string>("Sin envio reciente");
  const [statusText, setStatusText] = useState(
    "Pulsa el nucleo de voz para comenzar a grabar lo que dices.",
  );
  const [response, setResponse] = useState<VoiceIntentResponse | null>(null);
  const [confirmation, setConfirmation] =
    useState<VoiceIntentConfirmResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<ActiveDetail>("ia");
  const [isConfirming, setIsConfirming] = useState(false);
  const [recentIntents, setRecentIntents] = useState<VoiceIntentAuditRecord[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [aiSpeechStatus, setAiSpeechStatus] = useState<AiSpeechStatus>("idle");
  const [aiSpeechError, setAiSpeechError] = useState<string | null>(null);
  const confirmationDeliveryKey = buildDeliveryKey(getConfirmationDeliveries(confirmation));

  useEffect(() => {
    void handlePing();
    void refreshRecentIntents();

    return () => {
      stopMicrophoneStream();
      releaseAiReplyAudio();
    };
  }, []);

  useEffect(() => {
    setActiveDetail("ia");
  }, [resetSignal]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRecording]);

  useEffect(() => {
    const audioInfo = response?.respuesta_ia_audio;

    if (!response) {
      stopAiReplyAudio("idle");
      return;
    }

    if (audioInfo?.available && audioInfo.endpoint) {
      void playAiReplyAudio("auto");
      return;
    }

    if (audioInfo?.error) {
      stopAiReplyAudio("error");
      setAiSpeechError(audioInfo.error);
      appendDebugLog("warning", "Audio IA no disponible", audioInfo.error);
      return;
    }

    stopAiReplyAudio("unavailable");
  }, [response?.plan?.request_id, response?.respuesta_ia_audio?.available, response?.respuesta_ia_audio?.endpoint]);

  useEffect(() => {
    const deliveries = getConfirmationDeliveries(confirmation);
    const pendingDeliveries = deliveries.filter(
      (delivery) =>
        delivery.transport === "http_polling" &&
        delivery.command_id &&
        !isTerminalDeliveryStatus(delivery.status),
    );

    if (pendingDeliveries.length === 0) {
      return;
    }

    let isCancelled = false;

    async function refreshDeliveryStatus() {
      try {
        const updates = await Promise.all(
          pendingDeliveries.map(async (delivery) => {
            const payload = await getDeviceCommandStatus(delivery.command_id ?? "");
            return payload.delivery;
          }),
        );
        if (isCancelled) {
          return;
        }

        const updatesById = new Map(
          updates
            .filter((delivery) => delivery.command_id)
            .map((delivery) => [delivery.command_id, delivery]),
        );
        const mergedDeliveries = deliveries.map((delivery) =>
          delivery.command_id && updatesById.has(delivery.command_id)
            ? updatesById.get(delivery.command_id) ?? delivery
            : delivery,
        );

        setConfirmation((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            delivery: mergedDeliveries[0] ?? current.delivery,
            deliveries: mergedDeliveries,
          };
        });
        setStatusText(formatDeliveryListStatus(mergedDeliveries));
        setConnection(hasDeliveryFailure(mergedDeliveries) ? "error" : "online");
      } catch {
        if (!isCancelled) {
          setStatusText("Esperando el estado del ESP32. La API no respondio a la consulta.");
        }
      }
    }

    void refreshDeliveryStatus();
    const intervalId = window.setInterval(() => {
      void refreshDeliveryStatus();
    }, 2000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [confirmationDeliveryKey]);

  function appendDebugLog(
    level: DebugLogLevel,
    message: string,
    details?: Record<string, unknown> | string,
  ) {
    const entry: DebugLogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details:
        typeof details === "string"
          ? details
          : details
            ? JSON.stringify(details, null, 2)
            : undefined,
    };

    setDebugLogs((current) => [entry, ...current].slice(0, 14));
  }

  function releaseAiReplyAudio() {
    aiReplyAudioRef.current?.pause();
    if (aiReplyAudioRef.current) {
      aiReplyAudioRef.current.src = "";
    }
    aiReplyAudioRef.current = null;

    if (aiReplyAudioUrlRef.current) {
      window.URL.revokeObjectURL(aiReplyAudioUrlRef.current);
      aiReplyAudioUrlRef.current = null;
    }
  }

  function stopAiReplyAudio(nextStatus: AiSpeechStatus = "idle", shouldLog = false) {
    const hadAudio = Boolean(aiReplyAudioRef.current || aiReplyAudioUrlRef.current);
    aiReplyAudioTokenRef.current += 1;
    releaseAiReplyAudio();
    setAiSpeechStatus(nextStatus);

    if (nextStatus !== "error") {
      setAiSpeechError(null);
    }

    if (shouldLog && hadAudio) {
      appendDebugLog("info", "Audio IA detenido por el usuario");
    }
  }

  async function playAiReplyAudio(source: "auto" | "manual") {
    const audioInfo = response?.respuesta_ia_audio;

    if (!audioInfo?.available || !audioInfo.endpoint) {
      const error = audioInfo?.error ?? "El backend no envio audio IA para esta respuesta.";
      setAiSpeechStatus(audioInfo ? "error" : "unavailable");
      setAiSpeechError(error);
      appendDebugLog("warning", "Audio IA no disponible", error);
      return;
    }

    const playToken = aiReplyAudioTokenRef.current + 1;
    aiReplyAudioTokenRef.current = playToken;
    releaseAiReplyAudio();
    setAiSpeechStatus("loading");
    setAiSpeechError(null);
    appendDebugLog("info", source === "auto" ? "Preparando voz IA automatica" : "Preparando repeticion de voz IA", {
      endpoint: audioInfo.endpoint,
      content_type: audioInfo.content_type ?? "audio/mpeg",
      model: audioInfo.model ?? "no informado",
      voice: audioInfo.voice ?? "no informada",
    });

    try {
      const blob = await getVoiceIntentUserReplyAudio(audioInfo.endpoint);
      const objectUrl = window.URL.createObjectURL(blob);

      if (aiReplyAudioTokenRef.current !== playToken) {
        window.URL.revokeObjectURL(objectUrl);
        return;
      }

      const audio = new Audio(objectUrl);
      audio.preload = "auto";
      aiReplyAudioRef.current = audio;
      aiReplyAudioUrlRef.current = objectUrl;

      audio.onplay = () => {
        if (aiReplyAudioTokenRef.current !== playToken) {
          return;
        }
        setAiSpeechStatus("playing");
        appendDebugLog("success", "Audio IA reproduciendo", { source });
      };

      audio.onpause = () => {
        if (aiReplyAudioTokenRef.current !== playToken || audio.ended) {
          return;
        }
        setAiSpeechStatus("paused");
      };

      audio.onended = () => {
        if (aiReplyAudioTokenRef.current !== playToken) {
          return;
        }
        setAiSpeechStatus("idle");
        appendDebugLog("info", "Audio IA finalizado");
      };

      audio.onerror = () => {
        if (aiReplyAudioTokenRef.current !== playToken) {
          return;
        }
        const message = "El navegador no pudo reproducir el MP3 generado por OpenAI.";
        setAiSpeechStatus("error");
        setAiSpeechError(message);
        appendDebugLog("error", "Error reproduciendo audio IA", message);
      };

      await audio.play();
    } catch (error) {
      if (aiReplyAudioTokenRef.current !== playToken) {
        return;
      }
      const message = getErrorMessage(error);
      releaseAiReplyAudio();
      setAiSpeechStatus("error");
      setAiSpeechError(message);
      appendDebugLog("error", source === "auto" ? "Autoplay de audio IA no disponible" : "Fallo al reproducir audio IA", message);
    }
  }

  async function handlePing() {
    setIsChecking(true);
    setConnection("checking");
    setErrorText(null);
    appendDebugLog("info", "Probando API publica", { api_base_url: API_BASE_URL });

    try {
      await pingBackend();
      setConnection("online");
      setStatusText("Backend conectado. El dashboard esta listo para recibir voz.");
      appendDebugLog("success", "Backend respondio /ping", { status: "online" });
    } catch (error) {
      const message = getErrorMessage(error);
      setConnection("offline");
      setStatusText("No se logro conectar con la API publica. Revisa dominio, HTTPS y CORS.");
      setErrorText(message);
      appendDebugLog("error", "Fallo /ping del backend", message);
    } finally {
      setIsChecking(false);
    }
  }

  async function refreshRecentIntents() {
    try {
      const payload = await listRecentVoiceIntents();
      setRecentIntents(payload.items ?? []);
    } catch {
      setRecentIntents([]);
    }
  }

  async function handleVoiceNodeClick() {
    if (isUploading || isConfirming) {
      return;
    }

    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    await startVoiceRecording();
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setConnection("error");
      setErrorText(
        "Este navegador no permite grabar desde el microfono. Abre la app en Chrome o habilita permisos de microfono.",
      );
      setStatusText("No se pudo iniciar la grabacion de voz.");
      return;
    }

    try {
      stopAiReplyAudio("idle");
      appendDebugLog("info", "Solicitando permiso de microfono");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      startAudioLevelMonitor(stream);
      const mimeType = getSupportedAudioMimeType();
      appendDebugLog("info", "Microfono activo", {
        selected_mime_type: mimeType || "default del navegador",
        audio_tracks: stream.getAudioTracks().length,
      });
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const file = new File([blob], `voz-${Date.now()}.webm`, {
          type: blob.type || "audio/webm",
        });

        const levelStats = getAudioLevelStats();

        stopMicrophoneStream();
        setIsRecording(false);
        setRecordingSeconds(0);

        appendDebugLog(blob.size > 0 ? "info" : "warning", "Grabacion detenida", {
          blob_size: formatBytes(blob.size),
          blob_size_bytes: blob.size,
          blob_type: blob.type || "sin tipo",
          chunks: audioChunksRef.current.length,
          recorder_mime_type: recorder.mimeType || "sin tipo",
          peak_level: levelStats.peakLabel,
          average_level: levelStats.averageLabel,
          audio_samples: levelStats.samples,
        });

        const looksSilent =
          blob.size < SILENT_AUDIO_MIN_BYTES ||
          (levelStats.samples > 0 && levelStats.peak < SILENT_AUDIO_PEAK_THRESHOLD);

        if (looksSilent) {
          const message =
            "El navegador no capto voz util. Revisa que el microfono correcto este seleccionado, que no este silenciado y habla cerca del equipo.";

          setConnection("error");
          setErrorText(message);
          setStatusText("No se envio el audio porque parece silencio o volumen demasiado bajo.");
          appendDebugLog("warning", "Audio bloqueado antes de enviar", {
            reason: "silencio_o_volumen_bajo",
            min_size_required: formatBytes(SILENT_AUDIO_MIN_BYTES),
            actual_size: formatBytes(blob.size),
            peak_level: levelStats.peakLabel,
            average_level: levelStats.averageLabel,
          });
          return;
        }

        void handleAudioFile(file);
      };

      recorder.start();
      setIsRecording(true);
      setConnection("uploading");
      setErrorText(null);
      setConfirmation(null);
      setStatusText("Grabando audio. Pulsa de nuevo para detener y enviar.");
      appendDebugLog("success", "Grabacion iniciada", {
        recorder_mime_type: recorder.mimeType || "sin tipo",
      });
    } catch (error) {
      const message = getMicrophoneErrorMessage(error);
      stopMicrophoneStream();
      setIsRecording(false);
      setRecordingSeconds(0);
      setConnection("error");
      setErrorText(message);
      appendDebugLog("error", "No se pudo iniciar microfono", message);
      setStatusText(
        "No fue posible iniciar la grabacion. Revisa el permiso de microfono y vuelve a pulsar Enviar voz.",
      );
    }
  }

  function startAudioLevelMonitor(stream: MediaStream) {
    stopAudioLevelMonitor();
    audioLevelStatsRef.current = { samples: 0, sum: 0, peak: 0 };

    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      appendDebugLog("warning", "Este navegador no permite medir nivel de microfono");
      return;
    }

    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioContextRef.current = audioContext;

    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;

      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / samples.length);
      const stats = audioLevelStatsRef.current;
      stats.samples += 1;
      stats.sum += rms;
      stats.peak = Math.max(stats.peak, rms);
      audioLevelFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  }

  function stopAudioLevelMonitor() {
    if (audioLevelFrameRef.current !== null) {
      window.cancelAnimationFrame(audioLevelFrameRef.current);
      audioLevelFrameRef.current = null;
    }

    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  function getAudioLevelStats() {
    const stats = audioLevelStatsRef.current;
    const average = stats.samples > 0 ? stats.sum / stats.samples : 0;

    return {
      samples: stats.samples,
      peak: stats.peak,
      average,
      peakLabel: formatPercent(stats.peak),
      averageLabel: formatPercent(average),
    };
  }

  function stopMicrophoneStream() {
    stopAudioLevelMonitor();
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    mediaRecorderRef.current = null;
  }

  async function handleAudioFile(file: File) {
    if (!file) {
      return;
    }

    setIsUploading(true);
    setConnection("uploading");
    setErrorText(null);
    setConfirmation(null);
    setLastFileName(file.name);
    setStatusText("Subiendo audio al backend y esperando el plan de la IA...");
    appendDebugLog("info", "Enviando audio al backend", {
      file_name: file.name,
      file_type: file.type || "sin tipo",
      file_size: formatBytes(file.size),
      file_size_bytes: file.size,
    });

    try {
      const payload = await sendVoiceIntentPreview(file);
      const transcript = payload.fase_2_transcripcion?.texto_transcrito;
      const audioInfo = payload.fase_1_audio_guardado;

      setResponse(payload);
      void refreshRecentIntents();
      setConnection("online");
      const planCanExecute = payload.plan?.can_execute ?? false;
      setStatusText(
        transcript
          ? planCanExecute
            ? `Plan listo para confirmar: "${transcript}".`
            : `La IA respondio, pero el plan aun no es ejecutable: "${transcript}".`
          : planCanExecute
            ? "Audio enviado correctamente. La IA devolvio un plan listo para confirmar."
            : "Audio enviado correctamente. La IA devolvio un plan no ejecutable todavia.",
      );
      appendDebugLog(transcript ? "success" : "warning", "Respuesta de voz recibida", {
        transcript: transcript || "vacio",
        transcript_length: transcript?.length ?? 0,
        backend_filename: audioInfo?.filename ?? "sin archivo",
        backend_content_type: audioInfo?.content_type ?? "sin tipo",
        backend_content_type_normalized: audioInfo?.content_type_normalized ?? "no informado",
        backend_size: formatBytes(audioInfo?.content_size_bytes ?? 0),
        backend_size_bytes: audioInfo?.content_size_bytes ?? 0,
        stored: audioInfo?.stored ?? false,
        can_execute: payload.plan?.can_execute ?? false,
        tts_available: payload.respuesta_ia_audio?.available ?? false,
      });

      if (payload.respuesta_ia_audio?.available) {
        appendDebugLog("success", "Audio IA generado por backend", {
          endpoint: payload.respuesta_ia_audio.endpoint ?? "sin endpoint",
          content_type: payload.respuesta_ia_audio.content_type ?? "audio/mpeg",
          voice: payload.respuesta_ia_audio.voice ?? "no informada",
          model: payload.respuesta_ia_audio.model ?? "no informado",
        });
      } else if (payload.respuesta_ia_audio?.error) {
        appendDebugLog("warning", "Backend no genero audio IA", payload.respuesta_ia_audio.error);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setConnection("error");
      setErrorText(message);
      appendDebugLog("error", "Fallo al procesar audio", message);
      setStatusText("No fue posible procesar el audio. Intenta nuevamente.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleConfirmPlan() {
    const requestId = response?.plan?.request_id;

    if (!requestId || isConfirming) {
      return;
    }

    setIsConfirming(true);
    setConnection("uploading");
    setErrorText(null);
    setStatusText("Confirmando el plan y preparando la entrega al dispositivo...");

    try {
      const payload = await confirmVoiceIntentPlan(requestId);

      setConfirmation(payload);
      void refreshRecentIntents();
      const deliveries = getConfirmationDeliveries(payload);
      setConnection(payload.ok ? "online" : "error");
      setStatusText(
        deliveries.length > 0
          ? formatDeliveryListStatus(deliveries)
          : payload.message ??
          (payload.executed
            ? "Plan confirmado y ejecutado."
            : "Plan confirmado sin ejecucion real."),
      );
      appendDebugLog(payload.ok ? "success" : "warning", "Confirmacion recibida", {
        ok: payload.ok ?? false,
        executed: payload.executed ?? false,
        queued: payload.queued ?? false,
        queued_count: payload.queued_count ?? deliveries.length,
        delivery_statuses: deliveries.map((delivery) => delivery.status),
        command_ids: deliveries.map((delivery) => delivery.command_id ?? "sin comando"),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setConnection("error");
      setErrorText(message);
      appendDebugLog("error", "Fallo al confirmar plan", message);
      setStatusText("No fue posible confirmar el plan. Intenta nuevamente.");
    } finally {
      setIsConfirming(false);
    }
  }

  function handleDiscardPlan() {
    stopAiReplyAudio("idle", true);
    setResponse(null);
    setConfirmation(null);
    setErrorText(null);
    setStatusText(
      "Plan descartado. Puedes enviar un nuevo comando por voz cuando quieras.",
    );
  }

  const visibleDashboardCards =
    activeDetail === "ia"
      ? dashboardCards
      : dashboardCards.filter((card) => card.detail === activeDetail);

  return (
    <main className="min-h-screen px-3 py-4 text-slate-50 sm:px-5 lg:px-8 xl:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-5">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-4 sm:pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
              proy_ia_security
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold leading-tight text-white sm:text-3xl lg:text-4xl">
              Dashboard domotico
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Una vista simple para enviar voz a la IA y ver el estado base de
              camaras, luces, puertas y drones conectados.
            </p>
            <p className="mt-2 break-all text-xs text-slate-500">
              API activa: <span className="text-slate-300">{API_BASE_URL}</span>
            </p>
          </div>

          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-start lg:justify-end">
            <StatusBadge connection={connection} />
            <button
              type="button"
              onClick={() => void handlePing()}
              className="min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isChecking}
            >
              {isChecking ? "Verificando..." : "Probar API"}
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="order-1 rounded-lg border border-white/10 bg-[#08111f]/90 p-4 shadow-glow sm:p-5 lg:p-6 xl:col-start-1 xl:row-span-4 xl:min-h-[46rem]">
            <AiCommandCard
              activeContext={
                activeDetail === "ia"
                  ? "dashboard principal"
                  : detailDashboards[activeDetail].title.toLowerCase()
              }
              confirmation={confirmation}
              connection={connection}
              errorText={errorText}
              isConfirming={isConfirming}
              isRecording={isRecording}
              isUploading={isUploading}
              onConfirmPlan={() => void handleConfirmPlan()}
              onDiscardPlan={handleDiscardPlan}
              onReplayAiReply={() => void playAiReplyAudio("manual")}
              onStopAiReply={() => stopAiReplyAudio("idle", true)}
              onVoiceNodeClick={() => void handleVoiceNodeClick()}
              recordingSeconds={recordingSeconds}
              response={response}
              statusText={statusText}
              debugLogs={debugLogs}
              aiSpeechStatus={aiSpeechStatus}
              aiSpeechError={aiSpeechError}
            />

            {activeDetail !== "ia" ? (
              <DeviceDetailDashboard
                config={detailDashboards[activeDetail]}
                onBack={() => setActiveDetail("ia")}
              />
            ) : null}
          </section>

          {visibleDashboardCards.map((card) => (
            <SystemCard
              key={card.detail}
              device={card.device}
              className={
                activeDetail === "ia"
                  ? card.className
                  : "order-2 xl:order-none xl:col-start-2 xl:row-start-1"
              }
              isActive={activeDetail === card.detail}
              onEnter={() => setActiveDetail(card.detail)}
            />
          ))}
        </section>

        <section className="rounded-lg border border-white/10 bg-[#08111f]/90 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
                Auditoria Supabase
              </p>
              <h2 className="mt-2 font-display text-lg font-semibold text-white">
                Comandos de voz recientes
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                El audio se mantiene privado y expira automaticamente a los 30 dias.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshRecentIntents()}
              className="min-h-10 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10"
            >
              Actualizar
            </button>
          </div>

          {recentIntents.length === 0 ? (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
              Aun no hay solicitudes de voz registradas para esta empresa.
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {recentIntents.map((intent) => (
                <article
                  key={intent.request_id}
                  className="rounded-lg border border-white/10 bg-white/[0.03] p-3 sm:p-4"
                >
                  <div className="flex flex-wrap justify-between gap-2 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <span>{formatAuditDate(intent.created_at)}</span>
                    <span className="text-[#9edfff]">{intent.status}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">
                    {intent.transcription || "Sin transcripcion disponible"}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    {intent.response_for_user || "Sin respuesta registrada"}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function AiCommandCard({
  activeContext,
  confirmation,
  connection,
  errorText,
  isConfirming,
  isRecording,
  isUploading,
  onConfirmPlan,
  onDiscardPlan,
  onReplayAiReply,
  onStopAiReply,
  onVoiceNodeClick,
  recordingSeconds,
  response,
  statusText,
  debugLogs,
  aiSpeechStatus,
  aiSpeechError,
}: {
  activeContext: string;
  confirmation: VoiceIntentConfirmResponse | null;
  connection: BackendConnectionState;
  errorText: string | null;
  isConfirming: boolean;
  isRecording: boolean;
  isUploading: boolean;
  onConfirmPlan: () => void;
  onDiscardPlan: () => void;
  onReplayAiReply: () => void;
  onStopAiReply: () => void;
  onVoiceNodeClick: () => void;
  recordingSeconds: number;
  response: VoiceIntentResponse | null;
  statusText: string;
  debugLogs: DebugLogEntry[];
  aiSpeechStatus: AiSpeechStatus;
  aiSpeechError: string | null;
}) {
  const intentJson =
    response?.respuesta_json_dispositivo ??
    response?.fase_3_ia_json?.respuesta_json_dispositivo ??
    response?.intencion_json ??
    response?.fase_3_ia_json?.intencion_json ??
    response?.fase_3_ia_json?.ia_json;
  const plan = response?.plan;
  const aiAudio = response?.respuesta_ia_audio ?? plan?.respuesta_ia_audio;
  const deliveries = getVisibleDeliveries(confirmation, response, plan);
  const delivery = deliveries[0] ?? confirmation?.delivery ?? response?.delivery ?? plan?.delivery_preview;
  const isHttpDelivery = deliveries.some((item) => item.transport === "http_polling") || delivery?.transport === "http_polling";
  const mqttResult = confirmation?.fase_4_mqtt ?? response?.fase_4_mqtt;
  const lightCommands = plan?.comandos_luces ?? intentJson?.comandos_luces ?? [];
  const usesBatchDelivery = confirmation?.batch || plan?.batch || confirmation?.delivery_mode === "batch_http_polling" || plan?.delivery_mode === "batch_http_polling";
  const dashboardStatusReply = buildDashboardStatusReply(connection, activeContext);
  const userReply =
    response?.respuesta_ia_usuario ??
    response?.fase_3_ia_json?.respuesta_ia_usuario ??
    response?.respuesta_usuario ??
    response?.fase_3_ia_json?.respuesta_usuario ??
    plan?.respuesta ??
    dashboardStatusReply;
  const deviceJsonReply = intentJson
    ? formatIntentJson(intentJson)
    : formatDashboardDeviceJson(connection, activeContext);
  const transcript =
    response?.fase_2_transcripcion?.texto_transcrito ?? "Sin transcripcion";
  const canConfirm =
    Boolean(plan?.request_id && plan.can_execute && !confirmation) &&
    !isUploading &&
    !isConfirming;

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-[#44c7f4]/20 bg-[#061727]/70 p-4 sm:p-5">
      {isRecording ? (
        <RecordingOverlay
          onStop={onVoiceNodeClick}
          recordingSeconds={recordingSeconds}
        />
      ) : null}

      <div className="grid gap-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            IA central disponible
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">
            Guia IA
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Contexto activo: <span className="text-white">{activeContext}</span>
          </p>
        </div>
        <SignalPill state={connection} />
      </div>

      <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[17rem_minmax(0,1fr)] xl:items-start">
        <div>
          <button
            type="button"
            onClick={onVoiceNodeClick}
            className={`mx-auto flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full border p-5 text-center shadow-[0_0_45px_rgba(68,199,244,0.18)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70 sm:h-48 sm:w-48 lg:h-52 lg:w-52 xl:h-56 xl:w-56 ${
              isRecording
                ? "border-rose-300/70 bg-rose-400/15"
                : "border-[#44c7f4]/40 bg-[#061727] hover:bg-[#092036]"
            }`}
            disabled={isUploading || isConfirming}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 sm:h-14 sm:w-14">
              <MicIcon className="h-6 w-6 text-white sm:h-7 sm:w-7" />
            </span>
            <span className="font-display text-lg text-white sm:text-xl">
              {isRecording ? "Detener" : isUploading ? "Procesando" : "Enviar voz"}
            </span>
            <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
              {isRecording ? "Grabando" : isUploading || isConfirming ? "IA activa" : "Audio"}
            </span>
          </button>

          <p className="mt-5 text-center text-sm leading-6 text-slate-300">
            {statusText}
          </p>

          {errorText ? (
            <p className="mt-4 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm leading-6 text-rose-200">
              {errorText}
            </p>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-4 overflow-hidden border-t border-white/10 pt-4 text-sm xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <div className="grid gap-2">
            <InfoRow label="Transcripcion" value={transcript} />
            <UserReplyAudioRow
              value={userReply}
              audio={aiAudio}
              status={aiSpeechStatus}
              error={aiSpeechError}
              onReplay={onReplayAiReply}
              onStop={onStopAiReply}
            />
            <InfoRow
              label="Respuesta Json para el dispositivo"
              value={deviceJsonReply}
              wide
            />
            <InfoRow label="Modulo" value={formatModuleLabel(plan?.module)} />
            <InfoRow label="Accion" value={formatCommandAction(plan, intentJson)} />
            <InfoRow label="Ambiente" value={formatCommandSpaces(plan, intentJson)} />
            <InfoRow
              label="Ejecucion"
              value={
                confirmation && deliveries.length > 0
                  ? formatDeliveryListStatus(deliveries)
                  : confirmation?.message ??
                (plan?.can_execute
                  ? "Lista para confirmar"
                  : plan
                    ? "Solo plan escrito"
                    : "Pendiente")
              }
            />
          </div>

          {plan ? (
            <div className="rounded-lg border border-white/10 bg-[#050c16]/70 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Plan de accion
              </p>
              <ol className="mt-3 grid gap-2 text-slate-300">
                {plan.steps.map((step, index) => (
                  <li key={`${step}-${index}`} className="flex gap-2 leading-6">
                    <span className="text-[#9edfff]">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onConfirmPlan}
              disabled={!canConfirm}
              className="min-h-11 rounded-lg border border-[#8ee89d]/30 bg-[#8ee89d]/10 px-4 py-2 text-sm font-semibold text-[#b9f3c2] transition hover:bg-[#8ee89d]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-500"
            >
              {isConfirming ? "Confirmando..." : "Confirmar ejecucion"}
            </button>
            <button
              type="button"
              onClick={onDiscardPlan}
              disabled={!response || isUploading || isConfirming}
              className="min-h-11 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Descartar
            </button>
          </div>

          <div className="grid gap-2 border-t border-white/10 pt-4">
            <InfoRow label="Intencion" value={intentJson?.intencion ?? "Pendiente"} />
            {isHttpDelivery ? (
              <>
                <InfoRow label="Entrega" value={usesBatchDelivery ? "HTTPS polling ESP32 batch" : deliveries.length > 1 ? "HTTPS polling ESP32 multi-comando" : "HTTPS polling ESP32"} />
                <InfoRow label="Estado" value={formatDeliveryListStatus(deliveries)} />
                <InfoRow label="Payload" value={formatHttpDeliveryPayloadList(deliveries)} />
                <InfoRow label="Device ID" value={formatDeliveryDeviceIds(deliveries)} />
                {lightCommands.length > 1 ? (
                  <InfoRow label="Comandos" value={formatLightCommands(lightCommands)} />
                ) : null}
              </>
            ) : (
              <>
                <InfoRow label="MQTT" value={mqttResult?.accion_mqtt ?? "SIN_ACCION"} />
                <InfoRow
                  label="Payload"
                  value={formatMqttPayload(mqttResult?.mqtt_payload)}
                />
                <InfoRow label="Topic" value={mqttResult?.mqtt_topic ?? "casa/esp32/luces"} />
              </>
            )}
          </div>
        </div>
      </div>

      <DebugLogCard logs={debugLogs} />

      <details className="mt-4 border-t border-white/10 pt-4 text-sm text-slate-300">
        <summary className="cursor-pointer text-slate-200">
          Respuesta completa
        </summary>
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[#050c16] p-3 text-xs leading-5 text-slate-300">
          {response
            ? JSON.stringify({ preview: response, confirmation }, null, 2)
            : "Aun no hay respuesta del backend."}
        </pre>
      </details>
    </section>
  );
}

function DeviceDetailDashboard({
  config,
  onBack,
}: {
  config: DetailDashboardConfig;
  onBack: () => void;
}) {
  return (
    <div className="mt-5 grid gap-5 border-t border-white/10 pt-5">
      <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            {config.eyebrow}
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white sm:text-3xl">
            {config.title}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            {config.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="min-h-10 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10"
        >
          Volver a Guia IA
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {config.metrics.map((metric) => (
          <article
            key={metric.label}
            className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
          >
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {metric.label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold text-white">
              {metric.value}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-3">
        {config.items.map((item) => (
          <article
            key={item.name}
            className="rounded-lg border border-white/10 bg-[#050c16]/70 p-4"
          >
            <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-white">
                  {item.name}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  {item.meta}
                </p>
              </div>
              <span className="w-fit rounded-full border border-[#8ee89d]/30 bg-[#8ee89d]/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-[#b9f3c2]">
                {item.status}
              </span>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {config.actions.map((action) => (
                <button
                  key={`${item.name}-${action}`}
                  type="button"
                  className="min-h-10 rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 px-4 py-2 text-sm font-semibold text-[#b7ebff] transition hover:bg-[#44c7f4]/15"
                >
                  {action}
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function RecordingOverlay({
  onStop,
  recordingSeconds,
}: {
  onStop: () => void;
  recordingSeconds: number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020712]/80 px-4 backdrop-blur-md">
      <section className="w-full max-w-sm rounded-lg border border-[#44c7f4]/30 bg-[#061727] p-5 text-center shadow-[0_0_70px_rgba(68,199,244,0.22)] sm:p-6">
        <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-[#44c7f4]/30 bg-[#44c7f4]/10 shadow-[0_0_35px_rgba(68,199,244,0.2)]">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-rose-300/50 bg-rose-400/15">
            <span className="absolute h-full w-full animate-ping rounded-full bg-rose-400/20" />
            <MicIcon className="relative h-8 w-8 text-white" />
          </div>
        </div>

        <p className="mt-5 text-xs uppercase tracking-[0.22em] text-rose-200">
          grabacion activa
        </p>
        <h3 className="mt-2 font-display text-2xl font-semibold text-white">
          Grabando voz
        </h3>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-300">
          Habla ahora. Tu comando se enviara al detener.
        </p>

        <div className="mt-5 flex items-end justify-center gap-1.5" aria-hidden="true">
          <span className="h-5 w-2 animate-pulse rounded-full bg-[#44c7f4]/70" />
          <span className="h-8 w-2 animate-pulse rounded-full bg-[#8ee89d]/70 [animation-delay:120ms]" />
          <span className="h-12 w-2 animate-pulse rounded-full bg-rose-300/80 [animation-delay:240ms]" />
          <span className="h-7 w-2 animate-pulse rounded-full bg-[#8ee89d]/70 [animation-delay:360ms]" />
          <span className="h-10 w-2 animate-pulse rounded-full bg-[#44c7f4]/70 [animation-delay:480ms]" />
        </div>

        <p className="mt-5 font-display text-4xl font-semibold tabular-nums text-white">
          {formatRecordingTime(recordingSeconds)}
        </p>

        <button
          type="button"
          onClick={onStop}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-rose-300/35 bg-rose-400/15 px-5 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-400/25 focus:outline-none focus:ring-2 focus:ring-rose-300/45"
        >
          Detener y enviar
        </button>
      </section>
    </div>
  );
}

function SystemCard({
  device,
  isActive,
  onEnter,
  className,
}: {
  device: DeviceCard;
  isActive: boolean;
  onEnter: () => void;
  className?: string;
}) {
  return (
    <article
      className={`rounded-lg border bg-white/[0.04] p-4 sm:p-5 ${
        isActive ? "border-[#44c7f4]/40 shadow-[0_0_22px_rgba(68,199,244,0.12)]" : "border-white/10"
      } ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold leading-tight text-white sm:text-xl">
            {device.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">{device.status}</p>
        </div>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border sm:h-11 sm:w-11 ${device.tone}`}
        >
          <device.Icon className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 xl:mt-6">
        <p className="font-display text-4xl font-semibold text-white sm:text-5xl">
          {device.count}
        </p>
        <span className="rounded-md border border-white/10 px-2 py-1 text-xs uppercase tracking-[0.14em] text-slate-300">
          activo
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-300 xl:mt-4">
        {device.description}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 xl:mt-4">
        {device.items.map((item) => (
          <span
            key={item}
            className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300"
          >
            {item}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onEnter}
        className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-[#44c7f4]/30 bg-[#44c7f4]/10 px-4 py-2 text-sm font-semibold text-[#b7ebff] transition hover:bg-[#44c7f4]/15 focus:outline-none focus:ring-2 focus:ring-[#44c7f4]/40"
      >
        {device.buttonLabel}
      </button>
    </article>
  );
}

function StatusBadge({
  connection,
}: {
  connection: BackendConnectionState;
}) {
  const palette = getConnectionPalette(connection);
  const label = getConnectionLabel(connection);

  return (
    <div className={`rounded-full border px-3 py-2 text-sm ${palette}`}>
      {label}
    </div>
  );
}

function SignalPill({ state }: { state: BackendConnectionState }) {
  const tone = getConnectionTone(state);

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.22em] text-slate-300">
      <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
      {getSignalLabel(state)}
    </div>
  );
}

function DebugLogCard({ logs }: { logs: DebugLogEntry[] }) {
  return (
    <section className="mt-4 rounded-lg border border-[#44c7f4]/20 bg-[#050c16]/80 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#9edfff]">
            Logs de prueba
          </p>
          <h3 className="mt-1 font-display text-base font-semibold text-white">
            Voz, backend y OpenAI
          </h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
          {logs.length} eventos
        </span>
      </div>

      <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/20">
        {logs.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-500">
            Sin eventos todavia.
          </p>
        ) : (
          <ol className="divide-y divide-white/10">
            {logs.map((log) => (
              <li key={log.id} className="grid gap-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${getDebugLogTone(log.level)}`} />
                  <time className="font-mono text-[11px] text-slate-500">
                    {formatLogTime(log.timestamp)}
                  </time>
                  <span className="text-xs font-semibold text-slate-200">
                    {log.message}
                  </span>
                </div>
                {log.details ? (
                  <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#020712] px-2 py-2 font-mono text-[11px] leading-4 text-slate-400">
                    {log.details}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getDebugLogTone(level: DebugLogLevel) {
  if (level === "success") {
    return "bg-[#8ee89d]";
  }

  if (level === "warning") {
    return "bg-[#f6c563]";
  }

  if (level === "error") {
    return "bg-[#ff8a9f]";
  }

  return "bg-[#44c7f4]";
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }

  return `${Math.min(100, Math.round(value * 100))}%`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function UserReplyAudioRow({
  value,
  audio,
  status,
  error,
  onReplay,
  onStop,
}: {
  value: string;
  audio?: VoiceIntentResponse["respuesta_ia_audio"] | null;
  status: AiSpeechStatus;
  error: string | null;
  onReplay: () => void;
  onStop: () => void;
}) {
  const hasAudio = Boolean(audio?.available && audio.endpoint);
  const hasAudioMetadata = Boolean(audio);
  const canReplay = hasAudio && status !== "loading";
  const canStop = status === "loading" || status === "playing" || status === "paused";
  const statusLabel = formatAiSpeechStatus(status, error, audio);

  return (
    <div className="grid min-w-0 gap-2 border-b border-white/5 pb-2 last:border-none last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-slate-500">Respuesta IA para el usuario</span>
        {hasAudioMetadata ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReplay}
              disabled={!canReplay}
              title="Reproducir voz IA"
              aria-label="Reproducir voz IA"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 text-[#b7ebff] transition hover:bg-[#44c7f4]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-600"
            >
              <SpeakerIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={!canStop}
              title="Detener voz IA"
              aria-label="Detener voz IA"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <StopIcon className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
      <span className="min-w-0 whitespace-pre-wrap break-words text-slate-200 [overflow-wrap:anywhere]">
        {value}
      </span>
      {hasAudioMetadata ? (
        <span className={status === "error" ? "text-xs text-rose-200" : "text-xs text-slate-500"}>
          Voz generada por IA · {statusLabel}
        </span>
      ) : null}
    </div>
  );
}

function formatAiSpeechStatus(
  status: AiSpeechStatus,
  error: string | null,
  audio?: VoiceIntentResponse["respuesta_ia_audio"] | null,
) {
  if (status === "loading") {
    return "cargando audio";
  }

  if (status === "playing") {
    return "reproduciendo";
  }

  if (status === "paused") {
    return "pausado";
  }

  if (status === "error") {
    return error ?? audio?.error ?? "audio no disponible";
  }

  if (status === "unavailable" || audio?.available === false) {
    return audio?.error ?? "audio no disponible";
  }

  if (audio?.available) {
    return "listo para escuchar";
  }

  return "pendiente";
}

function InfoRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  if (wide) {
    return (
      <div className="grid min-w-0 gap-1 border-b border-white/5 pb-2 last:border-none last:pb-0">
        <span className="text-slate-500">{label}</span>
        <span className="min-w-0 whitespace-pre-wrap break-words text-slate-200 [overflow-wrap:anywhere]">
          {value}
        </span>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1 border-b border-white/5 pb-2 last:border-none last:pb-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-slate-200 [overflow-wrap:anywhere] sm:text-right">
        {value}
      </span>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido";
}

function getMicrophoneErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Permiso de microfono denegado. Activa el microfono para este sitio y vuelve a intentar.";
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No se encontro un microfono disponible en este equipo.";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "El microfono esta siendo usado por otra app o no se puede leer.";
    }
  }

  return getErrorMessage(error);
}

function formatRecordingTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function formatMqttPayload(payload?: MqttLightPayload | null) {
  if (!payload) {
    return "SIN_PAYLOAD";
  }

  const espacio = payload.espacio ?? "desconocido";
  const accion = payload.accion ?? "NONE";

  return `${espacio} ${accion}`;
}

function compactDeliveries(
  deliveries: Array<DeviceCommandDelivery | null | undefined> | null | undefined,
) {
  return (deliveries ?? []).filter(
    (delivery): delivery is DeviceCommandDelivery => Boolean(delivery),
  );
}

function getConfirmationDeliveries(confirmation?: VoiceIntentConfirmResponse | null) {
  const multi = compactDeliveries(confirmation?.deliveries);
  if (multi.length > 0) {
    return multi;
  }

  return compactDeliveries([confirmation?.delivery]);
}

function getVisibleDeliveries(
  confirmation: VoiceIntentConfirmResponse | null,
  response: VoiceIntentResponse | null,
  plan: VoiceIntentResponse["plan"] | undefined,
) {
  const confirmed = getConfirmationDeliveries(confirmation);
  if (confirmed.length > 0) {
    return confirmed;
  }

  const responsePreviews = compactDeliveries(response?.delivery_previews);
  if (responsePreviews.length > 0) {
    return responsePreviews;
  }

  const planPreviews = compactDeliveries(plan?.delivery_previews);
  if (planPreviews.length > 0) {
    return planPreviews;
  }

  return compactDeliveries([response?.delivery, plan?.delivery_preview]);
}

function isTerminalDeliveryStatus(status?: string) {
  return status === "executed" || status === "failed" || status === "expired";
}

function hasDeliveryFailure(deliveries: DeviceCommandDelivery[]) {
  return deliveries.some(
    (delivery) => delivery.status === "failed" || delivery.status === "expired",
  );
}

function buildDeliveryKey(deliveries: DeviceCommandDelivery[]) {
  return deliveries
    .map((delivery) => `${delivery.command_id ?? "preview"}:${delivery.status}:${delivery.transport}`)
    .join("|");
}

function formatHttpDeliveryPayloadList(deliveries: DeviceCommandDelivery[]) {
  if (deliveries.length === 0) {
    return "SIN_PAYLOAD";
  }

  const payloads = deliveries.map((delivery) => ({
    target: delivery.target ?? "led",
    action: delivery.action ?? "none",
    espacio: delivery.espacio ?? "desconocido",
    status: delivery.status,
  }));

  return JSON.stringify(deliveries.length === 1 ? payloads[0] : payloads);
}

function formatDeliveryDeviceIds(deliveries: DeviceCommandDelivery[]) {
  const deviceIds = Array.from(
    new Set(deliveries.map((delivery) => delivery.device_id).filter(Boolean)),
  );

  return deviceIds.length > 0 ? deviceIds.join(", ") : "Pendiente";
}

function formatDeliveryStatus(delivery?: DeviceCommandDelivery | null) {
  if (!delivery) {
    return "Sin entrega pendiente";
  }

  if (delivery.status === "pending_confirmation") {
    return "Lista para confirmar y enviar al ESP32.";
  }

  if (delivery.status === "queued") {
    return "Comando enviado a la cola del ESP32.";
  }

  if (delivery.status === "delivered") {
    return "Comando recibido por el ESP32. Esperando ACK del LED del ambiente.";
  }

  if (delivery.status === "executed") {
    return "LED del ambiente ejecutado y confirmado por el ESP32.";
  }

  if (delivery.status === "failed") {
    return delivery.failure_detail
      ? `Error de ejecucion del ESP32: ${delivery.failure_detail}.`
      : "El ESP32 informo un error de ejecucion.";
  }

  if (delivery.status === "expired") {
    return "El comando expiro sin ejecucion del ESP32.";
  }

  return `Estado de entrega: ${delivery.status}.`;
}

function formatDeliveryListStatus(deliveries: DeviceCommandDelivery[]) {
  if (deliveries.length <= 1) {
    return formatDeliveryStatus(deliveries[0]);
  }

  const total = deliveries.length;
  const executed = deliveries.filter((delivery) => delivery.status === "executed").length;
  const failed = deliveries.filter((delivery) => delivery.status === "failed").length;
  const expired = deliveries.filter((delivery) => delivery.status === "expired").length;

  if (executed === total) {
    return `Todos los LEDs fueron ejecutados y confirmados por el ESP32 (${executed}/${total}).`;
  }

  if (failed > 0) {
    return `Ejecucion parcial: ${executed}/${total} LEDs confirmados y ${failed} con error.`;
  }

  if (expired > 0) {
    return `Ejecucion parcial: ${executed}/${total} LEDs confirmados y ${expired} expirados.`;
  }

  if (deliveries.every((delivery) => delivery.status === "pending_confirmation")) {
    return `${total} comandos listos para confirmar y enviar al ESP32.`;
  }

  return `Comandos en proceso: ${executed}/${total} LEDs confirmados.`;
}

function formatSpaceLabel(space?: string) {
  const normalized = (space ?? "desconocido")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");

  if (["multiple", "todos", "todas", "all"].includes(normalized)) {
    return "Todas";
  }

  const labels: Record<string, string> = {
    sala: "Sala",
    comedor: "Comedor",
    cocina: "Cocina",
    dormitorio: "Dormitorio",
    "cuarto principal": "Dormitorio",
    cuarto_principal: "Dormitorio",
    desconocido: "desconocido",
  };

  return labels[normalized] ?? space ?? "desconocido";
}

function formatLightCommands(commands?: LightCommandView[]) {
  if (!commands || commands.length === 0) {
    return "Pendiente";
  }

  return commands
    .map((command) => `${command.accion ?? "NONE"} ${formatSpaceLabel(command.espacio)}`)
    .join(", ");
}

function formatCommandAction(
  plan?: VoiceIntentResponse["plan"],
  intentJson?: VoiceIntentResponse["intencion_json"],
) {
  const commands = plan?.comandos_luces ?? intentJson?.comandos_luces;
  if (commands && commands.length > 1) {
    return formatLightCommands(commands);
  }

  return plan?.action ?? intentJson?.accion ?? "Pendiente";
}

function formatCommandSpaces(
  plan?: VoiceIntentResponse["plan"],
  intentJson?: VoiceIntentResponse["intencion_json"],
) {
  const commands = plan?.comandos_luces ?? intentJson?.comandos_luces;
  if (commands && commands.length > 1) {
    return commands.map((command) => formatSpaceLabel(command.espacio)).join(", ");
  }

  return formatSpaceLabel(plan?.espacio ?? intentJson?.espacio ?? "Pendiente");
}

function formatIntentJson(intentJson?: VoiceIntentResponse["intencion_json"]) {
  if (!intentJson) {
    return "Pendiente";
  }

  const payload: Record<string, unknown> = {
    intencion: intentJson.intencion ?? "otra",
    espacio: intentJson.espacio ?? "desconocido",
    accion: intentJson.accion ?? "NONE",
  };

  if (intentJson.comandos_luces?.length) {
    payload.comandos_luces = intentJson.comandos_luces;
  }

  return JSON.stringify(payload);
}

function buildDashboardStatusReply(
  connection: BackendConnectionState,
  activeContext: string,
) {
  if (connection === "online") {
    return (
      `Aun no he recibido una pregunta por voz en ${activeContext}. ` +
      "El dashboard esta conectado al backend y por ahora muestra dispositivos de prueba; cuando hables, la respuesta IA para el usuario se ajustara exactamente a lo que preguntes."
    );
  }

  if (connection === "checking") {
    return (
      "Estoy verificando la conexion con el backend. Cuando envies una pregunta por voz, respondere acorde a esa solicitud y separare el JSON tecnico para los dispositivos."
    );
  }

  if (connection === "uploading") {
    return (
      "Estoy procesando la solicitud de voz con la IA. Cuando el backend responda, separare la respuesta para el usuario del JSON tecnico para el dispositivo."
    );
  }

  return (
    "El dashboard no tiene una conexion estable con el backend en este momento. Los modulos visibles son de prueba y no representan dispositivos reales listos para ejecutar acciones."
  );
}

function formatDashboardDeviceJson(
  connection: BackendConnectionState,
  activeContext: string,
) {
  return JSON.stringify({
    estado: connection,
    contexto: activeContext,
    intencion: "otra",
    dispositivos: "demo",
    hardware_real_confirmado: false,
    accion: "NONE",
  });
}

function formatModuleLabel(module?: string) {
  if (module === "lights") {
    return "Luces";
  }

  if (module === "cameras") {
    return "Camaras";
  }

  if (module === "doors") {
    return "Puertas";
  }

  if (module === "drones") {
    return "Drones";
  }

  if (module === "general") {
    return "Sistema";
  }

  return "Pendiente";
}

function getConnectionPalette(state: BackendConnectionState) {
  if (state === "online") {
    return "border-[#8ee89d]/30 bg-[#8ee89d]/10 text-[#b9f3c2]";
  }

  if (state === "offline" || state === "error") {
    return "border-[#ff8a9f]/30 bg-[#ff8a9f]/10 text-[#ffc1cb]";
  }

  if (state === "uploading") {
    return "border-[#44c7f4]/30 bg-[#44c7f4]/10 text-[#b7ebff]";
  }

  return "border-white/15 bg-white/10 text-slate-200";
}

function getConnectionTone(state: BackendConnectionState) {
  if (state === "online") {
    return "bg-[#8ee89d]";
  }

  if (state === "offline" || state === "error") {
    return "bg-[#ff8a9f]";
  }

  if (state === "uploading") {
    return "bg-[#44c7f4]";
  }

  return "bg-[#f6c563]";
}

function getConnectionLabel(state: BackendConnectionState) {
  if (state === "online") {
    return "Backend online";
  }

  if (state === "offline") {
    return "Backend offline";
  }

  if (state === "uploading") {
    return "Subiendo audio";
  }

  if (state === "error") {
    return "Error de conexion";
  }

  return "Verificando red";
}

function getSignalLabel(state: BackendConnectionState) {
  if (state === "online") {
    return "Sincronizado";
  }

  if (state === "offline") {
    return "Sin enlace";
  }

  if (state === "uploading") {
    return "Enviando";
  }

  if (state === "error") {
    return "Con fallo";
  }

  return "Chequeando";
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 9.5a4 4 0 0 1 0 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.5 7a8 8 0 0 1 0 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7 7h10v10H7V7Z" fill="currentColor" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function LightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.93.68-1.5 1.73-1.5 2.88V18h-4v-.62c0-1.15-.57-2.2-1.5-2.88Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function DoorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 3h9a2 2 0 0 1 2 2v16l-11-2V3Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M13 12h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 8h11a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Zm14.5 2.5 2.5-1.5v9l-2.5-1.5v-6Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <circle cx="10.5" cy="13.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function DroneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 12h6M12 9v6M7 7l2 2M17 7l-2 2M7 17l2-2M17 17l-2-2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <circle cx="5.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="5.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18.5" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
