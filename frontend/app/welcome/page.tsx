"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const benefits = [
  {
    icon: "voice",
    title: "Control que entiende tu hogar",
    copy: "Gestiona rutinas y dispositivos con voz natural, sin aprender comandos complejos.",
  },
  {
    icon: "shield",
    title: "Seguridad en contexto",
    copy: "Revisa accesos, sensores y alertas desde una experiencia clara y unificada.",
  },
  {
    icon: "spark",
    title: "Automatizacion que acompana",
    copy: "Crea ambientes y acciones que se adaptan a tus espacios y a tu ritmo diario.",
  },
];

const modules = [
  {
    icon: "camera",
    title: "Cámaras",
    copy: "Observa zonas importantes y centraliza eventos relevantes.",
    className: "sm:col-span-2 lg:col-span-4 lg:row-span-2",
  },
  {
    icon: "door",
    title: "Accesos",
    copy: "Conoce el estado de puertas y puntos de entrada.",
    className: "lg:col-span-2",
  },
  {
    icon: "light",
    title: "Luces",
    copy: "Controla iluminacion por voz, ambientes y horarios.",
    className: "lg:col-span-2",
  },
  {
    icon: "sensor",
    title: "Sensores y alarmas",
    copy: "Detecta movimiento, humo y cambios importantes dentro de casa.",
    className: "sm:col-span-2 lg:col-span-4",
  },
];

