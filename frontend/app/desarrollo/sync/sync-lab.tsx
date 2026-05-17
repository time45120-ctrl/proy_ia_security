"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import {
  API_BASE_URL,
  createPairingToken,
  type PairingTokenResponse,
} from "@/lib/backend-api";
import { useDevelopmentWorkspace } from "../workspace-context";

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

export function SyncLab() {
  const {
    linkedDevices,
    linkedCount,
    notice,
    refreshDevices,
    openDashboard,
  } = useDevelopmentWorkspace();
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
  const pendingCount = linkedDevices.filter(
    (device) => device.status === "pending",
  ).length;
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
      setLocalNotice(
        "Token creado. Configura el ESP32 desde su portal WiFi temporal.",
      );
      setNetworkName("");
      await refreshDevices();
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
                  onChange={(event) =>
                    setDeviceType(event.target.value as DeviceType)
                  }
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
              onClick={openDashboard}
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
              <span className="text-white">{pairingInfo.esp32_portal_url}</span>{" "}
              y copia estos datos. La contraseña WiFi solo debe escribirse en el
              portal local del ESP32.
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
              onClick={() => void refreshDevices()}
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
                  <span
                    className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.14em] ${getDeviceStatusTone(device.status)}`}
                  >
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

function PairingValue({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#050c16]/70 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-words text-slate-100">{String(value)}</p>
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
