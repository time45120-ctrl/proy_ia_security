function requirePublicEnvironmentVariable(name: string, value: string | undefined) {
  const normalizedValue = value?.trim();
  const isExamplePlaceholder =
    normalizedValue?.includes("REPLACE_WITH_") ||
    normalizedValue?.includes("your-project-ref");

  if (!normalizedValue || isExamplePlaceholder) {
    throw new Error(
      `Falta ${name}. Copia .env.example como .env.local y configura tu proyecto de Supabase.`,
    );
  }

  return normalizedValue;
}

export const SUPABASE_URL = requirePublicEnvironmentVariable(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

// La clave publishable se entrega al navegador por diseno; RLS protege los datos.
// Una clave secret/service_role nunca debe declararse con el prefijo NEXT_PUBLIC_.
export const SUPABASE_PUBLISHABLE_KEY = requirePublicEnvironmentVariable(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
