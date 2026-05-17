"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  DevelopmentWorkspaceProvider,
  type DevelopmentView,
  useDevelopmentWorkspace,
} from "./workspace-context";

export default function DesarrolloLayout({ children }: { children: ReactNode }) {
  return (
    <DevelopmentWorkspaceProvider>
      <DevelopmentShell>{children}</DevelopmentShell>
    </DevelopmentWorkspaceProvider>
  );
}

function DevelopmentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    linkedCount,
    canOpenDashboard,
    isCheckingAccess,
    hasLaboratoryAccess,
    navigateToView,
  } = useDevelopmentWorkspace();
  const activeView: DevelopmentView = pathname.includes("/dashboard")
    ? "dashboard"
    : "sync";

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
            onClick={() => navigateToView("sync")}
          />
          <NavButton
            label="Dashboard Principal"
            isActive={activeView === "dashboard"}
            isLocked={!canOpenDashboard}
            onClick={() => navigateToView("dashboard")}
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
