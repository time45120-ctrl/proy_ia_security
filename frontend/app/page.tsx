import { WelcomeGate } from "@/components/welcome-gate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Home() {
  return <WelcomeGate />;
}
