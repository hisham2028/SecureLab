// Runs before any install. Stops npm/yarn from creating a second lockfile.
const agent = process.env.npm_config_user_agent || "";
if (!agent.startsWith("pnpm/")) {
  console.error("\nThis repo uses pnpm. Run:  corepack enable && pnpm install\n");
  process.exit(1);
}
