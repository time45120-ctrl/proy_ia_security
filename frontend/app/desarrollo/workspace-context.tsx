"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { listDevices, type LinkedDeviceRecord } from "@/lib/backend-api";
import { createClient } from "@/lib/supabase/client";

export type DevelopmentView = "sync" | "dashboard";

export type DevelopmentCurrentUser = {
  id: string;
  email: string | null;
  username: string | null;
  phone: string;
};

export type DevelopmentProfileInput = {
  phone: string;
  username: string;
};

type DevelopmentWorkspaceContextValue = {
  currentUser: DevelopmentCurrentUser | null;
  isSavingProfile: boolean;
  linkedDevices: LinkedDeviceRecord[];
  linkedCount: number;
  notice: string | null;
  dashboardResetSignal: number;
  canOpenDashboard: boolean;
  isCheckingAccess: boolean;
  hasLaboratoryAccess: boolean;
  hasCheckedDevices: boolean;
  refreshDevices: () => Promise<void>;
  updateProfile: (input: DevelopmentProfileInput) => Promise<void>;
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
  const [currentUser, setCurrentUser] =
    useState<DevelopmentCurrentUser | null>(null);
  const [linkedDevices, setLinkedDevices] = useState<LinkedDeviceRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [dashboardResetSignal, setDashboardResetSignal] = useState(0);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [hasLaboratoryAccess, setHasLaboratoryAccess] = useState(false);
  const [hasCheckedDevices, setHasCheckedDevices] = useState(false);

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
    } finally {
      setHasCheckedDevices(true);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function verifyAccess() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!isMounted) {
          return;
        }
        if (!user) {
          setCurrentUser(null);
          router.replace("/welcome");
          setHasCheckedDevices(true);
          setIsCheckingAccess(false);
          return;
        }

        const profile = await fetchCurrentProfile(supabase, user.id);

        if (!isMounted) {
          return;
        }

        setCurrentUser({
          ...profile,
          id: user.id,
          email: user.email ?? null,
        });
        setHasLaboratoryAccess(true);
        setIsCheckingAccess(false);
        void refreshDevices();
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setNotice(getErrorMessage(error));
        setCurrentUser(null);
        setHasLaboratoryAccess(false);
        setHasCheckedDevices(true);
        setIsCheckingAccess(false);
        router.replace("/welcome");
      }
    }

    void verifyAccess().catch((error) => {
      if (!isMounted) {
        return;
      }

      setNotice(getErrorMessage(error));
      setCurrentUser(null);
      setHasLaboratoryAccess(false);
      setHasCheckedDevices(true);
      setIsCheckingAccess(false);
      router.replace("/welcome");
    });
    return () => {
      isMounted = false;
    };
  }, [router]);

  const updateProfile = useCallback(
    async (input: DevelopmentProfileInput) => {
      if (!currentUser) {
        throw new Error("Sesion no disponible.");
      }

      const phone = input.phone.trim();
      const username = input.username.trim().toLowerCase();

      const supabase = createClient();
      setIsSavingProfile(true);
      setNotice(null);

      try {
        const { error: profileError } = await supabase
          .from("profiles")
          .update({
            username,
            phone,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", currentUser.id);

        if (profileError) {
          throw profileError;
        }

        setCurrentUser((current) =>
          current
            ? {
                ...current,
                username,
                phone,
              }
            : current,
        );
        setNotice("Perfil actualizado.");
      } catch (error) {
        throw new Error(getProfileUpdateErrorMessage(error));
      } finally {
        setIsSavingProfile(false);
      }
    },
    [currentUser],
  );

  const navigateToView = useCallback(
    (nextView: DevelopmentView) => {
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
    },
    [canOpenDashboard, router],
  );

  const contextValue = useMemo(
    () => ({
      currentUser,
      isSavingProfile,
      linkedDevices,
      linkedCount,
      notice,
      dashboardResetSignal,
      canOpenDashboard,
      isCheckingAccess,
      hasLaboratoryAccess,
      hasCheckedDevices,
      refreshDevices,
      updateProfile,
      navigateToView,
      openDashboard: () => navigateToView("dashboard"),
    }),
    [
      currentUser,
      isSavingProfile,
      linkedDevices,
      linkedCount,
      notice,
      dashboardResetSignal,
      canOpenDashboard,
      isCheckingAccess,
      hasLaboratoryAccess,
      hasCheckedDevices,
      navigateToView,
      updateProfile,
    ],
  );

  return (
    <DevelopmentWorkspaceContext.Provider value={contextValue}>
      {children}
    </DevelopmentWorkspaceContext.Provider>
  );
}

async function fetchCurrentProfile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<Omit<DevelopmentCurrentUser, "id" | "email">> {
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("username, phone")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError && isMissingUsernameColumnError(profileError)) {
    const fallback = await supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", userId)
      .maybeSingle();

    profile = fallback.data ? { ...fallback.data, username: null } : null;
    profileError = fallback.error;
  }

  if (profileError || !profile) {
    return emptyProfile();
  }

  return {
    username: textOrNull(profile.username),
    phone: textOrEmpty(profile.phone),
  };
}

function emptyProfile(): Omit<DevelopmentCurrentUser, "id" | "email"> {
  return {
    username: null,
    phone: "",
  };
}

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getProfileUpdateErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();

  if (isMissingUsernameColumnMessage(normalized)) {
    return "La base de datos aun no tiene el campo nombre de usuario. Aplica la migracion de perfil antes de guardar.";
  }

  if (
    normalized.includes("profiles_username_unique") ||
    normalized.includes("profiles_username_key") ||
    normalized.includes("duplicate key") ||
    normalized.includes("username")
  ) {
    return "Ese nombre de usuario ya esta en uso.";
  }

  return message;
}

function isMissingUsernameColumnError(error: unknown) {
  return isMissingUsernameColumnMessage(getErrorMessage(error).toLowerCase());
}

function isMissingUsernameColumnMessage(message: string) {
  return (
    message.includes("username") &&
    (message.includes("column") || message.includes("schema cache"))
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

  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return "Error desconocido";
}
