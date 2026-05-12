import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const outDir = join(process.cwd(), "out");
const nextDir = join(outDir, "_next");
const publicNextDir = join(outDir, "next");

if (!existsSync(nextDir)) {
  throw new Error("No se encontro out/_next. Ejecuta next build antes de preparar Hostinger.");
}

mkdirSync(publicNextDir, { recursive: true });
cpSync(nextDir, publicNextDir, { recursive: true });

const textExtensions = new Set([
  ".html",
  ".js",
  ".css",
  ".json",
  ".txt",
  ".xml",
  ".svg",
]);

function hasTextExtension(filePath) {
  return [...textExtensions].some((extension) => filePath.endsWith(extension));
}

function rewriteFile(filePath) {
  if (!hasTextExtension(filePath)) {
    return;
  }

  const original = readFileSync(filePath, "utf8");
  const rewritten = original
    .replaceAll("/_next/", "/next/")
    .replaceAll('\\"/_next/', '\\"/next/');

  if (rewritten !== original) {
    writeFileSync(filePath, rewritten);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      walk(filePath);
      continue;
    }

    rewriteFile(filePath);
  }
}

walk(outDir);
console.log("Hostinger static assets preparados en out/next.");
