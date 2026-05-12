"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-[#050b14] px-5 py-10 text-slate-100">
          <section className="w-full max-w-md rounded-lg border border-cyan-300/20 bg-slate-950/80 p-6 text-center shadow-2xl shadow-cyan-950/20">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              AFCR Seguridad
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-white">
              No se pudo cargar el panel en este navegador.
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Recarga la pagina. Si vuelve a pasar, prueba en modo incognito o
              actualiza el navegador del celular.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md border border-cyan-300/30 bg-cyan-300/10 px-5 text-sm font-semibold text-cyan-50 transition hover:border-cyan-200 hover:bg-cyan-300/20"
            >
              Recargar panel
            </button>
            {error.digest ? (
              <p className="mt-4 break-words text-xs text-slate-500">
                Codigo: {error.digest}
              </p>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
