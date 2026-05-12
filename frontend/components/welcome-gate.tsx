"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { VoiceDashboard } from "@/components/voice-dashboard";
import {
  API_BASE_URL,
  createPairingToken,
  listDevices,
  type LinkedDeviceRecord,
  type PairingTokenResponse,
} from "@/lib/backend-api";

const heroImageUrl =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuDqWiFZT724rqYi7LN287axHfinPHKjd5W28KOvOc7Ln0D1SJN66Og1Pcl4X6YLiUoQwRyWHto6LAVhLhcfO-kt101rbQUQn0vWeaXhmdCjZGTMwdyi3eeK6py4eqnVs4CiMI76xJeqK9q3zzlVmYRsig3AyRXWbYUoirjNr2PM3ToTiEgrhIoKZGn7uOit4VLRncVmsShe0bU4rpxHCAOwFn_sAoVo4piKt1a_5ZfODG0_0-eiMdn4XkZnTobLe708E-ivNz6N7c50";
const frontendBuildLabel = "f1.10";

type AppView = "welcome" | "sync" | "dashboard";
type DeviceType = "Luces" | "Camaras" | "Puertas" | "Drones";

const deviceTypes: DeviceType[] = ["Luces", "Camaras", "Puertas", "Drones"];
const deviceModelOptions = ["ESP32"];
const deviceNameOptions = [
  "Luz cocina",
  "Luz sala",
  "Luz comedor",
  "Luz dormitorio principal",
  "Luz cochera",
];

const demoLinkedDevice: LinkedDeviceRecord = {
  device_id: "demo-luz-cocina",
  name: "Luz cocina",
  type: "Luces",
  model: "ESP32",
  status: "online",
  status_label: "Online demo",
  mqtt_topic: "afcr/devices/demo-luz-cocina/commands",
  last_seen: "2026-05-12T00:00:00.000Z",
  created_at: "2026-05-12T00:00:00.000Z",
  pairing_expires_at: null,
  claimed_at: "2026-05-12T00:00:00.000Z",
};

function withDemoLinkedDevice(devices: LinkedDeviceRecord[]) {
  const withoutDemo = devices.filter(
    (device) => device.device_id !== demoLinkedDevice.device_id,
  );

  return [demoLinkedDevice, ...withoutDemo];
}

