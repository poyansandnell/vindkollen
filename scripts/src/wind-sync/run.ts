import { runWindSync } from "@workspace/wind-sync";

async function main() {
  await runWindSync();
  process.exit(0);
}

main().catch((err) => {
  console.error("[wind-sync] fatal error:", err);
  process.exit(1);
});
