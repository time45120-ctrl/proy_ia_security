"use client";

import { useEffect } from "react";

export default function DesarrolloError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error cargando laboratorio:", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#050b14] px-5 py-10 text-slate-100">
      <section className="w-full max-w-lg rounded-lg border border-cyan-300/20 bg-slate-950/80 p-6 text-center shadow-2xl shadow-cyan-950/20">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
          AFCR Seguridad
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-white">
          No se pudo cargar el laboratorio.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Recarga el panel. Si vuelve a pasar, cierra sesion y entra de nuevo para renovar la sesion del navegador.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-5 text-sm font-semibold text-cyan-50 transition hover:border-cyan-200 hover:bg-cyan-300/20"
          >
            Recargar
          </button>
          <a
            href="/welcome"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/15 bg-white/5 px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Volver al acceso
          </a>
        </div>
        {error.digest ? (
          <p className="mt-4 break-words text-xs text-slate-500">
            Codigo: {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