export function WelcomeGate() {
  const [view, setView] = useState<AppView>("welcome");
  const [linkedDevices, setLinkedDevices] = useState<LinkedDeviceRecord[]>([
    demoLinkedDevice,
  ]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dashboardResetSignal, setDashboardResetSignal] = useState(0);

  async function refreshDevices() {
    try {
      const payload = await listDevices();
      setLinkedDevices(withDemoLinkedDevice(payload.devices ?? []));
    } catch (error) {
      setNotice(getErrorMessage(error));
      setLinkedDevices((current) => withDemoLinkedDevice(current));
    }
  }

  useEffect(() => {
    if (view !== "welcome") {
      void refreshDevices();
    }
  }, [view]);

  if (view === "welcome") {
    return <WelcomeScreen onStart={() => setView("sync")} />;
  }

  const linkedCount = linkedDevices.filter((device) => device.claimed_at).length;
  const canOpenDashboard = linkedCount > 0;

  function handleNavigate(nextView: Exclude<AppView, "welcome">) {
    if (nextView === "dashboard" && !canOpenDashboard) {
      setView("sync");
      setNotice("Primero enlaza al menos un dispositivo para abrir el dashboard.");
      return;
    }

    setNotice(null);
    if (nextView === "dashboard") {
      setDashboardResetSignal((current) => current + 1);
    }
    setView(nextView);
  }

  return (
    <AppShell
      activeView={view}
      linkedCount={linkedCount}
      canOpenDashboard={canOpenDashboard}
      onNavigate={handleNavigate}
    >
      {view === "dashboard" ? (
        <VoiceDashboard resetSignal={dashboardResetSignal} />
      ) : (
        <SyncPage
          linkedDevices={linkedDevices}
          notice={notice}
          onDevicesChanged={() => void refreshDevices()}
          onOpenDashboard={() => handleNavigate("dashboard")}
        />
      )}
    </AppShell>
  );
}

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <main
      data-build={frontendBuildLabel}
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10 text-center text-[#dde3e7] sm:px-8"
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[28rem] w-[28rem] rounded-full bg-[#4cd6ff]/10 blur-[120px] sm:h-[44rem] sm:w-[44rem]" />
      </div>

      <section className="relative z-10 flex w-full max-w-5xl flex-col items-center">
        <div className="mb-6 flex h-64 w-full max-w-2xl items-center justify-center sm:h-80">
          <img
            src={heroImageUrl}
            alt="Casa inteligente en modelo 3D de lineas luminosas"
            className="h-full w-full rounded-xl border border-white/10 object-cover opacity-85 shadow-[0_0_50px_rgba(76,214,255,0.16)] mix-blend-screen"
          />
        </div>

        <div className="w-full max-w-3xl rounded-xl border border-white/10 border-t-white/20 bg-[#161d1f]/70 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-10">
          <h1 className="font-display text-4xl font-bold leading-tight text-white sm:text-5xl">
            Bienvenido al Futuro de tu Hogar
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#bbc9cf]">
            Tu asistente personal con IA esta listo para orquestar cada rincon de
            tu espacio.
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">
            Version {frontendBuildLabel}
          </p>

          <button
            type="button"
            onClick={onStart}
            className="mx-auto mt-8 inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-[#a4e6ff] px-6 py-3 font-display text-xs font-semibold uppercase tracking-[0.12em] text-[#003543] shadow-[0_0_18px_rgba(0,209,255,0.35)] transition hover:bg-[#b7eaff] hover:shadow-[0_0_28px_rgba(0,209,255,0.45)] focus:outline-none focus:ring-2 focus:ring-[#4cd6ff] focus:ring-offset-2 focus:ring-offset-[#0e1417]"
          >
            Comenzar Configuracion
            <span aria-hidden="true" className="text-lg leading-none">
              -&gt;
            </span>
          </button>
        </div>
      </section>
    </main>
  );
}

function AppShell({
  activeView,
  linkedCount,
  canOpenDashboard,
  onNavigate,
  children,
}: {
  activeView: Exclude<AppView, "welcome">;
  linkedCount: number;
  canOpenDashboard: boolean;
  onNavigate: (view: Exclude<AppView, "welcome">) => void;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen text-slate-50 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#07111d]/95 px-4 py-4 backdrop-blur-xl lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <div className="flex items-center justify-between gap-4 lg:block">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
              Aura Home AI
            </p>
            <h1 className="mt-2 font-display text-xl font-semibold text-white">
              Panel central
            </h1>
          </div>
          <div className="rounded-lg border border-[#44c7f4]/20 bg-[#44c7f4]/10 px-3 py-2 text-right lg:mt-6 lg:text-left">
            <p className="font-display text-2xl font-semibold text-white">
              {linkedCount}
            </p>
            <p className="text-xs uppercase tracking-[0.16em] text-[#9edfff]">
              enlazados
            </p>
          </div>
        </div>

        <nav className="mt-5 grid gap-2 sm:grid-cols-2 lg:mt-8 lg:grid-cols-1">
          <NavButton
            label="Sincronizacion"
            isActive={activeView === "sync"}
            onClick={() => onNavigate("sync")}
          />
          <NavButton
            label="Dashboard Principal"
            isActive={activeView === "dashboard"}
            isLocked={!canOpenDashboard}
            onClick={() => onNavigate("dashboard")}
          />
        </nav>
      </aside>

      <section className="min-w-0">{children}</section>
    </main>
  );
}

