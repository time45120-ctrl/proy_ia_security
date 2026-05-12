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
  device_id?: string;
};

export type MqttPreview = {
  mqtt_topic?: string;
  mqtt_payload?: MqttLightPayload | null;
};

export type VoiceIntentPlan = {
  request_id: string;
  respuesta: string;
  steps: string[];
  can_execute: boolean;
  module: "lights" | "doors" | "cameras" | "drones" | "general" | string;
  action: string;
  espacio: string;
  mqtt_preview?: MqttPreview | null;
  expires_at?: string;
};

export type VoiceIntentResponse = {
  ok?: boolean;
  ai_provider?: string;
  intencion_json?: VoiceIntentJson | null;
  respuesta_usuario?: string;
  respuesta_json_dispositivo?: VoiceIntentJson | null;
  respuesta_ia_usuario?: string;
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
    intencion_json?: VoiceIntentJson | null;
    respuesta_usuario?: string;
    respuesta_json_dispositivo?: VoiceIntentJson | null;
    respuesta_ia_usuario?: string;
  };
  fase_4_mqtt?: {
    accion_mqtt?: string;
    mqtt_topic?: string;
    mqtt_payload?: MqttLightPayload | null;
  };
  plan?: VoiceIntentPlan;
};

export type VoiceIntentConfirmResponse = {
  ok?: boolean;
  executed?: boolean;
  message?: string;
  plan?: VoiceIntentPlan;
  fase_4_mqtt?: {
    accion_mqtt?: string;
    mqtt_topic?: string;
    mqtt_payload?: MqttLightPayload | null;
  };
};

export type LinkedDeviceRecord = {
  device_id: string;
  name: string;
  type: string;
  model: string;
  status: "pending" | "online" | "offline" | "linked" | string;
  status_label: string;
  mqtt_topic: string;
  last_seen?: string | null;
  created_at: string;
  pairing_expires_at?: string | null;
  claimed_at?: string | null;
};

export type PairingTokenResponse = {
  ok: boolean;
  device_id: string;
  pairing_token: string;
  pairing_expires_at: string;
  api_url: string;
  esp32_portal_url: string;
  mqtt_topic: string;
  mqtt_server: string;
  mqtt_port: number;
  mqtt_tls: boolean;
};

const DEFAULT_API_BASE_URL = "https://api.afcrseguridad.com";
const PRODUCTION_FRONTEND_HOSTS = new Set([
  "afcrseguridad.com",
  "www.afcrseguridad.com",
]);

function getBrowserLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.location;
}

function isLocalOrPrivateHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function normalizeApiBaseUrl(value: string) {
  const trimmedValue = value.trim().replace(/\/+$/, "");

  try {
    const url = new URL(trimmedValue);
    const browserLocation = getBrowserLocation();

    if (
      browserLocation &&
      PRODUCTION_FRONTEND_HOSTS.has(browserLocation.hostname) &&
      isLocalOrPrivateHost(url.hostname)
    ) {
      return DEFAULT_API_BASE_URL;
    }

    if (url.protocol === "http:" && url.hostname === "api.afcrseguridad.com") {
      url.protocol = "https:";
    }

    if (
      browserLocation?.protocol === "https:" &&
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    ) {
      url.protocol = "https:";
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmedValue;
  }
}

export const API_BASE_URL = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
);

export async function pingBackend() {
  const response = await fetch(`${API_BASE_URL}/ping`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as { pong?: boolean };
}

export async function sendVoiceIntentPreview(file: File) {
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

export async function confirmVoiceIntentPlan(requestId: string) {
  const response = await fetch(`${API_BASE_URL}/voice-intent/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request_id: requestId }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as VoiceIntentConfirmResponse;
}

export async function listDevices() {
  const response = await fetch(`${API_BASE_URL}/devices`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as {
    ok?: boolean;
    devices?: LinkedDeviceRecord[];
  };
}

export async function createPairingToken(input: {
  name: string;
  type: string;
  model: string;
  network?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/devices/pairing-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as PairingTokenResponse;
}
