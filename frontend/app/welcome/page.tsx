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
    title: "Sensores y alarmas",
    copy: "Alertas para movimiento, humo, puertas y eventos importantes del hogar.",
  },
];

const processSteps = [
  "Diagnostico del hogar y sus ambientes",
  "Instalacion de mini PC, dispositivos y red segura",
  "Configuracion del cerebro IA local o en nube",
  "Soporte anual, mejoras y actualizaciones continuas",
];

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const USERNAME_ERROR =
  "Usa 3 a 30 caracteres: letras minusculas, numeros o guion bajo.";
const OTP_LENGTH = 8;
const OTP_RESEND_SECONDS = 60;

type AuthMode =
  | "register"
  | "signupOtp"
  | "login"
  | "forgotPassword"
  | "recoveryOtp"
  | "newPassword";

const initialForm = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  phone: "",
};

export default function WelcomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingEmail, setPendingEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);

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

  useEffect(() => {
    if (resendSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const formIsReady = useMemo(
    () => {
      if (authMode === "register") {
        return (
          USERNAME_PATTERN.test(form.username.trim()) &&
          form.phone.trim().length > 5 &&
          isValidEmail(form.email) &&
          form.password.length >= 8 &&
          form.confirmPassword.length >= 8 &&
          form.password === form.confirmPassword
        );
      }

      if (authMode === "login") {
        return isValidEmail(form.email) && form.password.length >= 8;
      }

      if (authMode === "forgotPassword") {
        return isValidEmail(form.email);
      }

      if (authMode === "signupOtp" || authMode === "recoveryOtp") {
        return otp.length === OTP_LENGTH;
      }

      if (authMode === "newPassword") {
        return (
          newPassword.length >= 8 &&
          confirmNewPassword.length >= 8 &&
          newPassword === confirmNewPassword
        );
      }

      return false;
    },
    [authMode, confirmNewPassword, form, newPassword, otp],
  );

  function updateForm<Key extends keyof typeof form>(
    key: Key,
    value: (typeof form)[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function validateCredentials(isRegistration: boolean) {
    const nextErrors: Record<string, string> = {};

    if (
      isRegistration &&
      !USERNAME_PATTERN.test(form.username.trim().toLowerCase())
    ) {
      nextErrors.username = USERNAME_ERROR;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Ingresa un email valido.";
    }

    if (form.password.length < 8) {
      nextErrors.password = "Usa una contrasena de al menos 8 caracteres.";
    }

    if (isRegistration && form.confirmPassword.length < 8) {
      nextErrors.confirmPassword = "Confirma tu contrasena.";
    } else if (isRegistration && form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Las contrasenas no coinciden.";
    }
    if (isRegistration && form.phone.trim().length < 6) {
      nextErrors.phone = "Ingresa un telefono de contacto.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function openAuth(mode: "register" | "login") {
    setErrors({});
    setNotice(null);
    setOtp("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResendSeconds(0);
    setAuthMode(mode);
  }

  function closeAuthModal() {
    setAuthMode(null);
    setErrors({});
    setOtp("");
    setNewPassword("");
    setConfirmNewPassword("");
    setResendSeconds(0);
    setForm((current) => ({
      ...current,
      password: "",
      confirmPassword: "",
    }));
  }

  async function handleCloseAuthModal() {
    if (authMode === "newPassword") {
      try {
        await createClient().auth.signOut();
      } finally {
        setSession(null);
      }
    }

    closeAuthModal();
    setNotice(null);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setNotice(null);

    try {
      const supabase = createClient();
      const email = form.email.trim().toLowerCase();
      const username = form.username.trim().toLowerCase();

      if (authMode === "login") {
        if (!validateCredentials(false)) {
          return;
        }

        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: form.password,
        });

        if (error) {
          setNotice(getAuthErrorMessage(error.message));
          return;
        }

        closeAuthModal();
        setNotice("Sesion iniciada. Ya puedes entrar al Laboratorio.");
        return;
      }

      if (authMode === "register") {
        if (!validateCredentials(true)) {
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password: form.password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=/welcome`,
            data: {
              username,
              phone: form.phone.trim(),
              source: "afcr-welcome-supabase",
            },
          },
        });

        if (error) {
          if (isUsernameConflictMessage(error.message)) {
            setErrors((current) => ({
              ...current,
              username: "Ese nombre de usuario ya esta en uso.",
            }));
          }

          setNotice(getSignupErrorMessage(error.message));
          return;
        }

        setForm((current) => ({
          ...current,
          password: "",
          confirmPassword: "",
        }));

        if (data.session) {
          setSession(data.session);
          closeAuthModal();
          setNotice("Registro completado. El Laboratorio ya esta habilitado.");
          return;
        }

        setPendingEmail(email);
        setOtp("");
        setResendSeconds(OTP_RESEND_SECONDS);
        setAuthMode("signupOtp");
        setNotice(
          `Enviamos un codigo de ${OTP_LENGTH} digitos a ${email}. Vigencia: 60 minutos.`,
        );
        return;
      }

      if (authMode === "signupOtp") {
        if (otp.length !== OTP_LENGTH) {
          setErrors({ otp: `Ingresa los ${OTP_LENGTH} digitos del codigo.` });
          return;
        }

        const { data, error } = await supabase.auth.verifyOtp({
          email: pendingEmail,
          token: otp,
          type: "email",
        });

        if (error) {
          setNotice(getAuthErrorMessage(error.message));
          return;
        }

        setSession(data.session);
        setForm(initialForm);
        closeAuthModal();
        setNotice(
          "Correo verificado. Tu sesion esta activa y el boton Laboratorio ya esta habilitado.",
        );
        return;
      }

      if (authMode === "forgotPassword") {
        if (!isValidEmail(email)) {
          setErrors({ email: "Ingresa un email valido." });
          return;
        }

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/confirm?next=/welcome`,
        });

        if (error) {
          setNotice(getAuthErrorMessage(error.message));
          return;
        }

        setPendingEmail(email);
        setOtp("");
        setResendSeconds(OTP_RESEND_SECONDS);
        setAuthMode("recoveryOtp");
        setNotice(
          `Si existe una cuenta para ${email}, recibiras un codigo de recuperacion de ${OTP_LENGTH} digitos.`,
        );
        return;
      }

      if (authMode === "recoveryOtp") {
        if (otp.length !== OTP_LENGTH) {
          setErrors({ otp: `Ingresa los ${OTP_LENGTH} digitos del codigo.` });
          return;
        }

        const { data, error } = await supabase.auth.verifyOtp({
          email: pendingEmail,
          token: otp,
          type: "recovery",
        });

        if (error) {
          setNotice(getAuthErrorMessage(error.message));
          return;
        }

        setSession(data.session);
        setOtp("");
        setAuthMode("newPassword");
        setNotice("Codigo validado. Ahora crea una contrasena nueva.");
        return;
      }

      if (authMode === "newPassword") {
        const nextErrors: Record<string, string> = {};
        if (newPassword.length < 8) {
          nextErrors.newPassword = "Usa una contrasena de al menos 8 caracteres.";
        }
        if (confirmNewPassword !== newPassword) {
          nextErrors.confirmNewPassword = "Las contrasenas no coinciden.";
        }
        if (Object.keys(nextErrors).length > 0) {
          setErrors(nextErrors);
          return;
        }

        const { error } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (error) {
          setNotice(getAuthErrorMessage(error.message));
          return;
        }

        const { data } = await supabase.auth.getSession();
        setSession(data.session);
        setForm(initialForm);
        closeAuthModal();
        setNotice(
          "Contrasena actualizada. Tu sesion sigue activa y el Laboratorio esta habilitado.",
        );
      }
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleLogin() {
    openAuth("login");
  }

  async function handleResendOtp() {
    if (
      resendSeconds > 0 ||
      (authMode !== "signupOtp" && authMode !== "recoveryOtp")
    ) {
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const supabase = createClient();
      const { error } =
        authMode === "signupOtp"
          ? await supabase.auth.resend({
              type: "signup",
              email: pendingEmail,
              options: {
                emailRedirectTo: `${window.location.origin}/auth/confirm?next=/welcome`,
              },
            })
          : await supabase.auth.resetPasswordForEmail(pendingEmail, {
              redirectTo: `${window.location.origin}/auth/confirm?next=/welcome`,
            });

      if (error) {
        setNotice(getAuthErrorMessage(error.message));
        return;
      }

      setOtp("");
      setErrors({});
      setResendSeconds(OTP_RESEND_SECONDS);
      setNotice(`Enviamos un codigo nuevo a ${pendingEmail}.`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendUnconfirmedEmail() {
    const email = form.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setErrors({ email: "Ingresa tu email para reenviar la confirmacion." });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/welcome`,
        },
      });

      if (error) {
        setNotice(getAuthErrorMessage(error.message));
        return;
      }

      setPendingEmail(email);
      setOtp("");
      setResendSeconds(OTP_RESEND_SECONDS);
      setAuthMode("signupOtp");
      setNotice(`Enviamos un codigo nuevo a ${email}.`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
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
              onClick={() => openAuth("register")}
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
          src="/landing/hero-smart-home.png"
          alt="Hogar inteligente con seguridad, iluminacion y dispositivos conectados"
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
              Domotica residencial con IA
            </p>
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] text-white sm:text-5xl lg:text-6xl">
              Tu hogar inteligente, seguro y conectado
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-200 sm:text-lg">
              Instalamos en tu hogar una mini PC potente con nuestro codigo y
              un cerebro IA capaz de gestionar camaras, accesos, luces y sensores
              desde una arquitectura local, en nube o hibrida.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => openAuth("register")}
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
              Cerebro IA instalado en tu hogar
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              La mini PC se convierte en el nucleo que coordina todo el sistema.
            </h2>
            <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
              Nuestro equipo instala el hardware, despliega el software, conecta
              los dispositivos y deja el sistema listo para operar con IA. La
              inteligencia puede trabajar con servicios en la nube o con
              procesamiento local segun el nivel de privacidad y continuidad que
              requiera tu hogar.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
            <Image
              src="/landing/home-ai-hub.png"
              alt="Mini PC como cerebro privado de automatizacion del hogar"
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
              src="/landing/home-installation-support.png"
              alt="Tecnico configurando sensores y accesos inteligentes en una vivienda"
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
              AFCRseguridad acompana tu hogar despues de la instalacion:
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
              Crea tu cuenta y prueba la domotica del hogar.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              El backend real vive en AWS y el frontend queda preparado para
              operar registro, sesiones y datos protegidos con Supabase.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openAuth("register")}
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
                  {getAuthEyebrow(authMode)}
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-white">
                  {getAuthTitle(authMode)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleCloseAuthModal()}
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

            {authMode === "signupOtp" || authMode === "recoveryOtp" ? (
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Escribe el codigo enviado a{" "}
                <span className="font-semibold text-white">{pendingEmail}</span>.
                El codigo tiene {OTP_LENGTH} digitos y vence en 60 minutos.
              </p>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {authMode === "register" ? (
                <>
                  <TextField
                    label="Nombre de usuario"
                    value={form.username}
                    error={errors.username}
                    onChange={(value) =>
                      updateForm("username", value.toLowerCase())
                    }
                  />
                  <TextField
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    error={errors.email}
                    onChange={(value) => updateForm("email", value)}
                  />
                  <TextField
                    label="Contrasena"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    error={errors.password}
                    onChange={(value) => updateForm("password", value)}
                  />
                  <TextField
                    label="Confirmar contrasena"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    error={
                      form.confirmPassword.length > 0 &&
                      form.password !== form.confirmPassword
                        ? "Las contrasenas no coinciden."
                        : errors.confirmPassword
                    }
                    onChange={(value) => updateForm("confirmPassword", value)}
                  />
                  <TextField
                    label="Telefono"
                    value={form.phone}
                    error={errors.phone}
                    onChange={(value) => updateForm("phone", value)}
                  />
                </>
              ) : null}

              {authMode === "login" ? (
                <>
                  <TextField
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    error={errors.email}
                    onChange={(value) => updateForm("email", value)}
                  />
                  <TextField
                    label="Contrasena"
                    type="password"
                    autoComplete="current-password"
                    value={form.password}
                    error={errors.password}
                    onChange={(value) => updateForm("password", value)}
                  />
                </>
              ) : null}

              {authMode === "forgotPassword" ? (
                <div className="sm:col-span-2">
                  <TextField
                    label="Email de la cuenta"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    error={errors.email}
                    onChange={(value) => updateForm("email", value)}
                  />
                </div>
              ) : null}

              {authMode === "signupOtp" || authMode === "recoveryOtp" ? (
                <div className="sm:col-span-2">
                  <TextField
                    label="Codigo OTP"
                    value={otp}
                    error={errors.otp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={OTP_LENGTH}
                    onChange={(value) => {
                      setOtp(value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                      setErrors((current) => ({ ...current, otp: "" }));
                    }}
                  />
                </div>
              ) : null}

              {authMode === "newPassword" ? (
                <>
                  <TextField
                    label="Nueva contrasena"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    error={errors.newPassword}
                    onChange={(value) => {
                      setNewPassword(value);
                      setErrors((current) => ({ ...current, newPassword: "" }));
                    }}
                  />
                  <TextField
                    label="Confirmar nueva contrasena"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    error={
                      confirmNewPassword.length > 0 &&
                      confirmNewPassword !== newPassword
                        ? "Las contrasenas no coinciden."
                        : errors.confirmNewPassword
                    }
                    onChange={(value) => {
                      setConfirmNewPassword(value);
                      setErrors((current) => ({
                        ...current,
                        confirmNewPassword: "",
                      }));
                    }}
                  />
                </>
              ) : null}
            </div>

            {authMode === "login" ? (
              <div className="mt-4 flex flex-col items-start justify-between gap-3 text-sm sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setErrors({});
                    setNotice(null);
                    setForm((current) => ({
                      ...current,
                      password: "",
                      confirmPassword: "",
                    }));
                    setAuthMode("forgotPassword");
                  }}
                  className="font-semibold text-[#9edfff] transition hover:text-white"
                >
                  ¿Olvidaste tu contrasena?
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleResendUnconfirmedEmail()}
                  className="font-semibold text-[#6ee7b7] transition hover:text-white disabled:opacity-50"
                >
                  Reenviar codigo de confirmacion
                </button>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!formIsReady || isSubmitting}
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#6ee7b7] px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#052018] transition hover:bg-[#8af0c9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Procesando..." : getAuthSubmitLabel(authMode)}
            </button>

            {authMode === "signupOtp" || authMode === "recoveryOtp" ? (
              <div className="mt-4 flex flex-col items-center gap-3 text-sm sm:flex-row sm:justify-between">
                <button
                  type="button"
                  disabled={isSubmitting || resendSeconds > 0}
                  onClick={() => void handleResendOtp()}
                  className="font-semibold text-[#6ee7b7] transition hover:text-white disabled:cursor-not-allowed disabled:text-slate-500"
                >
                  {resendSeconds > 0
                    ? `Reenviar codigo en ${resendSeconds}s`
                    : "Reenviar codigo"}
                </button>
                <button
                  type="button"
                  onClick={handleLogin}
                  className="font-semibold text-[#9edfff] transition hover:text-white"
                >
                  Volver a iniciar sesion
                </button>
              </div>
            ) : null}

            {authMode === "forgotPassword" ? (
              <button
                type="button"
                onClick={handleLogin}
                className="mt-4 w-full text-sm font-semibold text-[#9edfff] transition hover:text-white"
              >
                Volver a iniciar sesion
              </button>
            ) : null}
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

function isUsernameConflictMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("profiles_username_unique") ||
    normalized.includes("profiles_username_key") ||
    normalized.includes("duplicate key") ||
    normalized.includes("username")
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function getAuthEyebrow(mode: AuthMode) {
  if (mode === "register" || mode === "signupOtp") {
    return "Registro del hogar";
  }
  if (mode === "forgotPassword" || mode === "recoveryOtp" || mode === "newPassword") {
    return "Recuperacion segura";
  }
  return "Acceso seguro";
}

function getAuthTitle(mode: AuthMode) {
  const titles: Record<AuthMode, string> = {
    register: "Habilita el Laboratorio AFCR",
    signupOtp: "Verifica tu correo",
    login: "Inicia sesion en AFCR",
    forgotPassword: "Recupera tu contrasena",
    recoveryOtp: "Valida el codigo de recuperacion",
    newPassword: "Crea una contrasena nueva",
  };
  return titles[mode];
}

function getAuthSubmitLabel(mode: AuthMode) {
  const labels: Record<AuthMode, string> = {
    register: "Registrarme",
    signupOtp: "Verificar correo",
    login: "Iniciar sesion",
    forgotPassword: "Enviar codigo OTP",
    recoveryOtp: "Validar codigo",
    newPassword: "Guardar nueva contrasena",
  };
  return labels[mode];
}

function getSignupErrorMessage(message: string) {
  if (isUsernameConflictMessage(message)) {
    return "Ese nombre de usuario ya esta en uso. Prueba con otro.";
  }

  return getAuthErrorMessage(message);
}

function getAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("expired") ||
    normalized.includes("invalid token") ||
    normalized.includes("otp_expired")
  ) {
    return "El codigo es invalido o vencio. Solicita uno nuevo.";
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("email rate") ||
    normalized.includes("over_email_send_rate_limit")
  ) {
    return "Se alcanzo el limite temporal de correos. Espera un momento e intenta de nuevo.";
  }
  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid_credentials")
  ) {
    return "Correo o contrasena incorrectos.";
  }
  if (
    normalized.includes("email not confirmed") ||
    normalized.includes("email_not_confirmed")
  ) {
    return "Tu correo todavia no esta confirmado. Usa la opcion para reenviar el codigo.";
  }
  if (
    normalized.includes("fetch") ||
    normalized.includes("network") ||
    normalized.includes("failed to")
  ) {
    return "No se pudo conectar con el servicio de autenticacion. Intenta nuevamente.";
  }

  return message;
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
  inputMode,
  maxLength,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "email" | "tel";
  maxLength?: number;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 rounded-lg border border-white/10 bg-[#06101b] px-3 text-white outline-none transition placeholder:text-slate-600 focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
      />
      {error ? <span className="text-xs text-[#ffc1cb]">{error}</span> : null}
    </label>
  );
}
