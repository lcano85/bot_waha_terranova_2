const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const expected = require("./waha-config.json");
const env = { ...dotenv.parse(fs.readFileSync(path.join(__dirname, ".env"))), ...process.env };
async function main() {
  if (String(env.PORT) !== String(expected.port) || env.WAHA_SESSION !== expected.session || env.WAHA_URL !== expected.wahaUrl) {
    throw new Error("PORT, WAHA_SESSION o WAHA_URL no coinciden con waha-config.json. Revisa la configuracion antes de iniciar.");
  }
  const response = await fetch(expected.wahaUrl + "/api/sessions/" + encodeURIComponent(expected.session), {
    headers: { "X-Api-Key": env.WAHA_API_KEY || "" }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("WAHA devolvio HTTP " + response.status);
  const session = await response.json();
  const webhooks = session.config?.webhooks || [];
  const messageHooks = webhooks.filter(h => h.events?.includes("message") || h.events?.includes("*"));
  if (!messageHooks.some(h => h.url === expected.webhookUrl)) throw new Error("Webhook de mensajes incorrecto. Debe apuntar a " + expected.webhookUrl);
  if (session.status !== "WORKING") throw new Error("La sesion esta en " + session.status + ", no en WORKING.");
  console.log("OK: " + expected.session + " | puerto " + expected.port + " | webhook " + expected.webhookUrl + " | WORKING");
}
main().catch(error => { console.error("Configuracion WAHA: " + error.message); process.exitCode = 1; });
