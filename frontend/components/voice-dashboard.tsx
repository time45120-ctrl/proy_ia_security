"use client";

import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import {
  API_BASE_URL,
  pingBackend,
  sendVoiceIntent,
  type BackendConnectionState,
  type MqttLightPayload,
  type VoiceIntentResponse,
} from "@/lib/backend-api";

type DeviceCard = {
  id: string;
  title: string;
  count: number;
  description: string;
  status: string;
  items: string[];
  tone: string;
  Icon: (props: { className?: string }) => ReactElement;
};

const devices: DeviceCard[] = [
  {
    id: "lights",
    title: "Luces por ambiente",
    count: 4,
    description: "Ambientes listos para recibir comandos ON/OFF por MQTT.",
    status: "4 ambientes mapeados",
    items: ["Sala", "Comedor", "Cocina", "Cuarto principal"],
    tone: "text-[#9edfff] bg-[#44c7f4]/10 border-[#44c7f4]/20",
    Icon: LightIcon,
  },
  {
    id: "doors",
    title: "Puertas conectadas",
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
    count: 6,
    description: "Vision del sistema lista para crecer con nuevos modulos.",
    status: "4 en linea / 2 en standby",
    items: ["Entrada", "Patio", "Zona de pruebas"],
    tone: "text-[#b4f4be] bg-[#8ee89d]/10 border-[#8ee89d]/20",
    Icon: CameraIcon,
  },
];

