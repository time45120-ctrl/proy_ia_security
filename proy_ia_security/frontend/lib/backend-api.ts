export type BackendConnectionState =
  | "checking"
  | "online"
  | "offline"
  | "uploading"
  | "error";

export type VoiceIntentResponse = {
  ok?: boolean;
  texto_transcrito?: string;
  accion_mqtt_led?: string;
  accion_mqtt_rgb?: string;
  ia_json?: {
    intencion?: string;
    detalle?: string;
    estado_animo?: string;
  } | null;
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
