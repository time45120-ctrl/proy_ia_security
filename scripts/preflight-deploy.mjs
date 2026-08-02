import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const allowDirty = process.argv.includes("--allow-dirty");
const requireSupabase = process.argv.includes("--require-supabase");
const skipNetwork = process.argv.includes("--skip-network");
const authorizedSupabaseProjectRef = "omkbowrspgbuwpifksfk";
const expectedMigrationCount = 10;
const edgeFunctionName = "purge-expired-voice-audio";
const supabaseCliEnvironment = { SUPABASE_TELEMETRY_DISABLED: "1" };
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
    env: { ...process.env, ...(options.env ?? {}) },
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
  run(
    "autenticacion GitHub CLI",
    "gh",
    ["api", "user", "--jq", ".login"],
    { timeout: 30_000 },
  );
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
if (linkedProjectRef === authorizedSupabaseProjectRef) {
  ok("Supabase CLI enlazado al proyecto autorizado");
} else if (requireSupabase) {
  fail(
    `Supabase CLI no esta enlazado; ejecuta npx supabase link --project-ref ${authorizedSupabaseProjectRef}`,
  );
} else {
  warn(
    "Supabase CLI no esta enlazado; solo es necesario para publicar migraciones o Edge Functions",
  );
}

if (requireSupabase) {
  const migrationsPath = "supabase/migrations";
  const localMigrations = existsSync(migrationsPath)
    ? readdirSync(migrationsPath).filter((name) => /^\d{14}_.+\.sql$/.test(name))
    : [];
  if (localMigrations.length === expectedMigrationCount) {
    ok(`Supabase: ${expectedMigrationCount} migraciones locales presentes`);
  } else {
    fail(
      `Supabase: se esperaban ${expectedMigrationCount} migraciones locales y se encontraron ${localMigrations.length}`,
    );
  }

  const functionEntrypoint = `supabase/functions/${edgeFunctionName}/index.ts`;
  if (existsSync(functionEntrypoint)) {
    ok(`Supabase: codigo local de ${edgeFunctionName} presente`);
  } else {
    fail(`Supabase: falta ${functionEntrypoint}`);
  }

  const configPath = "supabase/config.toml";
  if (!existsSync(configPath)) {
    fail(`falta ${configPath}`);
  } else {
    const config = readFileSync(configPath, "utf8");
    const functionSection = config
      .split(/(?=^\[)/m)
      .find((section) =>
        section.startsWith(`[functions.${edgeFunctionName}]`),
      );
    if (!functionSection) {
      fail(
        "Supabase: purge-expired-voice-audio no esta declarada en config.toml",
      );
    } else if (!/^verify_jwt\s*=\s*true(?:\s*#.*)?$/m.test(functionSection)) {
      fail(
        "Supabase: purge-expired-voice-audio debe conservar verify_jwt = true",
      );
    } else {
      ok("Supabase: Edge Function declarada con verificacion JWT");
    }
  }

  const obsoleteWorkflow = ".github/workflows/deploy-supabase.yml";
  if (existsSync(obsoleteWorkflow)) {
    fail(`Supabase: elimina el workflow obsoleto ${obsoleteWorkflow}`);
  } else {
    ok("Supabase: workflow propio obsoleto eliminado");
  }

  const workflowsPath = ".github/workflows";
  const forbiddenWorkflowIdentifiers = [
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_DEPLOY_ENABLED",
  ];
  const workflowFiles = existsSync(workflowsPath)
    ? readdirSync(workflowsPath).filter((name) => /\.ya?ml$/.test(name))
    : [];
  const forbiddenUsages = workflowFiles.flatMap((name) => {
    const contents = readFileSync(`${workflowsPath}/${name}`, "utf8");
    return forbiddenWorkflowIdentifiers
      .filter((identifier) => contents.includes(identifier))
      .map((identifier) => `${name}:${identifier}`);
  });
  if (forbiddenUsages.length === 0) {
    ok("Supabase: ningun workflow propio exige credenciales de despliegue");
  } else {
    fail(
      `Supabase: identificadores obsoletos encontrados en workflows: ${forbiddenUsages.join(", ")}`,
    );
  }

  if (!skipNetwork) {
    const migrationListRaw = capture(
      "npx",
      ["supabase", "migration", "list", "--linked", "--output-format", "json"],
      { timeout: 60_000, env: supabaseCliEnvironment },
    );
    try {
      const migrationPayload = JSON.parse(migrationListRaw ?? "{}");
      const migrations = Array.isArray(migrationPayload)
        ? migrationPayload
        : (migrationPayload.migrations ?? []);
      const synchronizedMigrations = migrations.filter(
        (migration) =>
          typeof migration.local === "string" &&
          migration.local !== "" &&
          migration.local === migration.remote,
      );
      if (
        migrations.length === expectedMigrationCount &&
        synchronizedMigrations.length === expectedMigrationCount
      ) {
        ok(
          `Supabase remoto: ${expectedMigrationCount} migraciones sincronizadas`,
        );
      } else {
        fail(
          `Supabase remoto: se esperaban ${expectedMigrationCount} migraciones sincronizadas`,
        );
      }
    } catch {
      fail("Supabase remoto: no se pudo interpretar la lista de migraciones");
    }

    const functionsRaw = capture(
      "npx",
      [
        "supabase",
        "functions",
        "list",
        "--project-ref",
        authorizedSupabaseProjectRef,
        "--output-format",
        "json",
      ],
      { timeout: 60_000, env: supabaseCliEnvironment },
    );
    try {
      const functionsPayload = JSON.parse(functionsRaw ?? "{}");
      const functions = Array.isArray(functionsPayload)
        ? functionsPayload
        : (functionsPayload.functions ?? []);
      const remoteFunction = functions.find(
        (item) =>
          item.slug === edgeFunctionName || item.name === edgeFunctionName,
      );
      if (!remoteFunction) {
        fail(`Supabase remoto: no existe ${edgeFunctionName}`);
      } else if (remoteFunction.status !== "ACTIVE") {
        fail(`Supabase remoto: ${edgeFunctionName} no esta activa`);
      } else if (remoteFunction.verify_jwt !== true) {
        fail(`Supabase remoto: ${edgeFunctionName} no conserva verify_jwt=true`);
      } else {
        ok(`Supabase remoto: ${edgeFunctionName} activa con verify_jwt=true`);
      }
    } catch {
      fail("Supabase remoto: no se pudo interpretar la lista de Edge Functions");
    }
  } else {
    warn("se omitieron las comprobaciones remotas de Supabase por --skip-network");
  }

  warn(
    "no se afirma que GitHub Integration este activa hasta observar un check nativo de Supabase exitoso despues del push",
  );
}

console.log(`\nResultado: ${failures} error(es), ${warnings} aviso(s).`);
process.exitCode = failures === 0 ? 0 : 1;
