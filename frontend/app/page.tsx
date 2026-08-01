"use client";

import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    window.location.replace("/welcome/");
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#071019] px-4 text-center text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6ee7b7]">
          AFCR Tecnologia
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold">
          Abriendo Casa Domotica IA
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          Si la redireccion no comienza automaticamente, puedes continuar de
          forma manual.
        </p>
        <a
          className="mt-5 inline-flex rounded-xl bg-[#6ee7b7] px-4 py-2 text-sm font-semibold text-[#071019]"
          href="/welcome/"
        >
          Continuar
        </a>
      </section>
    </main>
  );
}
