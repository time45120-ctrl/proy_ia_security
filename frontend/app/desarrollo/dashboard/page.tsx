"use client";

import { useEffect } from "react";
import { VoiceDashboard } from "@/components/voice-dashboard";
import { useDevelopmentWorkspace } from "../workspace-context";

export default function DesarrolloDashboardPage() {
  return <DashboardContent />;
}

function DashboardContent() {
  const {
    canOpenDashboard,
    dashboardResetSignal,
    hasCheckedDevices,
    hasLaboratoryAccess,
    isCheckingAccess,
    navigateToView,
  } = useDevelopmentWorkspace();

  useEffect(() => {
    if (
      !isCheckingAccess &&
      hasLaboratoryAccess &&
      hasCheckedDevices &&
      !canOpenDashboard
    ) {
      navigateToView("sync");
    }
  }, [
    canOpenDashboard,
    hasCheckedDevices,
    hasLaboratoryAccess,
    isCheckingAccess,
    navigateToView,
  ]);

  if (!hasCheckedDevices || !canOpenDashboard) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#071019] px-4 text-center text-slate-300">
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
          Validando dispositivos sincronizados...
        </p>
      </main>
    );
  }

  return (
    <VoiceDashboard
      resetSignal={dashboardResetSignal}
      welcomeSignal={dashboardResetSignal}
    />
  );
}
