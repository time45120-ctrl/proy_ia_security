"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { listDevices, type LinkedDeviceRecord } from "@/lib/backend-api";
import { createClient } from "@/lib/supabase/client";

export type DevelopmentView = "sync" | "dashboard";

type DevelopmentWorkspaceContextValue = {
  linkedDevices: LinkedDeviceRecord[];
  linkedCount: number;
  notice: string | null;
  dashboardResetSignal: number;
  canOpenDashboard: boolean;
  isCheckingAccess: boolean;
  hasLaboratoryAccess: boolean;
  refreshDevices: () => Promise<void>;
  navigateToView: (view: DevelopmentView) => void;
  openDashboard: () => void;
};

const developmentRoutes: Record<DevelopmentView, string> = {
  sync: "/desarrollo/sync",
  dashboard: "/desarrollo/dashboard",
};

const DevelopmentWorkspaceContext =
  createContext<DevelopmentWorkspaceContextValue | null>(null);

export function useDevelopmentWorkspace() {
  const value = useContext(DevelopmentWorkspaceContext);

  if (!value) {
    throw new Error(
      "useDevelopmentWorkspace debe usarse dentro de DevelopmentWorkspaceProvider.",
    );
  }

  return value;
}

export function DevelopmentWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [linkedDevices, setLinkedDevices] = useState<LinkedDeviceRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dashboardResetSignal, setDashboardResetSignal] = useState(0);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [hasLaboratoryAccess, setHasLaboratoryAccess] = useState(false);

  const linkedCount = linkedDevices.filter(
    (device) => !device.is_demo && device.claimed_at,
  ).length;
  const canOpenDashboard = linkedCount > 0;

  async function refreshDevices() {
    try {
      const payload = await listDevices();
      setLinkedDevices(payload.devices ?? []);
    } catch (error) {
      setNotice(getErrorMessage(error));
      setLinkedDevices((current) => current);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function verifyAccess() {
      try {
        const {
          data: { user },
        } = await createClient().auth.getUser();

        if (!isMounted) {
          return;
        }
        if (!user) {
          router.replace("/welcome");
          setIsCheckingAccess(false);
          return;
        }

        setHasLaboratoryAccess(true);
        setIsCheckingAccess(false);
        void refreshDevices();
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setNotice(getErrorMessage(error));
        setHasLaboratoryAccess(false);
        setIsCheckingAccess(false);
        router.replace("/welcome");
      }
    }

    void verifyAccess().catch((error) => {
      if (!isMounted) {
        return;
      }

      setNotice(getErrorMessage(error));
      setHasLaboratoryAccess(false);
      setIsCheckingAccess(false);
      router.replace("/welcome");
    });
    return () => {
      isMounted = false;
    };
  }, [router]);

  function navigateToView(nextView: DevelopmentView) {
    if (nextView === "dashboard" && !canOpenDashboard) {
      router.push(developmentRoutes.sync);
      setNotice("Primero enlaza al menos un dispositivo para abrir el dashboard.");
      return;
    }

    setNotice(null);

    if (nextView === "dashboard") {
      setDashboardResetSignal((current) => current + 1);
    }

    router.push(developmentRoutes[nextView]);
  }

  const contextValue = useMemo(
    () => ({
      linkedDevices,
      linkedCount,
      notice,
      dashboardResetSignal,
      canOpenDashboard,
      isCheckingAccess,
      hasLaboratoryAccess,
      refreshDevices,
      navigateToView,
      openDashboard: () => navigateToView("dashboard"),
    }),
    [
      linkedDevices,
      linkedCount,
      notice,
      dashboardResetSignal,
      canOpenDashboard,
      isCheckingAccess,
      hasLaboratoryAccess,
    ],
  );

  return (
    <DevelopmentWorkspaceContext.Provider value={contextValue}>
      {children}
    </DevelopmentWorkspaceContext.Provider>
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
