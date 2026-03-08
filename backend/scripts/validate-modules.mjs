import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

async function collectJsFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return collectJsFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
    })
  );

  return files.flat();
}

async function main() {
  const directories = [
    path.join(backendRoot, "src", "models"),
    path.join(backendRoot, "src", "middleware"),
    path.join(backendRoot, "src", "routes"),
    path.join(backendRoot, "src", "services")
  ];

  const extraFiles = [
    path.join(backendRoot, "src", "config.js"),
    path.join(backendRoot, "src", "db.js"),
    path.join(backendRoot, "src", "mongo.js")
  ];

  const discoveredFiles = (await Promise.all(directories.map((dirPath) => collectJsFiles(dirPath)))).flat();
  const filesToImport = [...new Set([...extraFiles, ...discoveredFiles])].sort();

  for (const filePath of filesToImport) {
    await import(pathToFileURL(filePath).href);
  }

  console.log(`Validated ${filesToImport.length} backend modules.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});