const processSteps = [
  {
    title: "Conecta tu hogar",
    copy: "Identificamos ambientes, red y dispositivos para definir una instalacion ordenada.",
  },
  {
    title: "Configura la inteligencia",
    copy: "Preparamos el núcleo local, la nube o el modo híbrido según tus prioridades.",
  },
  {
    title: "Habla, confirma y controla",
    copy: "La IA interpreta tu solicitud y pide confirmación antes de ejecutar acciones físicas.",
  },
];

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const USERNAME_ERROR =
  "Usa 3 a 30 caracteres: letras minúsculas, números o guion bajo.";
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
  const authDialogRef = useRef<HTMLFormElement>(null);

  const isAuthenticated = Boolean(session);

  useEffect(() => {
    const supabase = createClient();
    if (new URLSearchParams(window.location.search).get("auth_error") === "confirmation") {
      setNotice("No se pudo confirmar el correo. Solicita un código nuevo e intenta otra vez.");
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

  useEffect(() => {
    if (!authMode) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => {
      authDialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        void handleCloseAuthModal();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [authMode, isSubmitting]);

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
      nextErrors.email = "Ingresa un email válido.";
    }

    if (form.password.length < 8) {
      nextErrors.password = "Usa una contraseña de al menos 8 caracteres.";
    }

    if (isRegistration && form.confirmPassword.length < 8) {
      nextErrors.confirmPassword = "Confirma tu contraseña.";
    } else if (isRegistration && form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Las contraseñas no coinciden.";
    }
    if (isRegistration && form.phone.trim().length < 6) {
      nextErrors.phone = "Ingresa un teléfono de contacto.";
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
        setNotice("Sesión iniciada. Ya puedes entrar al Laboratorio.");
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
              username: "Ese nombre de usuario ya está en uso.",
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
          setNotice("Registro completado. El Laboratorio ya está habilitado.");
          return;
        }

        setPendingEmail(email);
        setOtp("");
        setResendSeconds(OTP_RESEND_SECONDS);
        setAuthMode("signupOtp");
        setNotice(
          `Enviamos un código de ${OTP_LENGTH} dígitos a ${email}. Vigencia: 60 minutos.`,
        );
        return;
      }

      if (authMode === "signupOtp") {
        if (otp.length !== OTP_LENGTH) {
          setErrors({ otp: `Ingresa los ${OTP_LENGTH} dígitos del código.` });
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
          "Correo verificado. Tu sesión está activa y el botón Laboratorio ya está habilitado.",
        );
        return;
      }

      if (authMode === "forgotPassword") {
        if (!isValidEmail(email)) {
          setErrors({ email: "Ingresa un email válido." });
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
          `Si existe una cuenta para ${email}, recibirás un código de recuperación de ${OTP_LENGTH} dígitos.`,
        );
        return;
      }

      if (authMode === "recoveryOtp") {
        if (otp.length !== OTP_LENGTH) {
          setErrors({ otp: `Ingresa los ${OTP_LENGTH} dígitos del código.` });
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
        setNotice("Código validado. Ahora crea una contraseña nueva.");
        return;
      }

      if (authMode === "newPassword") {
        const nextErrors: Record<string, string> = {};
        if (newPassword.length < 8) {
          nextErrors.newPassword = "Usa una contraseña de al menos 8 caracteres.";
        }
        if (confirmNewPassword !== newPassword) {
          nextErrors.confirmNewPassword = "Las contraseñas no coinciden.";
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
          "Contraseña actualizada. Tu sesión sigue activa y el Laboratorio está habilitado.",
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
      setNotice(`Enviamos un código nuevo a ${pendingEmail}.`);
    } catch (error) {
      setNotice(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendUnconfirmedEmail() {
    const email = form.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setErrors({ email: "Ingresa tu email para reenviar la confirmación." });
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
      setNotice(`Enviamos un código nuevo a ${email}.`);
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
    setNotice("Sesión cerrada. El Laboratorio vuelve a quedar protegido.");
  }

  function openLaboratory() {
    if (!isAuthenticated) {
      return;
    }

    router.push("/desarrollo/sync");
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#071421] text-white">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#06121d]/78 px-4 py-3 backdrop-blur-2xl sm:px-6 lg:px-10">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="shrink-0 font-display text-base font-semibold tracking-[0.02em] text-white transition hover:text-[#d7fff0] sm:text-xl"
            aria-label="AFCRseguridad inicio"
          >
            AFCR<span className="text-[#6ee7b7]">seguridad</span>
          </button>

          <div className="hidden items-center gap-7 text-sm text-slate-300 lg:flex">
            <a className="transition hover:text-white" href="#beneficios">
              Beneficios
            </a>
            <a className="transition hover:text-white" href="#como-funciona">
              Cómo funciona
            </a>
            <a className="transition hover:text-white" href="#privacidad">
              Privacidad
            </a>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-2">
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="hidden min-h-10 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/[0.07] hover:text-white sm:inline-flex sm:items-center"
                >
                  Cerrar sesión
                </button>
                <button
                  type="button"
                  onClick={openLaboratory}
                  className="inline-flex min-h-10 items-center rounded-xl bg-[#6ee7b7] px-3 py-2 text-xs font-bold text-[#052018] shadow-[0_8px_30px_rgba(110,231,183,0.22)] transition hover:-translate-y-0.5 hover:bg-[#90f3ce] sm:px-4"
                >
                  Abrir Laboratorio
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleLogin}
                  className="min-h-10 rounded-xl px-1.5 py-2 text-[10px] font-semibold text-slate-200 transition hover:bg-white/[0.07] sm:px-3 sm:text-xs"
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  onClick={() => openAuth("register")}
                  className="inline-flex min-h-10 items-center rounded-xl bg-[#6ee7b7] px-2 py-2 text-[10px] font-bold text-[#052018] shadow-[0_8px_30px_rgba(110,231,183,0.22)] transition hover:-translate-y-0.5 hover:bg-[#90f3ce] sm:px-4 sm:text-xs"
                >
                  Crear cuenta
                </button>
              </>
            )}
          </div>
        </nav>
      </header>

      <section className="relative isolate flex min-h-[720px] items-end overflow-hidden px-4 pb-20 pt-28 sm:min-h-[760px] sm:px-6 sm:pb-24 lg:min-h-[800px] lg:px-10 lg:pb-28">
        <Image
          src="/landing/hero-smart-home.png"
          alt="Casa moderna y luminosa con cámara, acceso e iluminación inteligente"
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover object-[68%_center] sm:object-[66%_center] lg:object-center"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(4,15,25,0.86)_0%,rgba(5,20,32,0.62)_37%,rgba(6,26,40,0.18)_68%,rgba(6,26,40,0.05)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[#071421] via-[#071421]/65 to-transparent" />
        <div className="absolute left-[-10rem] top-20 -z-10 h-96 w-96 rounded-full bg-[#44c7f4]/12 blur-3xl" />

        <div className="mx-auto w-full max-w-7xl">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#6ee7b7]/35 bg-[#06251f]/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#a9f6d7] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-[#6ee7b7] shadow-[0_0_12px_rgba(110,231,183,0.9)]" />
              Domótica residencial con IA
            </p>
            <h1 className="mt-6 max-w-xl font-display text-4xl font-bold leading-[1.03] tracking-[-0.035em] text-white drop-shadow-lg sm:text-6xl lg:text-7xl">
              Tu hogar responde. Tú decides.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-100 drop-shadow sm:text-lg sm:leading-8">
              Controla luces, accesos, cámaras y sensores con una experiencia
              segura, natural y diseñada para la vida en casa.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={isAuthenticated ? openLaboratory : () => openAuth("register")}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#6ee7b7] px-6 py-3 text-sm font-bold text-[#052018] shadow-[0_14px_40px_rgba(110,231,183,0.28)] transition hover:-translate-y-0.5 hover:bg-[#90f3ce]"
              >
                {isAuthenticated ? "Abrir Laboratorio" : "Crear cuenta y probar"}
              </button>
              <a
                href="#como-funciona"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 bg-[#071421]/30 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition hover:border-white/50 hover:bg-white/10"
              >
                Ver cómo funciona
              </a>
            </div>
            {notice ? (
              <p className="mt-5 max-w-xl rounded-xl border border-[#6ee7b7]/30 bg-[#06251f]/70 px-4 py-3 text-sm leading-6 text-[#d8fff0] backdrop-blur-md" aria-live="polite">
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-label="Confianza y seguridad" className="relative z-10 -mt-8 px-4 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:grid-cols-3">
          <TrustItem icon="voice" title="Control por voz" copy="Solicita, revisa y confirma." />
          <TrustItem icon="cloud" title="Local, nube o híbrido" copy="Elige cómo procesar tu hogar." />
          <TrustItem icon="lock" title="OTP + RLS" copy="Acceso verificado y datos aislados." />
        </div>
      </section>

      <section id="beneficios" className="scroll-mt-24 px-4 py-24 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              Diseñada para sentirse simple
            </p>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-5xl">
              Tecnología útil, sin convertir tu casa en un panel técnico.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Una experiencia residencial clara para controlar, proteger y
              automatizar lo importante.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {benefits.map((benefit) => (
              <article
                key={benefit.title}
                className="group rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.025))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.16)] transition hover:-translate-y-1 hover:border-[#6ee7b7]/30"
              >
                <LandingIcon name={benefit.icon} />
                <h3 className="mt-6 font-display text-xl font-semibold text-white">
                  {benefit.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  {benefit.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#091a29] px-4 py-24 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9edfff]">
              Todo tu hogar, una sola experiencia
            </p>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-5xl">
              Cada módulo aporta contexto. Juntos cuidan mejor.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-300">
              Empieza con lo que necesitas y amplía el sistema a medida que tu
              hogar evoluciona.
            </p>
          </div>

          <div className="grid auto-rows-[minmax(150px,auto)] gap-4 sm:grid-cols-2 lg:grid-cols-8">
            {modules.map((module) => (
              <article
                key={module.title}
                className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d2233] p-6 ${
                  module.className
                }`}
              >
                <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[#44c7f4]/10 blur-3xl" />
                <LandingIcon name={module.icon} compact />
                <h3 className="mt-5 font-display text-xl font-semibold text-white">
                  {module.title}
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
                  {module.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-24 px-4 py-24 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] shadow-[0_30px_80px_rgba(0,0,0,0.25)] lg:order-2">
            <Image
              src="/landing/home-installation-support.png"
              alt="Técnico configurando sensores y accesos inteligentes en una vivienda"
              width={1200}
              height={900}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="aspect-[4/3] h-full w-full object-cover"
            />
            <div className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/15 bg-[#071421]/78 p-4 backdrop-blur-xl">
              <p className="text-sm font-semibold text-white">Instalación acompañada</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">
                Configuración, pruebas y soporte para que todo quede claro.
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9edfff]">
              Cómo funciona
            </p>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-5xl">
              De tu idea a una rutina inteligente en tres pasos.
            </h2>
            <div className="mt-8 grid gap-4">
              {processSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#44c7f4]/14 font-display text-sm font-semibold text-[#b7ebff]">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      {step.copy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="privacidad" className="scroll-mt-24 px-4 pb-24 sm:px-6 lg:px-10">
        <div className="mx-auto grid max-w-7xl overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#0d2435,#0a1b2a)] lg:grid-cols-2">
          <div className="relative min-h-[320px]">
            <Image
              src="/landing/home-ai-hub.png"
              alt="Mini PC como núcleo privado de automatización del hogar"
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a1b2a]/75 via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-[#0a1b2a]/45" />
          </div>
          <div className="p-7 sm:p-10 lg:p-12">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              Privacidad a tu medida
            </p>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-4xl">
              Decide dónde vive la inteligencia de tu hogar.
            </h2>
            <p className="mt-5 text-sm leading-7 text-slate-300 sm:text-base">
              Procesamiento local para mayor control, nube para más capacidad o
              un equilibrio híbrido. La arquitectura se adapta sin exponer
              identificadores internos en el navegador.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Local", "Nube", "Híbrido"].map((mode) => (
                <span key={mode} className="rounded-full border border-[#9edfff]/25 bg-[#44c7f4]/10 px-4 py-2 text-xs font-semibold text-[#c9f2ff]">
                  {mode}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-10 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl border border-[#6ee7b7]/25 bg-[radial-gradient(circle_at_top_right,rgba(68,199,244,0.16),transparent_38%),linear-gradient(135deg,rgba(110,231,183,0.14),rgba(255,255,255,0.035))] p-7 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              Tu hogar puede empezar hoy
            </p>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-4xl">
              Prueba una forma más natural de controlar tu casa.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Crea tu cuenta, verifica tu correo con OTP y entra al Laboratorio.
            </p>
          </div>
          <button
            type="button"
            onClick={isAuthenticated ? openLaboratory : () => openAuth("register")}
            className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#6ee7b7] px-6 py-3 text-sm font-bold text-[#052018] shadow-[0_14px_40px_rgba(110,231,183,0.22)] transition hover:-translate-y-0.5 hover:bg-[#90f3ce] sm:w-auto lg:mt-0"
          >
            {isAuthenticated ? "Abrir Laboratorio" : "Crear cuenta y probar"}
          </button>
        </div>
      </section>

      <footer className="px-4 py-8 text-sm text-slate-500 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-display text-slate-300">
            AFCR<span className="text-[#6ee7b7]">seguridad</span>
          </p>
          <p>Domótica residencial con control, contexto y privacidad.</p>
        </div>
      </footer>

      {authMode ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#02070d]/84 px-3 py-4 backdrop-blur-md sm:px-6">
          <form
            ref={authDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-dialog-title"
            onSubmit={(event) => void handleAuthSubmit(event)}
            className="grid max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-white/12 bg-[#0a1724] shadow-[0_35px_140px_rgba(0,0,0,0.65)] lg:grid-cols-[0.78fr_1.22fr]"
          >
            <aside className="relative hidden overflow-hidden border-r border-white/10 bg-[linear-gradient(150deg,#103149,#0a1c2b_60%,#0a2520)] p-10 lg:flex lg:flex-col lg:justify-between">
              <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-[#44c7f4]/20 blur-3xl" />
              <div className="absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-[#6ee7b7]/15 blur-3xl" />
              <div className="relative">
                <p className="font-display text-xl font-semibold text-white">
                  AFCR<span className="text-[#6ee7b7]">seguridad</span>
                </p>
                <div className="mt-14 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-[#a9f6d7]">
                  <LandingIcon name={getAuthContextIcon(authMode)} compact />
                </div>
                <h3 className="mt-7 font-display text-3xl font-semibold leading-tight text-white">
                  Tu hogar, protegido desde el primer acceso.
                </h3>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  {getAuthContextCopy(authMode)}
                </p>
              </div>
              <div className="relative mt-12 flex items-center gap-3 border-t border-white/10 pt-6 text-xs leading-5 text-slate-400">
                <LandingIcon name="lock" compact />
                Verificación OTP y sesiones seguras con Supabase.
              </div>
            </aside>

            <div className="max-h-[94vh] overflow-y-auto p-5 sm:p-8 lg:p-10">
              <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
                  {getAuthEyebrow(authMode)}
                </p>
                <h2 id="auth-dialog-title" className="mt-2 font-display text-2xl font-semibold text-white sm:text-3xl">
                  {getAuthTitle(authMode)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void handleCloseAuthModal()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 text-xl text-slate-300 transition hover:bg-white/[0.07] hover:text-white"
                aria-label="Cerrar ventana"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <AuthProgress mode={authMode} />

            {notice ? (
              <p className="mt-5 rounded-lg border border-[#6ee7b7]/25 bg-[#6ee7b7]/10 px-4 py-3 text-sm leading-6 text-[#c6ffe8]">
                {notice}
              </p>
            ) : null}

            {authMode === "signupOtp" || authMode === "recoveryOtp" ? (
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Escribe el código enviado a{" "}
                <span className="font-semibold text-white">{pendingEmail}</span>.
                El código tiene {OTP_LENGTH} dígitos y vence en 60 minutos.
              </p>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {authMode === "register" ? (
                <>
                  <TextField
                    label="Nombre de usuario"
                    autoComplete="username"
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
                    label="Contraseña"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    error={errors.password}
                    onChange={(value) => updateForm("password", value)}
                  />
                  <TextField
                    label="Confirmar contraseña"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    error={
                      form.confirmPassword.length > 0 &&
                      form.password !== form.confirmPassword
                        ? "Las contraseñas no coinciden."
                        : errors.confirmPassword
                    }
                    onChange={(value) => updateForm("confirmPassword", value)}
                  />
                  <TextField
                    label="Teléfono"
                    inputMode="tel"
                    autoComplete="tel"
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
                    label="Contraseña"
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
                    label="Código OTP"
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
                    label="Nueva contraseña"
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
                    label="Confirmar nueva contraseña"
                    type="password"
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    error={
                      confirmNewPassword.length > 0 &&
                      confirmNewPassword !== newPassword
                        ? "Las contraseñas no coinciden."
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
                  ¿Olvidaste tu contraseña?
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleResendUnconfirmedEmail()}
                  className="font-semibold text-[#6ee7b7] transition hover:text-white disabled:opacity-50"
                >
                  Reenviar código de confirmación
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
                    ? `Reenviar código en ${resendSeconds}s`
                    : "Reenviar código"}
                </button>
                <button
                  type="button"
                  onClick={handleLogin}
                  className="font-semibold text-[#9edfff] transition hover:text-white"
                >
                  Volver a iniciar sesión
                </button>
              </div>
            ) : null}

            {authMode === "forgotPassword" ? (
              <button
                type="button"
                onClick={handleLogin}
                className="mt-4 w-full text-sm font-semibold text-[#9edfff] transition hover:text-white"
              >
                Volver a iniciar sesión
              </button>
            ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function TrustItem({
  icon,
  title,
  copy,
}: {
  icon: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="flex items-center gap-4 bg-[#0b1d2b]/95 p-5 sm:p-6">
      <LandingIcon name={icon} compact />
      <div>
        <p className="font-display text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{copy}</p>
      </div>
    </div>
  );
}

function LandingIcon({
  name,
  compact = false,
}: {
  name: string;
  compact?: boolean;
}) {
  let content = (
    <>
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3" />
      <circle cx="12" cy="12" r="4" />
    </>
  );

  if (name === "voice") {
    content = (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6" />
      </>
    );
  } else if (name === "shield") {
    content = <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" />;
  } else if (name === "spark") {
    content = (
      <>
        <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z" />
        <path d="m18.5 15 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
      </>
    );
  } else if (name === "camera") {
    content = (
      <>
        <rect x="3" y="7" width="18" height="12" rx="2" />
        <path d="m8 7 1.5-3h5L16 7" />
        <circle cx="12" cy="13" r="3" />
      </>
    );
  } else if (name === "door") {
    content = (
      <>
        <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16" />
        <circle cx="14.5" cy="12" r=".7" fill="currentColor" stroke="none" />
      </>
    );
  } else if (name === "light") {
    content = (
      <>
        <path d="M9 18h6m-5 3h4M8.5 15.5a7 7 0 1 1 7 0c-.7.5-.8 1.2-.8 2h-5.4c0-.8-.1-1.5-.8-2Z" />
      </>
    );
  } else if (name === "sensor") {
    content = (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" />
      </>
    );
  } else if (name === "cloud") {
    content = <path d="M7 18h11a4 4 0 0 0 .5-8 7 7 0 0 0-13-1.5A4.8 4.8 0 0 0 7 18Z" />;
  } else if (name === "lock") {
    content = (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
      </>
    );
  }

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-xl border border-[#6ee7b7]/20 bg-[#6ee7b7]/10 text-[#9af0ce] ${
        compact ? "h-9 w-9" : "h-12 w-12"
      }`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        className={compact ? "h-4 w-4" : "h-5 w-5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {content}
      </svg>
    </span>
  );
}

function AuthProgress({ mode }: { mode: AuthMode }) {
  const progress = getAuthProgress(mode);

  return (
    <div className="mt-6" aria-label={`Paso ${progress.current} de ${progress.total}: ${progress.label}`}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-slate-300">{progress.label}</span>
        <span className="text-slate-500">
          Paso {progress.current} de {progress.total}
        </span>
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${progress.total}, minmax(0, 1fr))` }}>
        {Array.from({ length: progress.total }, (_, index) => (
          <span
            key={index}
            className={`h-1 rounded-full ${
              index < progress.current ? "bg-[#6ee7b7]" : "bg-white/10"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function getAuthProgress(mode: AuthMode) {
  if (mode === "register") {
    return { current: 1, total: 2, label: "Datos de tu cuenta" };
  }
  if (mode === "signupOtp") {
    return { current: 2, total: 2, label: "Verificación del correo" };
  }
  if (mode === "forgotPassword") {
    return { current: 1, total: 3, label: "Solicitar recuperación" };
  }
  if (mode === "recoveryOtp") {
    return { current: 2, total: 3, label: "Verificar identidad" };
  }
  if (mode === "newPassword") {
    return { current: 3, total: 3, label: "Crear contraseña" };
  }
  return { current: 1, total: 1, label: "Acceso a tu hogar" };
}

function getAuthContextIcon(mode: AuthMode) {
  if (mode === "register" || mode === "signupOtp") {
    return "spark";
  }
  if (mode === "forgotPassword" || mode === "recoveryOtp" || mode === "newPassword") {
    return "shield";
  }
  return "lock";
}

function getAuthContextCopy(mode: AuthMode) {
  if (mode === "register" || mode === "signupOtp") {
    return "Crea una identidad personal y verifica tu correo con un código de 8 dígitos antes de entrar al Laboratorio.";
  }
  if (mode === "forgotPassword" || mode === "recoveryOtp" || mode === "newPassword") {
    return "Recupera el acceso con un código temporal y establece una contraseña nueva sin perder tu sesión.";
  }
  return "Inicia sesión con tu correo y contraseña para acceder de forma segura a tus dispositivos y automatizaciones.";
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
    return "Recuperación segura";
  }
  return "Acceso seguro";
}

function getAuthTitle(mode: AuthMode) {
  const titles: Record<AuthMode, string> = {
    register: "Habilita el Laboratorio AFCR",
    signupOtp: "Verifica tu correo",
    login: "Inicia sesión en AFCR",
    forgotPassword: "Recupera tu contraseña",
    recoveryOtp: "Valida el código de recuperación",
    newPassword: "Crea una contraseña nueva",
  };
  return titles[mode];
}

function getAuthSubmitLabel(mode: AuthMode) {
  const labels: Record<AuthMode, string> = {
    register: "Registrarme",
    signupOtp: "Verificar correo",
    login: "Iniciar sesión",
    forgotPassword: "Enviar código OTP",
    recoveryOtp: "Validar código",
    newPassword: "Guardar nueva contraseña",
  };
  return labels[mode];
}

function getSignupErrorMessage(message: string) {
  if (isUsernameConflictMessage(message)) {
    return "Ese nombre de usuario ya está en uso. Prueba con otro.";
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
    return "El código es inválido o venció. Solicita uno nuevo.";
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("email rate") ||
    normalized.includes("over_email_send_rate_limit")
  ) {
    return "Se alcanzó el límite temporal de correos. Espera un momento e intenta de nuevo.";
  }
  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid_credentials")
  ) {
    return "Correo o contraseña incorrectos.";
  }
  if (
    normalized.includes("email not confirmed") ||
    normalized.includes("email_not_confirmed")
  ) {
    return "Tu correo todavía no está confirmado. Usa la opción para reenviar el código.";
  }
  if (
    normalized.includes("fetch") ||
    normalized.includes("network") ||
    normalized.includes("failed to")
  ) {
    return "No se pudo conectar con el servicio de autenticación. Intenta nuevamente.";
  }

  return message;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof Event !== "undefined" && error instanceof Event) {
    return "No se pudo completar la operación del navegador. Inténtalo nuevamente.";
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
  const isOtp = autoComplete === "one-time-code";

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
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-12 rounded-xl border border-white/10 bg-[#06101b] px-4 text-white outline-none transition placeholder:text-slate-600 focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20 ${
          isOtp
            ? "text-center font-display text-2xl font-semibold tracking-[0.42em] sm:text-3xl"
            : "text-sm"
        }`}
      />
      {error ? <span className="text-xs text-[#ffc1cb]">{error}</span> : null}
    </label>
  );
}
