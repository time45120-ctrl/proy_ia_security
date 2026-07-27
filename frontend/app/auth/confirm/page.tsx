"use client";

import type { EmailOtpType } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//")
    ? value
    : "/desarrollo/sync";
}

export default function AuthConfirmPage() {
  const [message, setMessage] = useState("Confirmando tu acceso...");

  useEffect(() => {
    let isActive = true;

    async function confirmAuth() {
      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type") as EmailOtpType | null;
      const code = searchParams.get("code");
      const nextPath = safeNextPath(searchParams.get("next"));
      const supabase = createClient();

      let error: Error | null = null;
      if (tokenHash && type) {
        const result = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        error = result.error;
      } else if (code) {
        const result = await supabase.auth.exchangeCodeForSession(code);
        error = result.error;
      } else {
        error = new Error("Enlace de confirmación incompleto.");
      }

      if (!isActive) {
        return;
      }

      if (error) {
        setMessage("No pudimos confirmar el enlace. Volviendo al acceso...");
        window.location.replace("/welcome?auth_error=confirmation");
        return;
      }

      setMessage("Confirmación completada. Redirigiendo...");
      window.location.replace(nextPath);
    }

    void confirmAuth().catch(() => {
      if (!isActive) {
        return;
      }
      setMessage("No pudimos confirmar el enlace. Volviendo al acceso...");
      window.location.replace("/welcome?auth_error=confirmation");
    });

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#071019] px-4 text-center text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
          AFCR Tecnología
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold">
          Confirmación de cuenta
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>
      </section>
    </main>
  );
}