export function VoiceDashboard() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [connection, setConnection] =
    useState<BackendConnectionState>("checking");
  const [lastFileName, setLastFileName] = useState<string>("Sin envio reciente");
  const [statusText, setStatusText] = useState(
    "Pulsa el nucleo de voz para grabar o seleccionar un audio y enviarlo al backend.",
  );
  const [response, setResponse] = useState<VoiceIntentResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    void handlePing();
  }, []);

  async function handlePing() {
    setIsChecking(true);
    setConnection("checking");
    setErrorText(null);

    try {
      await pingBackend();
      setConnection("online");
      setStatusText("Backend conectado. El dashboard esta listo para recibir voz.");
    } catch (error) {
      setConnection("offline");
      setStatusText("No se logro conectar con la API. Revisa la IP del backend.");
      setErrorText(getErrorMessage(error));
    } finally {
      setIsChecking(false);
    }
  }

  function handleVoiceNodeClick() {
    if (isUploading) {
      return;
    }

    inputRef.current?.click();
  }

  async function handleAudioSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploading(true);
    setConnection("uploading");
    setErrorText(null);
    setLastFileName(file.name);
    setStatusText("Subiendo audio al backend y esperando el analisis de la IA...");

    try {
      const payload = await sendVoiceIntent(file);
      const transcript = payload.fase_2_transcripcion?.texto_transcrito;

      setResponse(payload);
      setConnection("online");
      setStatusText(
        transcript
          ? `Ultima transcripcion: "${transcript}".`
          : "Audio enviado correctamente. La IA devolvio una respuesta.",
      );
    } catch (error) {
      setConnection("error");
      setErrorText(getErrorMessage(error));
      setStatusText("No fue posible procesar el audio. Intenta nuevamente.");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  const intentJson = response?.fase_3_ia_json?.ia_json;
  const mqttResult = response?.fase_4_mqtt;
  const transcript =
    response?.fase_2_transcripcion?.texto_transcrito ?? "Sin transcripcion";

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
              camaras, luces y puertas conectadas.
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

        <section className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="order-1 rounded-lg border border-white/10 bg-[#08111f]/90 p-4 shadow-glow sm:p-5 lg:col-start-1 lg:row-span-3 lg:min-h-[34rem] lg:p-6 xl:min-h-[36rem]">
            <div className="grid gap-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  IA central
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-white">
                  Guia IA
                </h2>
              </div>
              <SignalPill state={connection} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[17rem_minmax(0,1fr)]">
              <div>
                <button
                  type="button"
                  onClick={handleVoiceNodeClick}
                  className="mx-auto flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full border border-[#44c7f4]/40 bg-[#061727] p-5 text-center shadow-[0_0_45px_rgba(68,199,244,0.18)] transition hover:scale-[1.02] hover:bg-[#092036] disabled:cursor-not-allowed disabled:opacity-70 sm:h-48 sm:w-48 lg:h-52 lg:w-52 xl:h-56 xl:w-56"
                  disabled={isUploading}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 sm:h-14 sm:w-14">
                    <MicIcon className="h-6 w-6 text-white sm:h-7 sm:w-7" />
                  </span>
                  <span className="font-display text-lg text-white sm:text-xl">
                    {isUploading ? "Procesando" : "Enviar voz"}
                  </span>
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    {isUploading ? "Audio activo" : "Audio"}
                  </span>
                </button>

                <input
                  ref={inputRef}
                  type="file"
                  accept="audio/*"
                  capture="user"
                  className="hidden"
                  onChange={(event) => void handleAudioSelected(event)}
                />

                <p className="mt-5 text-center text-sm leading-6 text-slate-300">
                  {statusText}
                </p>

                {errorText ? (
                  <p className="mt-4 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm leading-6 text-rose-200">
                    {errorText}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2 border-t border-white/10 pt-4 text-sm lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                <InfoRow label="Transcripcion" value={transcript} />
                <InfoRow
                  label="Intencion"
                  value={intentJson?.intencion ?? "Pendiente"}
                />
                <InfoRow label="Ambiente" value={intentJson?.espacio ?? "Pendiente"} />
                <InfoRow label="Accion" value={intentJson?.accion ?? "Pendiente"} />
                <InfoRow
                  label="MQTT"
                  value={mqttResult?.accion_mqtt ?? "SIN_ACCION"}
                />
                <InfoRow
                  label="Payload"
                  value={formatMqttPayload(mqttResult?.mqtt_payload)}
                />
                <InfoRow
                  label="Topic"
                  value={mqttResult?.mqtt_topic ?? "casa/esp32/luces"}
                />
              </div>
            </div>

            <details className="mt-4 border-t border-white/10 pt-4 text-sm text-slate-300">
              <summary className="cursor-pointer text-slate-200">
                Respuesta completa
              </summary>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[#050c16] p-3 text-xs leading-5 text-slate-300">
                {response
                  ? JSON.stringify(response, null, 2)
                  : "Aun no hay respuesta del backend."}
              </pre>
            </details>
          </section>

          <SystemCard
            device={devices[2]}
            className="order-2 lg:order-none lg:col-start-2 lg:row-start-1"
          />

          <SystemCard
            device={devices[0]}
            className="order-3 lg:order-none lg:col-start-2 lg:row-start-2"
          />

          <SystemCard
            device={devices[1]}
            className="order-4 lg:order-none lg:col-start-2 lg:row-start-3"
          />
        </section>
      </div>
    </main>
  );
}

function SystemCard({
  device,
  className,
}: {
  device: DeviceCard;
  className?: string;
}) {
  return (
    <article
      className={`rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5 lg:p-4 xl:p-5 ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold leading-tight text-white sm:text-xl lg:text-lg xl:text-xl">
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

      <div className="mt-5 flex items-end justify-between gap-4 lg:mt-4 xl:mt-6">
        <p className="font-display text-4xl font-semibold text-white sm:text-5xl lg:text-4xl xl:text-5xl">
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-white/5 pb-2 last:border-none last:pb-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
      <span className="text-slate-500">{label}</span>
      <span className="break-words text-slate-200 sm:text-right">{value}</span>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido";
}

function formatMqttPayload(payload?: MqttLightPayload | null) {
  if (!payload) {
    return "SIN_PAYLOAD";
  }

  const espacio = payload.espacio ?? "desconocido";
  const accion = payload.accion ?? "NONE";

  return `${espacio} ${accion}`;
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
