export type CompanyOperationSize =
  | "1-25"
  | "26-100"
  | "101-500"
  | "500+";

export type SecurityNeed =
  | "camaras"
  | "accesos"
  | "luces"
  | "drones"
  | "integral";

export type LandingRegistration = {
  companyName: string;
  contactName: string;
  role: string;
  email: string;
  phone: string;
  operationSize: CompanyOperationSize;
  primaryNeed: SecurityNeed;
  source: "afcr-welcome-mvp";
  apiBaseUrl: string;
  futureAwsReady: true;
  createdAt: string;
};

export type LandingSession = {
  email: string;
  companyName: string;
  startedAt: string;
};

export const LANDING_REGISTRATION_STORAGE_KEY = "afcr_security_registration";
export const LANDING_SESSION_STORAGE_KEY = "afcr_security_session";

export const FUTURE_AWS_AUTH_ENDPOINTS = {
  registerCompany: "/companies/register",
  login: "/auth/login",
} as const;

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function readJson<T>(key: string): T | null {
  const storage = getBrowserStorage();

  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(key);
    return rawValue ? (JSON.parse(rawValue) as T) : null;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function getLandingRegistration() {
  return readJson<LandingRegistration>(LANDING_REGISTRATION_STORAGE_KEY);
}

export function getLandingSession() {
  return readJson<LandingSession>(LANDING_SESSION_STORAGE_KEY);
}

export function saveLandingRegistration(registration: LandingRegistration) {
  const storage = getBrowserStorage();

  if (!storage) {
    return;
  }

  storage.setItem(
    LANDING_REGISTRATION_STORAGE_KEY,
    JSON.stringify(registration),
  );
}

export function startLandingSession(registration: LandingRegistration) {
  const session: LandingSession = {
    email: registration.email,
    companyName: registration.companyName,
    startedAt: new Date().toISOString(),
  };
  const storage = getBrowserStorage();

  if (storage) {
    storage.setItem(LANDING_SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  return session;
}

export function closeLandingSession() {
  getBrowserStorage()?.removeItem(LANDING_SESSION_STORAGE_KEY);
}
