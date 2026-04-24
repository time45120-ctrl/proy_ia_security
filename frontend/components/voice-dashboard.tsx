"use client";

import type { ChangeEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import {
  API_BASE_URL,
  pingBackend,
  sendVoiceIntent,
  type BackendConnectionState,
  type VoiceIntentResponse,
} from "@/lib/backend-api";

type DeviceCard = {
  id: string;
  title: string;
  count: number;
  accent: string;
  label: string;
  description: string;
  status: string;
  items: string[];
  Icon: (props: { className?: string }) => ReactElement;
};

const devices: DeviceCard[] = [
  {
    id: "lights",
    title: "Luces conectadas",
    count: 12,
    accent: "from-[#44c7f4]/30 via-[#44c7f4]/12 to-transparent",
    label: "Iluminacion",
    description: "Zonas listas para responder a las ordenes de la IA.",
    status: "10 activas / 2 en espera",
    items: ["Laboratorio", "Pasillo", "Acceso principal"],
    Icon: LightIcon,
  },
  {
    id: "doors",
    title: "Puertas conectadas",
    count: 4,
    accent: "from-[#f6c563]/30 via-[#f6c563]/12 to-transparent",
    label: "Acceso",
    description: "Control visual del perimetro y de los puntos de entrada.",
    status: "3 cerradas / 1 monitoreada",
    items: ["Puerta frontal", "Cuarto tecnico", "Porton lateral"],
    Icon: DoorIcon,
  },
  {
    id: "cameras",
    title: "Camaras conectadas",
    count: 6,
    accent: "from-[#8ee89d]/30 via-[#8ee89d]/12 to-transparent",
    label: "Vigilancia",
    description: "Vision del sistema lista para crecer con nuevos modulos.",
    status: "4 en linea / 2 en standby",
    items: ["Entrada", "Patio", "Zona de pruebas"],
    Icon: CameraIcon,
  },
];

const metrics = [
  { label: "Nodos visibles", value: "22", helper: "luces, puertas y camaras" },
  { label: "Estado de red", value: "Estable", helper: "backend IoT disponible" },
  { label: "Modo actual", value: "Etapa inicial", helper: "voz como nucleo central" },
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
      setResponse(payload);
      setConnection("online");
      setStatusText(
        payload.texto_transcrito
          ? `Ultima transcripcion: "${payload.texto_transcrito}".`
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

  return (
    <main className="dashboard-grid min-h-screen overflow-hidden px-4 py-6 text-slate-50 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="panel-surface overflow-hidden rounded-[32px] border border-white/10 shadow-glow">
          <div className="flex flex-col gap-6 border-b border-white/10 px-6 py-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-mist">
                proy_ia_security
              </div>
              <h1 className="font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
                Dashboard domotico con IA de voz como nucleo operativo.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                La primera etapa del sistema muestra a la IA en el centro y los
                subsistemas conectados a su alrededor. Ya puedes enviar voz al
                backend actual mientras dejamos lista una base escalable para el
                resto de la domotica.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {metrics.map((metric) => (
                <article
                  key={metric.label}
                  className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4"
                >
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                    {metric.label}
                  </p>
                  <p className="mt-3 font-display text-2xl text-white">
                    {metric.value}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">{metric.helper}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.5fr_0.9fr] lg:px-8 lg:py-8">
            <section className="panel-surface rounded-[30px] border border-white/10 p-4 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                    Visualizacion general
                  </p>
                  <h2 className="mt-2 font-display text-2xl text-white">
                    Nucleo de control por voz
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge connection={connection} />
                  <button
                    type="button"
                    onClick={() => void handlePing()}
                    className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isChecking}
                  >
                    {isChecking ? "Verificando..." : "Probar API"}
                  </button>
                </div>
              </div>

              <div className="relative mt-8 min-h-[640px] rounded-[28px] border border-white/10 bg-[#07111f]/80 p-4 sm:p-6">
                <div className="absolute inset-0 rounded-[28px] bg-[radial-gradient(circle_at_center,rgba(68,199,244,0.12),transparent_42%)]" />
                <div className="absolute left-1/2 top-1/2 hidden h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-accent/20 xl:block" />
                <div className="absolute left-1/2 top-1/2 hidden h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10 2xl:block" />

                <div className="relative z-10 grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
                  <OrbitCard
                    className="xl:absolute xl:left-8 xl:top-12 xl:w-[280px]"
                    device={devices[0]}
                  />
                  <OrbitCard
                    className="xl:absolute xl:right-8 xl:top-14 xl:w-[280px]"
                    device={devices[1]}
                  />
                  <OrbitCard
                    className="xl:absolute xl:bottom-12 xl:left-1/2 xl:w-[320px] xl:-translate-x-1/2"
                    device={devices[2]}
                  />
                </div>

                <div className="relative z-20 mx-auto mt-6 flex min-h-[420px] max-w-xl items-center justify-center xl:min-h-[580px]">
                  <div className="absolute h-52 w-52 rounded-full bg-accent/15 blur-3xl sm:h-64 sm:w-64" />
                  <div className="absolute h-72 w-72 rounded-full border border-accent/15" />
                  <div className="absolute h-80 w-80 rounded-full border border-white/10" />

                  <button
                    type="button"
                    onClick={handleVoiceNodeClick}
                    className="relative flex h-52 w-52 flex-col items-center justify-center gap-3 rounded-full border border-accent/30 bg-[radial-gradient(circle_at_top,rgba(68,199,244,0.35),rgba(10,20,35,0.98)_70%)] p-6 text-center shadow-[0_0_0_14px_rgba(68,199,244,0.05),0_24px_90px_rgba(0,0,0,0.35)] transition duration-300 hover:scale-[1.02] hover:border-accent/50 sm:h-60 sm:w-60"
                  >
                    <div className="absolute inset-4 rounded-full border border-white/10" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10">
                      <MicIcon className="h-8 w-8 text-white" />
                    </div>
                    <div className="relative">
                      <p className="font-display text-xl text-white sm:text-2xl">
                        Guia IA
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Pulsa aqui para enviar voz al sistema.
                      </p>
                    </div>
                    <span className="relative rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-200">
                      {isUploading ? "Uploading" : "Audio"}
                    </span>
                  </button>
                </div>

                <input
                  ref={inputRef}
                  type="file"
                  accept="audio/*"
                  capture="user"
                  className="hidden"
                  onChange={(event) => void handleAudioSelected(event)}
                />
              </div>
            </section>

            <aside className="flex flex-col gap-6">
              <article className="panel-surface rounded-[30px] border border-white/10 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      Estado operativo
                    </p>
                    <h3 className="mt-2 font-display text-2xl text-white">
                      Centro de actividad
                    </h3>
                  </div>
                  <SignalPill state={connection} />
                </div>

                <div className="mt-5 rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-slate-300">{statusText}</p>
                  <div className="mt-4 grid gap-3 text-sm text-slate-400">
                    <InfoRow label="API actual" value={API_BASE_URL} />
                    <InfoRow label="Estado UI" value={getConnectionLabel(connection)} />
                    <InfoRow label="Ultimo archivo" value={lastFileName} />
                    <InfoRow
                      label="Intencion detectada"
                      value={response?.ia_json?.intencion ?? "Pendiente"}
                    />
                    <InfoRow
                      label="Estado de animo"
                      value={response?.ia_json?.estado_animo ?? "Pendiente"}
                    />
                    <InfoRow
                      label="Detalle IA"
                      value={response?.ia_json?.detalle ?? "Pendiente"}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <SmallStat
                    title="LED"
                    value={response?.accion_mqtt_led ?? "SIN_ACCION_LED"}
                    accent="bg-[#44c7f4]/15 text-[#9edfff]"
                  />
                  <SmallStat
                    title="RGB"
                    value={response?.accion_mqtt_rgb ?? "SIN_ACCION_RGB"}
                    accent="bg-[#8ee89d]/15 text-[#b4f4be]"
                  />
                </div>
              </article>

              <article className="panel-surface rounded-[30px] border border-white/10 p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                  Escalabilidad
                </p>
                <h3 className="mt-2 font-display text-2xl text-white">
                  Siguiente expansion del dashboard
                </h3>

                <div className="mt-5 space-y-3">
                  {[
                    "Agregar telemetria real por dispositivo via MQTT o WebSocket.",
                    "Mapear acciones de puertas y camaras a la misma guia IA.",
                    "Crear vistas detalladas por zona sin perder la pantalla central.",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300"
                    >
                      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel-surface rounded-[30px] border border-white/10 p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                  Respuesta de la IA
                </p>
                <h3 className="mt-2 font-display text-2xl text-white">
                  Trazabilidad visible
                </h3>

                <div className="mt-5 rounded-3xl border border-white/10 bg-[#050c16] p-4">
                  {errorText ? (
                    <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-200">
                      {errorText}
                    </div>
                  ) : null}
                  <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {response
                      ? JSON.stringify(response, null, 2)
                      : "Aun no hay respuesta del backend."}
                  </pre>
                </div>
              </article>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function OrbitCard({
  device,
  className,
}: {
  device: DeviceCard;
  className?: string;
}) {
  return (
    <article
      className={`panel-surface rounded-[28px] border border-white/10 p-5 shadow-glow ${className ?? ""}`}
    >
      <div className={`rounded-3xl bg-gradient-to-br p-[1px] ${device.accent}`}>
        <div className="rounded-3xl bg-[#08111f]/95 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                {device.label}
              </p>
              <h3 className="mt-2 font-display text-2xl text-white">
                {device.title}
              </h3>
            </div>

            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
              <device.Icon className="h-6 w-6 text-white" />
            </div>
          </div>

          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="font-display text-4xl text-white">{device.count}</p>
              <p className="mt-2 text-sm text-slate-400">{device.status}</p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-200">
              conectado
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            {device.description}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {device.items.map((item) => (
              <span
                key={item}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
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
    <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-none last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[14rem] truncate text-right text-slate-200">{value}</span>
    </div>
  );
}

function SmallStat({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{title}</p>
      <div className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${accent}`}>
        {value}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido";
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
