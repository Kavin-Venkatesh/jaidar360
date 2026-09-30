// Gives each flow-builder test file its own throwaway SQLite database and deterministic tenants.
// Must be required before anything that loads Prisma.
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

function setupFlowTestDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wa-canvas-${name}-`));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.UPLOADS_DIR = path.join(dir, "uploads");
  execFileSync(path.join(__dirname, "..", "..", "node_modules", ".bin", "prisma"), ["db", "push", "--skip-generate"], {
    env: process.env,
    stdio: "ignore",
    cwd: path.join(__dirname, "..", ".."),
  });

  const env = require("../../src/config/env");
  env.UPLOADS_DIR = process.env.UPLOADS_DIR;

  const tenants = require("../../src/config/tenants");
  const acme = tenants.byId("tnt_acme");
  const fresh = tenants.byId("tnt_freshmart");
  acme.whatsapp.phoneNumberId = "PNID_ACME";
  acme.whatsapp.accessToken = "token-acme";
  fresh.whatsapp.phoneNumberId = "PNID_FRESH";
  fresh.whatsapp.accessToken = "token-fresh";
  acme.agents[0].phone = "+919000000001"; // Ravi
  acme.agents[1].phone = "+919000000002"; // Priya
  fresh.agents[0].phone = "+919000000001"; // Arun: same phone as Ravi, registered in both tenants

  return { dir, acme, fresh };
}

module.exports = { setupFlowTestDb };
