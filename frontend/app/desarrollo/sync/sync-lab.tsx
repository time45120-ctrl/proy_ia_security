"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  API_BASE_URL,
  createPairingToken,
  type PairingTokenResponse,
} from "@/lib/backend-api";
import { useDevelopmentWorkspace } from "../workspace-context";
import { ESP32_DIRECT_SKETCH } from "./esp32-direct-sketch";

type DeviceType = "Luces" | "Camaras" | "Puertas" | "Drones" | "ESP32";

const deviceTypes: DeviceType[] = ["Luces", "Camaras", "Puertas", "Drones", "ESP32"];
const deviceModelOptions = [{ value: "ESP32", label: "ESP32 GENERICO" }];
const legacyDeviceNameOptions = [
  "Luz cocina",
  "Luz sala",
  "Luz comedor",
  "Luz cuarto principal",
  "Luz cochera",
];
const esp32RoomPins = [
  { space: "sala", label: "Sala", gpio: "GPIO 16" },
  { space: "cocina", label: "Cocina", gpio: "GPIO 17" },
  { space: "comedor", label: "Comedor", gpio: "GPIO 18" },
  { space: "dormitorio", label: "Dormitorio", gpio: "GPIO 19" },
] as const;

export function SyncLab() {
  const {
    linkedDevices,
    linkedCount,
    notice,
    refreshDevices,
    openDashboard,
  } = useDevelopmentWorkspace();
  const [deviceType, setDeviceType] = useState<DeviceType>("ESP32");
  const [deviceModel, setDeviceModel] = useState(deviceModelOptions[0].value);
  const [deviceName, setDeviceName] = useState(legacyDeviceNameOptions[0]);
  const [isCreatingPairing, setIsCreatingPairing] = useState(false);
  const [pairingInfo, setPairingInfo] = useState<
    (PairingTokenResponse & {
      deviceName: string;
      deviceType: string;
      model: string;
    }) | null
  >(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const pairingGuideRef = useRef<HTMLElement>(null);
  const isEsp32 = deviceType === "ESP32";
  const nextEsp32DeviceName = getNextEsp32DeviceName(linkedDevices);
  const selectedDeviceName = isEsp32 ? nextEsp32DeviceName : deviceName;
  const pendingCount = linkedDevices.filter(
    (device) => device.status === "pending",
  ).length;
  const canSubmit =
    deviceModel.trim().length > 0 &&
    selectedDeviceName.trim().length > 0;
  const sketchForPairing = pairingInfo
    ? withActiveApiUrl(ESP32_DIRECT_SKETCH, pairingInfo.api_url)
    : ESP32_DIRECT_SKETCH;
  const isLocalLabPairing = pairingInfo
    ? isLocalLabApiUrl(pairingInfo.api_url)
    : false;

  useEffect(() => {
    if (pendingCount === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshDevices();
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [pendingCount, refreshDevices]);

  useEffect(() => {
    if (!pairingInfo) {
      return;
    }

    window.requestAnimationFrame(() => {
      pairingGuideRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [pairingInfo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsCreatingPairing(true);
    setLocalNotice(null);
    setCopyNotice(null);

    try {
      const pairing = await createPairingToken({
        type: deviceType,
        model: deviceModel.trim(),
        name: selectedDeviceName.trim(),
      });

      setPairingInfo({
        ...pairing,
        deviceName: selectedDeviceName.trim(),
        deviceType,
        model: deviceModel.trim(),
      });
      setLocalNotice(
        isEsp32
          ? "Token creado. Pegalo en el sketch y sube el codigo a tu ESP32 por USB."
          : "Token creado. Utilizalo para enlazar el dispositivo seleccionado.",
      );
      await refreshDevices();
    } catch (error) {
      setLocalNotice(getErrorMessage(error));
      window.requestAnimationFrame(() => {
        noticeRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    } finally {
      setIsCreatingPairing(false);
    }
  }

  function copyValue(value: string, label: string) {
    if (copyTextWithTemporarySelection(value)) {
      setCopyNotice(`${label} copiado. Ya puedes pegarlo en Arduino IDE.`);
      return;
    }

    setCopyNotice(
      `No se pudo copiar ${label.toLowerCase()} automaticamente. Seleccionalo y copialo manualmente.`,
    );
  }

  return (
    <div className="min-h-screen px-3 py-4 sm:px-5 lg:px-8 xl:px-10">
      <div className="mx-auto grid w-full max-w-6xl gap-4 sm:gap-5">
        <header className="border-b border-white/10 pb-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
                enlace de dispositivos
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-white sm:text-3xl lg:text-4xl">
                Sincronizacion de dispositivos Empresa ABC
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Registra el ESP32 del cliente, genera el enlace y confirma
                visualmente cuando el hardware real quede conectado.
              </p>
              <p className="mt-2 break-all text-xs text-slate-500">
                API activa: <span className="text-slate-300">{API_BASE_URL}</span>
              </p>
            </div>

            <div className="rounded-lg border border-[#44c7f4]/20 bg-[#44c7f4]/10 px-3 py-2 text-left sm:min-w-[8.75rem] sm:text-center">
              <p className="font-display text-2xl font-semibold text-white">
                {linkedCount}
              </p>
              <p className="text-xs uppercase tracking-[0.16em] text-[#9edfff]">
                dispositivos enlazados
              </p>
            </div>
          </div>
        </header>

        {notice || localNotice || copyNotice ? (
          <p
            ref={noticeRef}
            className="rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 px-4 py-3 text-sm leading-6 text-[#b7ebff]"
          >
            {copyNotice ?? localNotice ?? notice}
          </p>
        ) : null}

        <section className="grid gap-4">
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
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>

              {isEsp32 ? (
                <>
                  <div className="grid gap-2 text-sm text-slate-300">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      nombre del equipo
                    </span>
                    <p className="flex min-h-12 items-center rounded-lg border border-white/10 bg-[#050c16] px-3 text-white">
                      {selectedDeviceName}
                    </p>
                  </div>

                  <div className="grid gap-2 text-sm text-slate-300">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      mundo ESP32
                    </span>
                    <p className="flex min-h-12 items-center rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 px-3 text-white">
                      Controlador multiambiente / 4 LEDs
                    </p>
                  </div>

                  <MultiroomPinMap />
                </>
              ) : (
                <label className="grid gap-2 text-sm text-slate-300">
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-400">
                    nombre o identificador
                  </span>
                  <select
                    value={deviceName}
                    onChange={(event) => setDeviceName(event.target.value)}
                    className="min-h-12 rounded-lg border border-white/10 bg-[#050c16] px-3 text-white outline-none transition focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
                  >
                    {legacyDeviceNameOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {isEsp32 ? (
                <p className="rounded-lg border border-[#44c7f4]/20 bg-[#44c7f4]/10 px-3 py-3 text-sm leading-6 text-[#b7ebff]">
                  Despues de crear el enlace, copia el sketch en Arduino IDE y
                  escribe alli el SSID, la contrasena de tu WiFi y el token. Un
                  solo ESP32 controlara los cuatro LEDs por ambiente.
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit || isCreatingPairing}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#a4e6ff] px-5 py-3 font-display text-xs font-semibold uppercase tracking-[0.12em] text-[#003543] shadow-[0_0_18px_rgba(0,209,255,0.28)] transition hover:bg-[#b7eaff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingPairing
                  ? "Creando token..."
                  : isEsp32
                    ? "Crear enlace ESP32"
                    : "Crear enlace"}
              </button>
            </div>
          </form>
        </section>

        {pairingInfo?.deviceType === "ESP32" ? (
          <section
            ref={pairingGuideRef}
            className="scroll-mt-4 rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 p-4 sm:p-5"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
              guia para primer enlace ESP32
            </p>
            <h3 className="mt-2 font-display text-xl font-semibold text-white">
              Programa {pairingInfo.deviceName} desde Arduino IDE
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Tu token ya esta listo. Sube el sketch por USB antes de que
              venza; el estado cambiara a Online cuando el ESP32 se conecte.
            </p>
            <div className="mt-4 rounded-lg border border-[#f6c563]/30 bg-[#f6c563]/10 p-4 text-sm leading-6 text-[#ffe0a3]">
              Tu WiFi debe ser preferiblemente de 2.4 GHz. Tu contrasena se
              escribe en Arduino IDE dentro del sketch y no se envia a AFCR
              Seguridad. Si el token vence, crea otro enlace y reemplazalo en
              el codigo.
            </div>
            {isLocalLabPairing ? (
              <p className="mt-4 rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 px-4 py-3 text-sm leading-6 text-[#b7ebff]">
                Modo de prueba local: el codigo copiado ya incluye la API{" "}
                <span className="break-all text-white">{pairingInfo.api_url}</span>.
                Mantiene encendido tu backend local mientras pruebas el ESP32.
                Antes de subir el sketch, abre{" "}
                <span className="break-all text-white">
                  {pairingInfo.api_url}/ping
                </span>{" "}
                desde un celular conectado al mismo WiFi; debe responder{" "}
                <span className="text-white">pong: true</span>.
              </p>
            ) : (
              <p className="mt-4 rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 px-4 py-3 text-sm leading-6 text-[#b7ebff]">
                El codigo copiado incluye la API segura{" "}
                <span className="break-all text-white">{pairingInfo.api_url}</span>.
              </p>
            )}

            <ol className="mt-4 grid gap-3 rounded-lg border border-white/10 bg-[#050c16]/55 p-4 text-sm leading-6 text-slate-300">
              <li>
                1. Instala{" "}
                <a
                  className="text-[#b7ebff] underline underline-offset-2"
                  href="https://www.arduino.cc/en/software"
                  rel="noreferrer"
                  target="_blank"
                >
                  Arduino IDE
                </a>{" "}
                en tu laptop.
              </li>
              <li>
                2. En el gestor de placas instala <span className="text-white">esp32 by Espressif Systems</span>{" "}
                y selecciona <span className="text-white">ESP32 Dev Module</span>.
              </li>
              <li>
                3. En el gestor de librerias instala <span className="text-white">ArduinoJson</span>.
              </li>
              <li>
                4. Conecta los LEDs externos segun el mapa de pines y copia el
                codigo C++ de abajo en un sketch nuevo.
              </li>
              <li>
                5. Conecta tu ESP32 por cable USB, selecciona su puerto y pulsa
                <span className="text-white"> Subir</span>.
              </li>
              <li>
                6. Espera que el inventario muestre <span className="text-white">Online</span>{" "}
                y luego prueba cada ambiente desde el dashboard.
              </li>
            </ol>

            <div className="mt-4">
              <MultiroomPinMap />
            </div>

            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <PairingValue label="API URL" value={pairingInfo.api_url} />
              <CopyableValue
                label="Token para pegar en PAIRING_TOKEN"
                value={pairingInfo.pairing_token}
                onCopy={() => copyValue(pairingInfo.pairing_token, "Token")}
              />
              <PairingValue label="Device ID" value={pairingInfo.device_id} />
              <PairingValue label="Nombre" value={pairingInfo.deviceName} />
              <PairingValue label="Tipo" value={pairingInfo.deviceType} />
              <PairingValue label="Modelo" value={pairingInfo.model} />
              <PairingValue
                label="Token valido hasta"
                value={formatDateTime(pairingInfo.pairing_expires_at)}
              />
              <PairingValue
                label="Modo de comandos"
                value={
                  pairingInfo.transport === "http_polling"
                    ? "HTTPS polling"
                    : "MQTT"
                }
              />
              {pairingInfo.commands_url ? (
                <PairingValue
                  label="Ruta de comandos"
                  value={pairingInfo.commands_url}
                />
              ) : (
                <PairingValue label="Topic MQTT" value={pairingInfo.mqtt_topic} />
              )}
            </div>

            <div className="mt-5 rounded-lg border border-white/10 bg-[#050c16]/80 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
                    codigo C++ para Arduino IDE
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Copia el sketch completo y edita estas tres lineas:
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue(sketchForPairing, "Codigo C++")}
                  className="shrink-0 rounded-lg border border-[#44c7f4]/30 bg-[#44c7f4]/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#b7ebff] transition hover:bg-[#44c7f4]/15"
                >
                  Copiar codigo C++
                </button>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-lg border border-[#f6c563]/30 bg-[#f6c563]/10 p-3 text-xs leading-6 text-[#ffe0a3]">
                {`const char* WIFI_SSID = "TU_WIFI";\nconst char* WIFI_PASSWORD = "TU_PASSWORD";\nconst char* PAIRING_TOKEN = "PEGA_AQUI_TU_TOKEN";`}
              </pre>
              <pre className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-white/10 bg-[#030912] p-4 text-xs leading-5 text-slate-300">
                {sketchForPairing}
              </pre>
            </div>

            <div className="mt-5 rounded-lg border border-white/10 bg-[#050c16]/55 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                si algo no funciona
              </p>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-300">
                <li>El ESP32 no aparece: prueba un cable USB de datos u otro puerto.</li>
                <li>No compila: instala el soporte ESP32 y la libreria ArduinoJson.</li>
                <li>No sube: revisa placa y puerto; algunas placas requieren mantener BOOT al cargar.</li>
                <li>No queda Online: revisa WiFi de 2.4 GHz, contrasena y vigencia del token.</li>
                <li>La API local no abre desde tu celular: habilita el puerto 8000 de tu laptop hacia el backend.</li>
                <li>Cambiaste de WiFi: modifica las dos lineas WiFi y vuelve a subir el sketch.</li>
                <li>Quieres otro enlace: genera un token nuevo, pegalo en PAIRING_TOKEN y vuelve a subir.</li>
                <li>Un LED no responde: revisa el GPIO de ese ambiente, resistencia, polaridad y GND comun.</li>
              </ul>
            </div>
          </section>
        ) : pairingInfo ? (
          <section
            ref={pairingGuideRef}
            className="scroll-mt-4 rounded-lg border border-[#44c7f4]/25 bg-[#44c7f4]/10 p-4 sm:p-5"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
              enlace legacy
            </p>
            <h3 className="mt-2 font-display text-xl font-semibold text-white">
              Configura {pairingInfo.deviceName}
            </h3>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <PairingValue label="API URL" value={pairingInfo.api_url} />
              <PairingValue label="Token" value={pairingInfo.pairing_token} />
              <PairingValue label="Device ID" value={pairingInfo.device_id} />
              <PairingValue label="Topic MQTT" value={pairingInfo.mqtt_topic} />
              <PairingValue
                label="Token valido hasta"
                value={formatDateTime(pairingInfo.pairing_expires_at)}
              />
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                dispositivos enlazados
              </p>
              <h3 className="mt-2 font-display text-xl font-semibold text-white">
                Inventario conectado
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                {linkedCount > 0
                  ? "La aplicacion ya tiene dispositivos reclamados por ESP32 reales."
                  : pendingCount > 0
                    ? "Hay enlaces pendientes. Carga el sketch con el token en tu ESP32."
                    : "Crea un enlace y carga el sketch al ESP32 para continuar."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center lg:min-w-[25rem]">
              <div className="rounded-lg border border-[#44c7f4]/20 bg-[#44c7f4]/10 px-4 py-3">
                <p className="font-display text-3xl font-semibold leading-none text-white">
                  {linkedCount}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[#9edfff]">
                  enlazados
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={openDashboard}
                  disabled={linkedCount === 0}
                  className="rounded-lg border border-[#44c7f4]/30 bg-[#44c7f4]/10 px-3 py-3 text-sm font-semibold text-[#b7ebff] transition hover:bg-[#44c7f4]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-500"
                >
                  Ir al dashboard
                </button>
                <button
                  type="button"
                  onClick={() => void refreshDevices()}
                  className="rounded-lg border border-white/10 px-3 py-3 text-xs uppercase tracking-[0.14em] text-slate-300 transition hover:bg-white/[0.06]"
                >
                  Actualizar dispositivos
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {linkedDevices.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/15 px-4 py-6 text-center text-sm leading-6 text-slate-400">
                Aun no hay dispositivos reales enlazados. Crea un enlace ESP32 y carga el sketch para que aparezca aqui.
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
                    {device.transport === "http_polling" ? (
                      <>
                        Comandos: <span className="text-white">HTTPS polling</span>
                      </>
                    ) : (
                      <>
                        Topic: <span className="text-white">{device.mqtt_topic}</span>
                      </>
                    )}
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

function MultiroomPinMap() {
  return (
    <div className="rounded-lg border border-[#44c7f4]/20 bg-[#44c7f4]/10 p-3 text-sm text-slate-300">
      <p className="text-xs uppercase tracking-[0.18em] text-[#9edfff]">
        controlador multiambiente
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {esp32RoomPins.map((room) => (
          <div
            key={room.space}
            className="rounded-lg border border-white/10 bg-[#050c16]/70 px-3 py-2"
          >
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
              {room.label}
            </p>
            <p className="mt-1 font-display text-lg font-semibold text-white">
              {room.gpio}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        Usa LEDs externos con resistencia y GND comun. El dashboard enviara el
        ambiente por voz y el ESP32 activara el pin correspondiente.
      </p>
    </div>
  );
}

function getNextEsp32DeviceName(
  devices: Array<{ is_demo?: boolean; model?: string; name?: string; type?: string }>,
) {
  const esp32Numbers = devices
    .filter((device) =>
      !device.is_demo &&
      (device.type === "ESP32" ||
        device.model === "ESP32" ||
        /^ESP32-\d+$/.test(device.name ?? "")),
    )
    .map((device) => {
      const match = /^ESP32-(\d+)$/.exec(device.name ?? "");
      return match ? Number(match[1]) : 0;
    });
  const nextNumber = Math.max(0, ...esp32Numbers) + 1;

  return `ESP32-${nextNumber}`;
}

function copyTextWithTemporarySelection(value: string) {
  if (typeof document === "undefined") {
    return false;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
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

function CopyableValue({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#44c7f4]/25 bg-[#050c16]/70 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 break-all text-slate-100">{value}</p>
      <button
        type="button"
        onClick={onCopy}
        className="mt-2 rounded border border-[#44c7f4]/30 px-3 py-1 text-xs uppercase tracking-[0.12em] text-[#b7ebff] transition hover:bg-[#44c7f4]/10"
      >
        Copiar token
      </button>
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function withActiveApiUrl(sketch: string, apiUrl: string) {
  return sketch.replace(
    'const char* API_URL = "https://api.afcrseguridad.com";',
    `const char* API_URL = "${apiUrl}";`,
  );
}

function isLocalLabApiUrl(apiUrl: string) {
  try {
    const url = new URL(apiUrl);

    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname.startsWith("192.168.") ||
        url.hostname.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname))
    );
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido";
}
