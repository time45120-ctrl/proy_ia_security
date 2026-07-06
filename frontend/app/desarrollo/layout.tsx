"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  type DevelopmentCurrentUser,
  DevelopmentWorkspaceProvider,
  type DevelopmentProfileInput,
  type DevelopmentView,
  useDevelopmentWorkspace,
} from "./workspace-context";

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const USERNAME_ERROR =
  "Usa 3 a 30 caracteres: letras minusculas, numeros o guion bajo.";

export default function DesarrolloLayout({ children }: { children: ReactNode }) {
  return (
    <DevelopmentWorkspaceProvider>
      <DevelopmentShell>{children}</DevelopmentShell>
    </DevelopmentWorkspaceProvider>
  );
}

function DevelopmentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    canOpenDashboard,
    currentUser,
    isCheckingAccess,
    hasLaboratoryAccess,
    isSavingProfile,
    navigateToView,
    updateProfile,
  } = useDevelopmentWorkspace();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const activeView: DevelopmentView = pathname?.includes("/dashboard")
    ? "dashboard"
    : "sync";

  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // The session may already be invalid; still send the user back to access.
    }

    router.replace("/welcome");
  }

  if (isCheckingAccess || !hasLaboratoryAccess) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#071019] px-4 text-center text-slate-300">
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
          Validando acceso al Laboratorio...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-slate-50 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#07111d]/95 px-4 py-4 backdrop-blur-xl lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <div className="flex items-center justify-between gap-4 lg:block">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[#9edfff]">
              AFCR Seguridad
            </p>
            <h1 className="mt-2 font-display text-xl font-semibold text-white">
              Desarrollo
            </h1>
            {currentUser?.username ? (
              <p className="mt-1 truncate text-xs font-semibold text-[#6ee7b7]">
                @{currentUser.username}
              </p>
            ) : null}
          </div>
        </div>

        <nav className="mt-5 grid gap-2 sm:grid-cols-2 lg:mt-8 lg:grid-cols-1">
          <NavButton
            label="Sincronizacion"
            isActive={activeView === "sync"}
            onClick={() => navigateToView("sync")}
          />
          <NavButton
            label="Dashboard Principal"
            isActive={activeView === "dashboard"}
            isLocked={!canOpenDashboard}
            onClick={() => navigateToView("dashboard")}
          />
        </nav>

        <button
          type="button"
          onClick={() => setIsProfileOpen(true)}
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-lg border border-[#6ee7b7]/25 bg-[#6ee7b7]/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#c6ffe8] transition hover:bg-[#6ee7b7]/15 lg:mt-6"
        >
          Perfil
        </button>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-lg border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-400/15"
        >
          Cerrar sesion
        </button>
      </aside>

      <section className="min-w-0">{children}</section>
      {isProfileOpen ? (
        <ProfileModal
          currentUser={currentUser}
          isSaving={isSavingProfile}
          onClose={() => setIsProfileOpen(false)}
          onSave={updateProfile}
        />
      ) : null}
    </main>
  );
}

function ProfileModal({
  currentUser,
  isSaving,
  onClose,
  onSave,
}: {
  currentUser: DevelopmentCurrentUser | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: DevelopmentProfileInput) => Promise<void>;
}) {
  const [form, setForm] = useState({
    organizationName: currentUser?.organizationName ?? "",
    phone: currentUser?.phone ?? "",
    username: currentUser?.username ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      organizationName: currentUser?.organizationName ?? "",
      phone: currentUser?.phone ?? "",
      username: currentUser?.username ?? "",
    });
    setErrors({});
    setNotice(null);
  }, [currentUser]);

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function validateForm() {
    const nextErrors: Record<string, string> = {};

    if (
      currentUser?.canEditOrganization &&
      form.organizationName.trim().length < 2
    ) {
      nextErrors.organizationName = "Ingresa el nombre de la empresa.";
    }

    if (form.phone.trim().length < 6) {
      nextErrors.phone = "Ingresa un telefono de contacto.";
    }

    if (!USERNAME_PATTERN.test(form.username.trim().toLowerCase())) {
      nextErrors.username = USERNAME_ERROR;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validateForm()) {
      return;
    }

    setNotice(null);

    try {
      await onSave({
        organizationName: currentUser?.canEditOrganization
          ? form.organizationName.trim()
          : currentUser?.organizationName ?? form.organizationName.trim(),
        phone: form.phone.trim(),
        username: form.username.trim().toLowerCase(),
      });
      onClose();
    } catch (error) {
      setNotice(getErrorMessage(error));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#02070d]/82 px-4 py-6 backdrop-blur-sm">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-lg rounded-lg border border-white/12 bg-[#0a1522] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.55)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
              Perfil
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-white">
              Datos de la cuenta
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06]"
          >
            Cerrar
          </button>
        </div>

        {notice ? (
          <p className="mt-5 rounded-lg border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {notice}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4">
          <ProfileField
            label="Empresa"
            value={form.organizationName}
            error={errors.organizationName}
            disabled={!currentUser?.canEditOrganization}
            onChange={(value) => updateField("organizationName", value)}
          />
          {!currentUser?.canEditOrganization ? (
            <p className="-mt-2 text-xs leading-5 text-slate-500">
              Solo el propietario puede cambiar el nombre de la empresa.
            </p>
          ) : null}
          <ProfileField
            label="Telefono"
            value={form.phone}
            error={errors.phone}
            onChange={(value) => updateField("phone", value)}
          />
          <ProfileField
            label="Nombre de usuario"
            value={form.username}
            error={errors.username}
            onChange={(value) => updateField("username", value.toLowerCase())}
          />
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#6ee7b7] px-5 py-3 text-sm font-bold uppercase tracking-[0.1em] text-[#052018] transition hover:bg-[#8af0c9] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? "Guardando..." : "Guardar cambios"}
        </button>
      </form>
    </div>
  );
}

function ProfileField({
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 rounded-lg border border-white/10 bg-[#06101b] px-3 text-white outline-none transition placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60 focus:border-[#44c7f4]/60 focus:ring-2 focus:ring-[#44c7f4]/20"
      />
      {error ? <span className="text-xs text-[#ffc1cb]">{error}</span> : null}
    </label>
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "No se pudo actualizar el perfil.";
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
