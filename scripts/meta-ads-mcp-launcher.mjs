import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const envFile = resolve(projectRoot, ".env.meta-ads.local");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

if (!process.env.META_ADS_ACCESS_TOKEN?.trim()) {
  console.error(
    "Meta Ads MCP: defina META_ADS_ACCESS_TOKEN em .env.meta-ads.local.",
  );
  process.exit(1);
}

const child = spawn(
  "npx",
  ["-y", "meta-ads-mcp-server@1.5.1"],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      META_ADS_ENABLE_WRITE_TOOLS:
        process.env.META_ADS_ENABLE_WRITE_TOOLS || "false",
    },
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(`Meta Ads MCP: falha ao iniciar o servidor: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
