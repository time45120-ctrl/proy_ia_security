"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const modules = [
  {
    title: "Camaras de seguridad",
    copy: "Vision centralizada para monitoreo, auditoria y reaccion rapida.",
  },
  {
    title: "Puertas y accesos",
    copy: "Control de puntos criticos con estados visibles para operaciones.",
  },
  {
    title: "Luces inteligentes",
    copy: "Automatizacion por zonas, horarios, voz y eventos de seguridad.",
  },
  {
    title: "Drones de vigilancia",
    copy: "Rutas de inspeccion y telemetria para perimetros empresariales.",
  },
];

const processSteps = [
  "Diagnostico de la empresa y zonas criticas",
  "Instalacion de mini PC, dispositivos y red segura",
  "Configuracion del cerebro IA local o en nube",
  "Soporte anual, mejoras y actualizaciones continuas",
];

const initialForm = {
  companyName: "",
  email: "",
  password: "",
  phone: "",
};

export default function WelcomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"register" | "login" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isAuthenticated = Boolean(session);
  const laboratoryButtonLabel = isAuthenticated
    ? "Entrar al laboratorio"
    : "Laboratorio";

  useEffect(() => {
    const supabase = createClient();
    if (new URLSearchParams(window.location.search).get("auth_error") === "confirmation") {
      setNotice("No se pudo confirmar el correo. Solicita un nuevo enlace e intenta otra vez.");
    }

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((error) => {
        setNotice(getErrorMessage(error));
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const formIsReady = useMemo(
    () =>
      (authMode === "login" ||
        (form.companyName.trim().length > 1 &&
          form.phone.trim().length > 5)) &&
      form.email.includes("@") &&
      form.password.length >= 8,
    [authMode, form],
  );

  function updateForm<Key extends keyof typeof form>(
    key: Key,
    value: (typeof form)[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function validateForm(requireCompany: boolean) {
    const nextErrors: Record<string, string> = {};

    if (requireCompany && form.companyName.trim().length < 2) {
      nextErrors.companyName = "Ingresa el nombre de la empresa.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Ingresa un email valido.";
    }

    if (form.password.length < 8) {
      nextErrors.password = "Usa una contrasena de al menos 8 caracteres.";
    }

    if (requireCompany && form.phone.trim().length < 6) {
      nextErrors.phone = "Ingresa un telefono de contacto.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const isRegistration = authMode === "register";

    if (!validateForm(isRegistration)) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const supabase = createClient();
      const email = form.email.trim().toLowerCase();

      if (!isRegistration) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: form.password,
        });

        if (error) {
          setNotice(error.message);
          return;
        }

        setAuthMode(null);
        setNotice("Sesion iniciada. Ya puedes entrar al Laboratorio.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/desarrollo/sync`,
          data: {
            company_name: form.companyName.trim(),
            phone: form.phone.trim(),
            source: "afcr-welcome-supabase",
          },
        },
      });

      if (error) {
        setNotice(error.message);
        return;
      }

      setAuthMode(null);
      setNotice(
        data.session
          ? "Registro completado. Sesion iniciada y Laboratorio habilitado."
          : "Registro recibido. Confirma tu correo para iniciar sesion.",
      );
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogin() {
    setErrors({});
    setNotice(null);
    setAuthMode("login");
  }

  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch (error) {
      setNotice(getErrorMessage(error));
    }

    setSession(null);
    setNotice("Sesion cerrada. Laboratorio vuelve a quedar protegido.");
  }

  function openLaboratory() {
    if (!isAuthenticated) {
      return;
    }

    router.push("/desarrollo/sync");
  }

  return (
    <main className="min-h-screen bg-[#071019] text-white">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#071019]/86 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-10">
        <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="font-display text-lg font-semibold tracking-[0.02em] text-white sm:text-xl"
            aria-label="AFCRseguridad inicio"
          >
            AFCR<span className="text-[#6ee7b7]">seguridad</span>
          </button>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setErrors({});
                setNotice(null);
                setAuthMode("register");
              }}
              className={`min-h-10 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition sm:px-4 ${
                isAuthenticated
                  ? "border border-white/15 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                  : "bg-[#6ee7b7] text-[#052018] shadow-[0_0_24px_rgba(110,231,183,0.24)] hover:bg-[#8af0c9]"
              }`}
            >
              Registrate
            </button>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="min-h-10 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-200 transition hover:bg-white/[0.07] sm:px-4"
              >
                Cerrar sesion
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogin}
                className="min-h-10 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-200 transition hover:bg-white/[0.07] sm:px-4"
              >
                Iniciar Sesion
              </button>
            )}

            <button
              type="button"
              onClick={openLaboratory}
              disabled={!isAuthenticated}
              className={`min-h-10 rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] transition sm:px-4 ${
                isAuthenticated
                  ? "border-[#6ee7b7]/70 bg-[#6ee7b7] text-[#052018] shadow-[0_0_26px_rgba(110,231,183,0.28)] hover:bg-[#8af0c9]"
                  : "cursor-not-allowed border-white/12 bg-transparent text-slate-500 opacity-70"
              }`}
              title={
                isAuthenticated
                  ? "Abrir Laboratorio"
                  : "Registrate para habilitar el Laboratorio"
              }
            >
              {laboratoryButtonLabel}
            </button>
          </div>
        </nav>
      </header>

      <section className="relative isolate overflow-hidden px-4 pb-16 pt-28 sm:px-6 sm:pb-20 lg:px-10 lg:pt-32">
        <Image
          src="/landing/hero-security-ops.png"
          alt="Centro empresarial de seguridad con IA, mini PC y monitoreo de dispositivos"
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(7,16,25,0.98)_0%,rgba(7,16,25,0.82)_42%,rgba(7,16,25,0.38)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-36 bg-gradient-to-t from-[#071019] to-transparent" />

        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.55fr)] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              Seguridad empresarial B2B con IA
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] text-white sm:text-5xl lg:text-6xl">
              Seguridad empresarial dirigida por inteligencia artificial
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-200 sm:text-lg">
              Instalamos en tu empresa una mini PC potente con nuestro codigo y
              un cerebro IA capaz de gestionar camaras, puertas, luces y drones
              desde una arquitectura local, en nube o hibrida.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#6ee7b7] px-6 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#052018] transition hover:bg-[#8af0c9]"
              >
                Registrate
              </button>
              <button
                type="button"
                onClick={openLaboratory}
                disabled={!isAuthenticated}
                className={`inline-flex min-h-12 items-center justify-center rounded-lg border px-6 py-3 text-sm font-bold uppercase tracking-[0.1em] transition ${
                  isAuthenticated
                    ? "border-[#44c7f4]/55 bg-[#44c7f4]/16 text-[#c7f2ff] hover:bg-[#44c7f4]/22"
                    : "cursor-not-allowed border-white/14 bg-white/[0.03] text-slate-500"
                }`}
              >
                {laboratoryButtonLabel}
              </button>
            </div>
            {notice ? (
              <p className="mt-5 max-w-2xl rounded-lg border border-[#6ee7b7]/25 bg-[#6ee7b7]/10 px-4 py-3 text-sm leading-6 text-[#c6ffe8]">
                {notice}
              </p>
            ) : null}
          </div>

          <aside className="grid gap-3 rounded-lg border border-white/12 bg-[#081522]/82 p-4 shadow-glow backdrop-blur-xl sm:grid-cols-3 lg:grid-cols-1">
            <Metric value="24/7" label="operacion asistida por IA" />
            <Metric value="Local + nube" label="modelo flexible de despliegue" />
            <Metric value="AWS ready" label="preparado para datos en backend" />
          </aside>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9edfff]">
              Cerebro IA instalado en tu empresa
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              La mini PC se convierte en el nucleo que coordina todo el sistema.
            </h2>
            <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
              Nuestro equipo instala el hardware, despliega el software, conecta
              los dispositivos y deja el sistema listo para operar con IA. La
              inteligencia puede trabajar con servicios en la nube o con
              procesamiento local segun el nivel de privacidad y continuidad que
              requiera la empresa.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
            <Image
              src="/landing/ai-mini-pc-brain.png"
              alt="Mini PC como cerebro IA conectado a dispositivos de seguridad"
              width={1200}
              height={900}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="aspect-[4/3] h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.025] px-4 py-14 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              Modulos de seguridad integrados
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Un solo sistema para dirigir seguridad fisica, automatizacion y
              vigilancia.
            </h2>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((module) => (
              <article
                key={module.title}
                className="rounded-lg border border-white/10 bg-[#0b1724] p-5"
              >
                <h3 className="font-display text-lg font-semibold text-white">
                  {module.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {module.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] lg:order-2">
            <Image
              src="/landing/enterprise-installation-support.png"
              alt="Tecnicos configurando sistema de seguridad empresarial con soporte anual"
              width={1200}
              height={900}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="aspect-[4/3] h-full w-full object-cover"
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9edfff]">
              Implementacion y soporte anual
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              No vendemos solo dispositivos. Entregamos operacion continua.
            </h2>
            <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
              AFCRseguridad acompana a la empresa despues de la instalacion:
              mantenimiento, actualizaciones, soporte tecnico y mejora del
              sistema para que la seguridad no se degrade con el tiempo.
            </p>
            <div className="mt-6 grid gap-3">
              {processSteps.map((step, index) => (
                <div
                  key={step}
                  className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#44c7f4]/16 font-display text-sm font-semibold text-[#b7ebff]">
                    {index + 1}
                  </span>
                  <p className="self-center text-sm leading-6 text-slate-200">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-lg border border-[#6ee7b7]/25 bg-[#6ee7b7]/10 p-6 sm:p-8 lg:flex lg:items-center lg:justify-between lg:gap-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              MVP funcional conectado a tu laboratorio
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-white">
              Registra tu empresa y prueba el flujo de laboratorio.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              El backend real vive en AWS y el frontend queda preparado para
              operar registro, sesiones y datos protegidos con Supabase.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAuthMode("register")}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#6ee7b7] px-6 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#052018] transition hover:bg-[#8af0c9] sm:w-auto lg:mt-0"
          >
            Registrate
          </button>
        </div>
      </section>

      {authMode ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#02070d]/82 px-4 py-6 backdrop-blur-sm">
          <form
            onSubmit={(event) => void handleAuthSubmit(event)}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-white/12 bg-[#0a1522] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.55)] sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
                  {authMode === "register" ? "Registro empresarial" : "Acceso seguro"}
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-white">
                  {authMode === "register"
                    ? "Habilita el Laboratorio AFCR"
                    : "Inicia sesion en AFCR"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAuthMode(null)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06]"
              >
                Cerrar
              </button>
            </div>

            {notice ? (
              <p className="mt-5 rounded-lg border border-[#6ee7b7]/25 bg-[#6ee7b7]/10 px-4 py-3 text-sm leading-6 text-[#c6ffe8]">
                {notice}
              </p>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {authMode === "register" ? (
                <>
                  <TextField
                    label="Empresa"
                    value={form.companyName}
                    error={errors.companyName}
                    onChange={(value) => updateForm("companyName", value)}
                  />
                </>
              ) : null}
              <TextField
                label="Email"
                type="email"
                value={form.email}
                error={errors.email}
                onChange={(value) => updateForm("email", value)}
              />
              <TextField
                label="Contrasena"
                type="password"
                value={form.password}
                error={errors.password}
                onChange={(value) => updateForm("password", value)}
              />
              {authMode === "register" ? (
                <>
                  <TextField
                    label="Telefono"
                    value={form.phone}
                    error={errors.phone}
                    onChange={(value) => updateForm("phone", value)}
                  />
                </>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={!formIsReady || isSubmitting}
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#6ee7b7] px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#052018] transition hover:bg-[#8af0c9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting
                ? "Procesando..."
                : authMode === "register"
                  ? "Registrate y entrar en sesion"
                  : "Iniciar sesion"}
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <p className="font-display text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof Event !== "undefined" && error instanceof Event) {
    return "No se pudo completar la operacion del navegador. Intentalo nuevamente.";
  }

  if (typeof error === "string") {
    return error;
  }

  return "Error desconocido";
}

function TextField({
  label,
  value,
  error,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 rounded-lg border border-white/10 bg-[#06101b] px-3 text-white outline-none transition placeholder:text-slate-600 focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
      />
      {error ? <span className="text-xs text-[#ffc1cb]">{error}</span> : null}
    </label>
  );
}
