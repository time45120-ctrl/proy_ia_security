import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const allowDirty = process.argv.includes("--allow-dirty");
const requireSupabase = process.argv.includes("--require-supabase");
const skipNetwork = process.argv.includes("--skip-network");
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

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout,
  });
  // Some managed sandboxes report EPERM metadata even when the child completed
  // successfully. The exit status remains the authoritative result.
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function run(label, command, args, options = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout,
  });
  if (result.error) {
    fail(`${label}: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    fail(`${label}: termino con codigo ${result.status ?? "desconocido"}`);
    return false;
  }
  ok(label);
  return true;
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor >= 22) {
  ok(`Node.js ${process.versions.node}`);
} else {
  fail(`se requiere Node.js 22 o posterior; version actual ${process.versions.node}`);
}

const topLevel = capture("git", ["rev-parse", "--show-toplevel"]);
if (topLevel === process.cwd()) {
  ok("ejecucion desde el toplevel del monorepo");
} else {
  fail("ejecuta este comando desde la raiz del monorepo");
}

const branch = capture("git", ["branch", "--show-current"]);
if (branch === "main") {
  ok("rama main");
} else {
  fail(`la rama activa es ${branch || "desconocida"}; se esperaba main`);
}

const remote = capture("git", ["remote", "get-url", "origin"]);
if (remote?.includes("abraham-development/casa-domotica-ia")) {
  ok("origin apunta al repositorio canonico");
} else {
  fail("origin no apunta a abraham-development/casa-domotica-ia");
}

const dirty = capture("git", ["status", "--porcelain"]);
if (dirty === "") {
  ok("worktree limpio");
} else if (allowDirty) {
  warn("el worktree tiene cambios; permitido por --allow-dirty");
} else {
  fail("el worktree tiene cambios sin commit; revisalos antes del push");
}

run("git diff --check", "git", ["diff", "--check"]);

if (!skipNetwork) {
  run("autenticacion GitHub CLI", "gh", ["auth", "status"], {
    timeout: 30_000,
  });
  run(
    "autenticacion Git para push",
    "git",
    ["push", "--dry-run", "origin", "main"],
    { timeout: 30_000 },
  );
}

const frontendEnvironment = {
  NEXT_PUBLIC_SITE_URL:
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com",
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.example.com",
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "sb_publishable_source_validation",
};

run("build frontend", "npm", ["--prefix", "frontend", "run", "build"], {
  env: frontendEnvironment,
});
run("pruebas backend", "node", ["scripts/run-backend-tests.mjs"]);

const localEnvironmentFiles = ["frontend/.env.local", "backend/.env"];
if (localEnvironmentFiles.every((file) => existsSync(file))) {
  run("variables locales", "node", ["scripts/check-env.mjs"]);
} else {
  warn(
    "faltan frontend/.env.local o backend/.env; no bloquea el despliegue administrado, pero si el runtime local completo",
  );
}

const projectRefPath = "supabase/.temp/project-ref";
const linkedProjectRef = existsSync(projectRefPath)
  ? readFileSync(projectRefPath, "utf8").trim()
  : "";
if (linkedProjectRef === "omkbowrspgbuwpifksfk") {
  ok("Supabase CLI enlazado al proyecto autorizado");
} else if (requireSupabase) {
  fail(
    "Supabase CLI no esta enlazado; ejecuta npx supabase link --project-ref omkbowrspgbuwpifksfk",
  );
} else {
  warn(
    "Supabase CLI no esta enlazado; solo es necesario para publicar migraciones o Edge Functions",
  );
}

if (requireSupabase) {
  if (!existsSync(".github/workflows/deploy-supabase.yml")) {
    fail("falta .github/workflows/deploy-supabase.yml");
  } else {
    ok("workflow de despliegue Supabase presente");
  }

  if (!skipNetwork) {
    const repository = "abraham-development/casa-domotica-ia";
    const variablesRaw = capture(
      "gh",
      ["api", `repos/${repository}/actions/variables?per_page=100`],
      { timeout: 30_000 },
    );
    const secretsRaw = capture(
      "gh",
      ["api", `repos/${repository}/environments/production/secrets`],
      { timeout: 30_000 },
    );

    try {
      const variables = JSON.parse(variablesRaw ?? "{}").variables ?? [];
      const values = new Map(
        variables.map((variable) => [variable.name, variable.value]),
      );
      if (values.get("SUPABASE_PROJECT_REF") === "omkbowrspgbuwpifksfk") {
        ok("GitHub: SUPABASE_PROJECT_REF apunta al proyecto autorizado");
      } else {
        fail("GitHub: falta SUPABASE_PROJECT_REF o apunta a otro proyecto");
      }
      if (values.get("SUPABASE_DEPLOY_ENABLED") === "true") {
        ok("GitHub: despliegue automatico de Supabase habilitado");
      } else {
        fail("GitHub: SUPABASE_DEPLOY_ENABLED debe ser true antes del push");
      }
    } catch {
      fail("no se pudieron validar las variables GitHub de Supabase");
    }

    try {
      const secrets = JSON.parse(secretsRaw ?? "{}").secrets ?? [];
      const names = new Set(secrets.map((secret) => secret.name));
      for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD"]) {
        if (names.has(name)) {
          ok(`GitHub production: ${name} configurado`);
        } else {
          fail(`GitHub production: falta el secreto ${name}`);
        }
      }
    } catch {
      fail("no se pudieron validar los secretos GitHub de Supabase");
    }
  }
}

console.log(`\nResultado: ${failures} error(es), ${warnings} aviso(s).`);
process.exitCode = failures === 0 ? 0 : 1;