function NavButton({
  label,
  isActive,
  isLocked,
  onClick,
}: {
  label: string;
  isActive: boolean;
  isLocked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition ${
        isActive
          ? "border-[#44c7f4]/40 bg-[#44c7f4]/15 text-white shadow-[0_0_22px_rgba(68,199,244,0.12)]"
          : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
      }`}
    >
      <span>{label}</span>
      <span className="text-xs uppercase tracking-[0.14em] text-slate-400">
        {isLocked ? "Bloqueado" : isActive ? "Activo" : "Abrir"}
      </span>
    </button>
  );
}

function PairingValue({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#050c16]/70 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-slate-100">{String(value)}</p>
    </div>
  );
}

function SyncPage({
  linkedDevices,
  notice,
  onDevicesChanged,
  onOpenDashboard,
}: {
  linkedDevices: LinkedDeviceRecord[];
  notice: string | null;
  onDevicesChanged: () => void;
  onOpenDashboard: () => void;
}) {
  const [deviceType, setDeviceType] = useState<DeviceType>("Luces");
  const [deviceModel, setDeviceModel] = useState(deviceModelOptions[0]);
  const [deviceName, setDeviceName] = useState(deviceNameOptions[0]);
  const [networkName, setNetworkName] = useState("");
  const [isCreatingPairing, setIsCreatingPairing] = useState(false);
  const [pairingInfo, setPairingInfo] = useState<
    (PairingTokenResponse & {
      network: string;
      deviceName: string;
      deviceType: string;
      model: string;
    }) | null
  >(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const linkedCount = linkedDevices.filter((device) => device.claimed_at).length;
  const pendingCount = linkedDevices.filter((device) => device.status === "pending").length;
  const canSubmit =
    deviceModel.trim().length > 0 &&
    deviceName.trim().length > 0 &&
    networkName.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsCreatingPairing(true);
    setLocalNotice(null);

    try {
      const pairing = await createPairingToken({
        type: deviceType,
        model: deviceModel.trim(),
        name: deviceName.trim(),
        network: networkName.trim(),
      });

      setPairingInfo({
        ...pairing,
        network: networkName.trim(),
        deviceName: deviceName.trim(),
        deviceType,
        model: deviceModel.trim(),
      });
      setLocalNotice("Token creado. Configura el ESP32 desde su portal WiFi temporal.");
      setNetworkName("");
      onDevicesChanged();
    } catch (error) {
      setLocalNotice(getErrorMessage(error));
    } finally {
      setIsCreatingPairing(false);
    }
  }

  return (
    <div className="min-h-screen px-3 py-4 sm:px-5 lg:px-8 xl:px-10">
      <div className="mx-auto grid w-full max-w-6xl gap-4 sm:gap-5">
        <header className="border-b border-white/10 pb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
            enlace de dispositivos
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-white sm:text-3xl lg:text-4xl">
            Sincronizacion de dispositivos Empresa ABC
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Registra los dispositivos del cliente, indica la red a la que se
            conectaran y confirma visualmente que ya quedaron enlazados.
          </p>
          <p className="mt-2 break-all text-xs text-slate-500">
            API activa: <span className="text-slate-300">{API_BASE_URL}</span>
          </p>
        </header>

        {notice || localNotice ? (
          <p className="rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 px-4 py-3 text-sm leading-6 text-[#b7ebff]">
            {localNotice ?? notice}
          </p>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-white/10 bg-[#08111f]/90 p-4 shadow-glow sm:p-5 lg:p-6"
          >
            <div className="grid gap-5">
              <label className="grid gap-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  tipo de dispositivo
                </span>
                <select
                  value={deviceType}
                  onChange={(event) => setDeviceType(event.target.value as DeviceType)}
                  className="min-h-12 rounded-lg border border-white/10 bg-[#050c16] px-3 text-white outline-none transition focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
                >
                  {deviceTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  modelo de dispositivo
                </span>
                <select
                  value={deviceModel}
                  onChange={(event) => setDeviceModel(event.target.value)}
                  className="min-h-12 rounded-lg border border-white/10 bg-[#050c16] px-3 text-white outline-none transition focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
                >
                  {deviceModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  nombre o identificador
                </span>
                <select
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  className="min-h-12 rounded-lg border border-white/10 bg-[#050c16] px-3 text-white outline-none transition focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
                >
                  {deviceNameOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-slate-300">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                  red WiFi o red local
                </span>
                <input
                  value={networkName}
                  onChange={(event) => setNetworkName(event.target.value)}
                  placeholder="Ej. Casa_2.4G, Laboratorio IoT"
                  className="min-h-12 rounded-lg border border-white/10 bg-[#050c16] px-3 text-white outline-none transition placeholder:text-slate-600 focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
                />
              </label>

              <button
                type="submit"
                disabled={!canSubmit || isCreatingPairing}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#a4e6ff] px-5 py-3 font-display text-xs font-semibold uppercase tracking-[0.12em] text-[#003543] shadow-[0_0_18px_rgba(0,209,255,0.28)] transition hover:bg-[#b7eaff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingPairing ? "Creando token..." : "Crear enlace ESP32"}
              </button>
            </div>
          </form>

          <aside className="rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              progreso
            </p>
            <p className="mt-3 font-display text-5xl font-semibold text-white">
              {linkedCount}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {linkedCount > 0
                ? "La aplicacion ya tiene dispositivos reclamados por ESP32 reales."
                : pendingCount > 0
                  ? "Hay enlaces pendientes. Reclama el token desde el portal del ESP32."
                  : "Crea un enlace y reclama el token desde el ESP32 para continuar."}
            </p>
            <button
              type="button"
              onClick={onOpenDashboard}
              disabled={linkedCount === 0}
              className="mt-6 w-full rounded-lg border border-[#44c7f4]/30 bg-[#44c7f4]/10 px-4 py-3 text-sm font-semibold text-[#b7ebff] transition hover:bg-[#44c7f4]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-500"
            >
              Ir al dashboard
            </button>
          </aside>
        </section>

        {pairingInfo ? (
          <section className="rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 p-4 sm:p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
              portal WiFi temporal del ESP32
            </p>
            <h3 className="mt-2 font-display text-xl font-semibold text-white">
              Configura {pairingInfo.deviceName}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Conectate a la red temporal del ESP32, abre{" "}
              <span className="text-white">{pairingInfo.esp32_portal_url}</span> y
              copia estos datos. La contraseña WiFi solo debe escribirse en el portal
              local del ESP32.
            </p>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <PairingValue label="API URL" value={pairingInfo.api_url} />
              <PairingValue label="Token" value={pairingInfo.pairing_token} />
              <PairingValue label="Device ID" value={pairingInfo.device_id} />
              <PairingValue label="Nombre" value={pairingInfo.deviceName} />
              <PairingValue label="Tipo" value={pairingInfo.deviceType} />
              <PairingValue label="Modelo" value={pairingInfo.model} />
              <PairingValue label="SSID seleccionado" value={pairingInfo.network} />
              <PairingValue label="Topic MQTT" value={pairingInfo.mqtt_topic} />
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                dispositivos enlazados
              </p>
              <h3 className="mt-2 font-display text-xl font-semibold text-white">
                Inventario conectado
              </h3>
            </div>
            <button
              type="button"
              onClick={onDevicesChanged}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-300 transition hover:bg-white/[0.06]"
            >
              Actualizar dispositivos
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            {linkedDevices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-400">
                Aun no hay dispositivos creados en el backend.
              </p>
            ) : (
              linkedDevices.map((device) => (
                <article
                  key={device.device_id}
                  className="grid gap-3 rounded-lg border border-white/10 bg-[#050c16]/70 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-[#9edfff]">
                      {device.type}
                    </p>
                    <h4 className="mt-1 font-display text-lg font-semibold text-white">
                      {device.name}
                    </h4>
                  </div>
                  <p className="text-sm text-slate-300">
                    Modelo: <span className="text-white">{device.model}</span>
                    <span className="mx-2 text-slate-600">/</span>
                    Topic: <span className="text-white">{device.mqtt_topic}</span>
                  </p>
                  <span className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.14em] ${getDeviceStatusTone(device.status)}`}>
                    {device.status_label}
                  </span>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function getDeviceStatusTone(status: string) {
  if (status === "online") {
    return "border-[#8ee89d]/30 bg-[#8ee89d]/10 text-[#b9f3c2]";
  }

  if (status === "pending") {
    return "border-[#f6c563]/30 bg-[#f6c563]/10 text-[#ffe0a3]";
  }

  if (status === "offline") {
    return "border-[#ff8a9f]/30 bg-[#ff8a9f]/10 text-[#ffc1cb]";
  }

  return "border-white/10 bg-white/[0.04] text-slate-300";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido";
}
