export type BackendConnectionState =
  | "checking"
  | "online"
  | "offline"
  | "uploading"
  | "error";

export type VoiceIntentJson = {
  texto?: string;
  intencion?: "control_luces" | "otra" | string;
  detalle?: string;
  espacio?: "sala" | "comedor" | "cocina" | "cuarto_principal" | "desconocido" | string;
  accion?: "ON" | "OFF" | "NONE" | string;
};

export type MqttLightPayload = {
  espacio?: string;
  accion?: string;
};

export type VoiceIntentResponse = {
  ok?: boolean;
  ai_provider?: string;
  fase_1_audio_guardado?: {
    filename?: string;
    saved_path?: string;
    content_type?: string;
  };
  fase_2_transcripcion?: {
    texto_transcrito?: string;
  };
  fase_3_ia_json?: {
    ia_raw?: string;
    ia_json_raw?: VoiceIntentJson | null;
    ia_json?: VoiceIntentJson | null;
  };
  fase_4_mqtt?: {
    accion_mqtt?: string;
    mqtt_topic?: string;
    mqtt_payload?: MqttLightPayload | null;
  };
};

const DEFAULT_API_BASE_URL = "http://192.168.0.220:8000";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

export async function pingBackend() {
  const response = await fetch(`${API_BASE_URL}/ping`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as { pong?: boolean };
}

export async function sendVoiceIntent(file: File) {
  const formData = new FormData();
  formData.append("audio", file, file.name);

  const response = await fetch(`${API_BASE_URL}/voice-intent`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as VoiceIntentResponse;
}
