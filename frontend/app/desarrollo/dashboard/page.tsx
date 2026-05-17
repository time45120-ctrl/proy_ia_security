"use client";

import { VoiceDashboard } from "@/components/voice-dashboard";
import { useDevelopmentWorkspace } from "../workspace-context";

export default function DesarrolloDashboardPage() {
  return <DashboardContent />;
}

function DashboardContent() {
  const { dashboardResetSignal } = useDevelopmentWorkspace();

  return <VoiceDashboard resetSignal={dashboardResetSignal} />;
}
