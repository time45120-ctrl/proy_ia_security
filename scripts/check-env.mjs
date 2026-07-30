import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const placeholderFragments = [
  "REPLACE_WITH_",
  "your-project-ref",
  "your-domain.example",
  "TU_API_KEY",
];

function parseEnvironment(text) {
  const values = new Map();

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }

  return values;
}

function isConfigured(value) {
  return Boolean(
    value && !placeholderFragments.some((fragment) => value.includes(fragment)),
  );
}

async function readEnvironment(relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    await access(absolutePath, constants.R_OK);
    return {
      absolutePath,
      values: parseEnvironment(await readFile(absolutePath, "utf8")),
    };
  } catch {
    return { absolutePath, values: null };
  }
}

let failures = 0;
let warnings = 0;

function fail(message) {
  failures += 1;
  console.error(`ERROR: ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`AVISO: ${message}`);
}

function ok(message) {
  console.log(`OK: ${message}`);
}

function requireVariables(label, values, names) {
  for (const name of names) {
    if (isConfigured(values.get(name))) {
      ok(`${label}: ${name} configurada`);
    } else {
      fail(`${label}: falta completar ${name}`);
    }
  }
}

async function checkPrivatePermissions(absolutePath, label) {
  if (process.platform === "win32") return;

  const fileStat = await stat(absolutePath);
  if ((fileStat.mode & 0o077) !== 0) {
    warn(`${label} permite lectura o escritura a otros usuarios; usa chmod 600`);
  } else {
    ok(`${label}: permisos privados`);
  }
}

const frontend = await readEnvironment("frontend/.env.local");
if (!frontend.values) {
  fail("no existe frontend/.env.local; copia frontend/.env.example");
} else {
  requireVariables("frontend", frontend.values, [
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]);

  if (!isConfigured(frontend.values.get("NEXT_PUBLIC_SITE_URL"))) {
    warn("frontend: NEXT_PUBLIC_SITE_URL no esta definida; se usara el fallback del codigo");
  }

  const forbiddenPublicNames = [...frontend.values.keys()].filter((name) =>
    /^NEXT_PUBLIC_.*(SECRET|SERVICE_ROLE|OPENAI|PASSWORD|PRIVATE|SMTP|TOKEN)/u.test(
      name,
    ),
  );
  if (forbiddenPublicNames.length > 0) {
    fail(`frontend: variables sensibles marcadas como publicas: ${forbiddenPublicNames.join(", ")}`);
  }

  await checkPrivatePermissions(frontend.absolutePath, "frontend/.env.local");
}

const backend = await readEnvironment("backend/.env");
if (!backend.values) {
  fail("no existe backend/.env; copia backend/.env.example");
} else {
  requireVariables("backend", backend.values, [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
  ]);

  if (
    !isConfigured(backend.values.get("SUPABASE_SECRET_KEY")) &&
    !isConfigured(backend.values.get("SUPABASE_SERVICE_ROLE_KEY"))
  ) {
    fail("backend: configura SUPABASE_SECRET_KEY (o la legacy SERVICE_ROLE_KEY)");
  } else {
    ok("backend: clave privilegiada configurada solo en el servidor");
  }

  if (
    (backend.values.get("AI_PROVIDER") ?? "openai").toLowerCase() === "openai" &&
    !isConfigured(backend.values.get("OPENAI_API_KEY"))
  ) {
    fail("backend: AI_PROVIDER=openai requiere OPENAI_API_KEY");
  } else {
    ok("backend: proveedor de IA configurado");
  }

  await checkPrivatePermissions(backend.absolutePath, "backend/.env");
}

console.log(`Resultado: ${failures} error(es), ${warnings} aviso(s).`);
process.exitCode = failures === 0 ? 0 : 1;
