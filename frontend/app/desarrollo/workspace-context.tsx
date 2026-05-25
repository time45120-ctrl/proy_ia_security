"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { listDevices, type LinkedDeviceRecord } from "@/lib/backend-api";
import { getLandingSession } from "@/lib/landing-session";

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

const demoLinkedDevice: LinkedDeviceRecord = {
  device_id: "demo-luz-cocina",
  name: "Luz cocina (demostracion)",
  type: "Demo",
  model: "Vista de prueba",
  status: "demo",
  status_label: "Demo visual",
  mqtt_topic: "",
  transport: "demo",
  is_demo: true,
  last_seen: "2026-05-12T00:00:00.000Z",
  created_at: "2026-05-12T00:00:00.000Z",
  pairing_expires_at: null,
  claimed_at: null,
};

const DevelopmentWorkspaceContext =
  createContext<DevelopmentWorkspaceContextValue | null>(null);

function withDemoLinkedDevice(devices: LinkedDeviceRecord[]) {
  const withoutDemo = devices.filter(
    (device) => device.device_id !== demoLinkedDevice.device_id,
  );

  return [demoLinkedDevice, ...withoutDemo];
}

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
  const [linkedDevices, setLinkedDevices] = useState<LinkedDeviceRecord[]>([
    demoLinkedDevice,
  ]);
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
      setLinkedDevices(withDemoLinkedDevice(payload.devices ?? []));
    } catch (error) {
      setNotice(getErrorMessage(error));
      setLinkedDevices((current) => withDemoLinkedDevice(current));
    }
  }

  useEffect(() => {
    if (!getLandingSession()) {
      router.replace("/welcome");
      setIsCheckingAccess(false);
      return;
    }

    setHasLaboratoryAccess(true);
    setIsCheckingAccess(false);
    void refreshDevices();
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

  return "Error desconocido";
}
