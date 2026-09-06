const express = require("express");
const axios = require("axios");
require("dotenv").config();
const store = require("./db");
const alerts = require("./mail/alerts").createAlerts(store.db);
alerts.start();

const app = express();
app.use(express.json());
app.use("/admin", express.static("public"));

const PORT = process.env.PORT || 3030;
const WAHA_URL = process.env.WAHA_URL || "http://localhost:3031";
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const WAHA_SESSION = process.env.WAHA_SESSION || "pry";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiar-esta-clave";
const TIME_ZONE = "America/Lima";
const sesiones = new Map();

const MENU_PRINCIPAL = `👋 *¡Bienvenido a Terranova Restobar!*

Tenemos estas opciones para ti:

1️⃣ Promoción vigente
2️⃣ Haz tu pedido
3️⃣ Ver menú por categorías
4️⃣ Dirección
5️⃣ Horario de atención
6️⃣ Carta digital
7️⃣ Hablar con un asesor

Escribe el número de la opción que deseas.`;

function normalizarTexto(texto = "") {
  return String(texto ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function fechaLima(fecha = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(fecha).map((p) => [p.type, p.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, day: days[parts.weekday] };
}

function horaEnRango(now, start, end) {
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function promocionVigente(now = new Date()) {
  const local = fechaLima(now);
  return store.all("SELECT * FROM promotions WHERE active = 1 ORDER BY (specific_date IS NOT NULL) DESC, priority DESC, id DESC")
    .find((promo) => (!promo.specific_date || promo.specific_date === local.date)
      && (promo.specific_date || promo.days.split(",").includes(String(local.day)))
      && horaEnRango(local.time, promo.start_time, promo.end_time));
}

function turnoVigente(now = new Date()) {
  const local = fechaLima(now);
  return store.all("SELECT * FROM schedules WHERE active = 1 ORDER BY sort_order, start_time")
    .find((schedule) => schedule.days.split(",").includes(String(local.day))
      && horaEnRango(local.time, schedule.start_time, schedule.end_time));
}

function menuCategorias(schedule = turnoVigente()) {
  if (!schedule) return "🍽️ *MENÚ TERRANOVA*\n\nEn este momento no hay un turno de atención activo. Revisa nuestros horarios en la opción 5.\n\n0️⃣ Volver al menú principal.";
  const rows = categoriasActivas(schedule.id);
  if (!rows.length) return `🍽️ *MENÚ ${schedule.name.toUpperCase()}*\n\nTodavía no hay categorías disponibles para este turno.\n\n0️⃣ Volver al menú principal.`;
  return `🍽️ *MENÚ · ${schedule.name.toUpperCase()}*\n\n${rows.map((row, i) => `${i + 1}️⃣ ${row.emoji} ${row.name}`).join("\n")}\n\n0️⃣ Volver al menú principal\n\nEscribe una opción.`;
}

function categoriasActivas(scheduleId = turnoVigente()?.id) {
  if (!scheduleId) return [];
  return store.all(`SELECT DISTINCT c.* FROM categories c
    INNER JOIN category_schedules cs ON cs.category_id = c.id
    WHERE c.active = 1 AND cs.schedule_id = ? ORDER BY c.sort_order, c.name`, scheduleId);
}

function detalleCategoria(category) {
  const products = store.all("SELECT * FROM products WHERE category_id = ? AND active = 1 ORDER BY sort_order, name", category.id);
  const lines = products.length ? products.map((p) => `• *${p.name}* — S/ ${Number(p.price).toFixed(2)}${p.description ? `\n  ${p.description}` : ""}`).join("\n") : "Próximamente agregaremos los productos de esta categoría.";
  return `${category.emoji} *${category.name.toUpperCase()}*\n${category.description ? `\n${category.description}\n` : ""}\n${lines}\n\nEscribe *pedido* para realizar tu pedido.\nEscribe *0* para volver.`;
}

async function enviarTexto(chatId, text) {
  await axios.post(`${WAHA_URL}/api/sendText`, { session: WAHA_SESSION, chatId, text }, {
    headers: { "Content-Type": "application/json", "X-Api-Key": WAHA_API_KEY }, timeout: 15000
  });
}

async function marcarComoLeido(chatId, messageId) {
  try {
    await axios.post(`${WAHA_URL}/api/sendSeen`, { session: WAHA_SESSION, chatId, messageIds: messageId ? [messageId] : undefined }, { headers: { "Content-Type": "application/json", "X-Api-Key": WAHA_API_KEY } });
  } catch (error) { console.error("No se pudo marcar como leído:", error.response?.data || error.message); }
}

async function procesarMenuPrincipal(chatId, opcion) {
  const config = store.settings();
  if (opcion === "1") {
    const promo = promocionVigente();
    await enviarTexto(chatId, promo
      ? `🔥 *${promo.title.toUpperCase()}*\n\n${promo.description}${promo.price_text ? `\n\n💰 ${promo.price_text}` : ""}\n\nVálida de ${promo.start_time} a ${promo.end_time}.\nEscribe *pedido* para pedir.`
      : "ℹ️ En este momento no tenemos una promoción activa. Revisa nuevamente en el turno de desayunos (8 a 11 a. m.) o restobar (5 p. m. a medianoche).\n\nEscribe *menu* para volver.");
  } else if (opcion === "2") {
    sesiones.set(chatId, { estado: "esperando_pedido" });
    await enviarTexto(chatId, "🛒 *HAZ TU PEDIDO*\n\nIndícanos:\n• Producto y cantidad\n• Sabor o presentación\n• Dirección\n• Forma de pago\n\nUn asesor confirmará precio y disponibilidad.");
  } else if (opcion === "3") {
    const schedule = turnoVigente();
    sesiones.set(chatId, { estado: "categorias", scheduleId: schedule?.id || null });
    await enviarTexto(chatId, menuCategorias(schedule));
  } else if (opcion === "4") {
    await enviarTexto(chatId, `📍 *DIRECCIÓN*\n\n${config.business_name}\n${config.address}\n\n${config.address_reference}\n\nEscribe *menu* para volver.`);
  } else if (opcion === "5") {
    const schedules = store.all("SELECT * FROM schedules WHERE active = 1 ORDER BY sort_order, start_time");
    await enviarTexto(chatId, `🕐 *HORARIO DE ATENCIÓN*\n\nLunes a sábado\n\n${schedules.map((s) => `• *${s.name}:* ${s.start_time} a ${s.end_time === "00:00" ? "medianoche" : s.end_time}`).join("\n")}\n\nDomingo: cerrado.\n\nEscribe *menu* para volver.`);
  } else if (opcion === "6") {
    await enviarTexto(chatId, config.card_url ? `📖 *CARTA DIGITAL*\n\n${config.card_url}\n\nEscribe *menu* para volver.` : "📖 La carta digital está siendo actualizada. Puedes ver los productos en la opción 3 del menú.");
  } else if (opcion === "7") {
    sesiones.set(chatId, { estado: "asesor" });
    await enviarTexto(chatId, `👨‍💼 *ATENCIÓN DE UN ASESOR*\n\nEn breve continuará una persona de nuestro equipo.\n📲 ${config.phone}\n\nPara volver al bot, escribe *menu*.`);
  } else await enviarTexto(chatId, `No reconocí esa opción 😅\n\n${MENU_PRINCIPAL}`);
}

app.get("/", (_req, res) => res.json({ ok: true, service: "Terranova WhatsApp Bot", admin: "/admin" }));

function requireAdmin(req, res, next) {
  if (req.get("x-admin-password") !== ADMIN_PASSWORD) return res.status(401).json({ error: "Clave incorrecta" });
  next();
}
app.use("/api/admin", requireAdmin);
app.get("/api/admin/data", (_req, res) => {
  const categories = store.all("SELECT * FROM categories ORDER BY sort_order").map((category) => ({
    ...category,
    schedule_ids: store.all("SELECT schedule_id FROM category_schedules WHERE category_id = ? ORDER BY schedule_id", category.id).map((row) => row.schedule_id)
  }));
  res.json({ settings: store.settings(), schedules: store.all("SELECT * FROM schedules ORDER BY sort_order"), categories, products: store.all("SELECT * FROM products ORDER BY category_id, sort_order"), promotions: store.all("SELECT * FROM promotions ORDER BY priority DESC, id DESC") });
});
app.put("/api/admin/settings", (req, res) => { const stmt = store.db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"); Object.entries(req.body).forEach(([k,v]) => stmt.run(k, String(v ?? ""))); res.json({ ok: true }); });

const resources = {
  schedules: { table: "schedules", fields: ["name", "days", "start_time", "end_time", "sort_order", "active"] },
  categories: { table: "categories", fields: ["name", "emoji", "description", "sort_order", "active"] },
  products: { table: "products", fields: ["category_id", "name", "description", "price", "sort_order", "active"] },
  promotions: { table: "promotions", fields: ["title", "description", "price_text", "days", "specific_date", "start_time", "end_time", "priority", "active"] }
};
for (const [route, resource] of Object.entries(resources)) {
  app.post(`/api/admin/${route}`, (req, res) => {
    if (route === "categories" && (!Array.isArray(req.body.schedule_ids) || !req.body.schedule_ids.length)) return res.status(400).json({ error: "Selecciona al menos un turno" });
    const values = resource.fields.map((f) => req.body[f] ?? (f === "active" ? 1 : ""));
    const info = store.run(`INSERT INTO ${resource.table} (${resource.fields.join(",")}) VALUES (${resource.fields.map(() => "?").join(",")})`, ...values);
    if (route === "categories") syncCategorySchedules(Number(info.lastInsertRowid), req.body.schedule_ids);
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  });
  app.put(`/api/admin/${route}/:id`, (req, res) => {
    if (route === "categories" && Array.isArray(req.body.schedule_ids) && !req.body.schedule_ids.length) return res.status(400).json({ error: "Selecciona al menos un turno" });
    const fields = resource.fields.filter((f) => Object.hasOwn(req.body, f));
    if (!fields.length && !(route === "categories" && Array.isArray(req.body.schedule_ids))) return res.status(400).json({ error: "Sin cambios" });
    if (fields.length) store.run(`UPDATE ${resource.table} SET ${fields.map((f) => `${f}=?`).join(",")} WHERE id=?`, ...fields.map((f) => req.body[f]), req.params.id);
    if (route === "categories" && Array.isArray(req.body.schedule_ids)) syncCategorySchedules(req.params.id, req.body.schedule_ids);
    res.json({ ok: true });
  });
  app.delete(`/api/admin/${route}/:id`, (req, res) => { store.run(`DELETE FROM ${resource.table} WHERE id=?`, req.params.id); res.json({ ok: true }); });
}

function syncCategorySchedules(categoryId, scheduleIds = []) {
  const ids = [...new Set((Array.isArray(scheduleIds) ? scheduleIds : [scheduleIds]).map(Number).filter(Number.isInteger))];
  const insert = store.db.prepare("INSERT OR IGNORE INTO category_schedules (category_id, schedule_id) VALUES (?, ?)");
  store.db.exec("BEGIN");
  try {
    store.run("DELETE FROM category_schedules WHERE category_id = ?", categoryId);
    ids.forEach((scheduleId) => insert.run(categoryId, scheduleId));
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

app.post("/webhook/waha", async (req, res) => {
  res.sendStatus(200);
  try {
    const evento = req.body;
    if (evento.event !== "message") return;
    if (evento.session !== WAHA_SESSION) return;
    const payload = evento.payload || {};
    if (payload.fromMe === true) return;
    const chatId = payload.from || payload.chatId;
    try { alerts.record(evento, sesiones.get(chatId)?.estado); }
    catch (error) { console.error("[correo] No se pudo guardar alerta:", error.message); }
    const texto = normalizarTexto(payload.body);
    if (!chatId || !texto || chatId.endsWith("@g.us")) return;
    await marcarComoLeido(chatId, payload.id);
    if (["hola", "buenas", "menu", "inicio", "ayuda"].includes(texto)) { sesiones.set(chatId, { estado: "principal" }); await enviarTexto(chatId, MENU_PRINCIPAL); return; }
    if (["pedido", "pedir"].includes(texto)) { sesiones.set(chatId, { estado: "esperando_pedido" }); await enviarTexto(chatId, "🛒 Escribe producto, cantidad, dirección y forma de pago. Un asesor lo confirmará."); return; }
    const sesion = sesiones.get(chatId) || { estado: "principal" };
    if (sesion.estado === "asesor") return;
    if (sesion.estado === "esperando_pedido") { sesiones.set(chatId, { estado: "asesor", pedido: payload.body }); await enviarTexto(chatId, "✅ *¡Recibimos tu pedido!*\n\nUn asesor confirmará precio y disponibilidad. Para volver escribe *menu*."); console.log(`[NUEVO PEDIDO] ${chatId}: ${payload.body}`); return; }
    if (sesion.estado === "categorias") {
      if (texto === "0") { sesiones.set(chatId, { estado: "principal" }); await enviarTexto(chatId, MENU_PRINCIPAL); return; }
      const schedule = turnoVigente();
      if ((schedule?.id || null) !== sesion.scheduleId) {
        sesiones.set(chatId, { estado: "categorias", scheduleId: schedule?.id || null });
        await enviarTexto(chatId, `⏰ El turno de atención cambió. Te mostramos las categorías disponibles en este momento.\n\n${menuCategorias(schedule)}`);
        return;
      }
      const category = categoriasActivas(schedule?.id)[Number(texto) - 1];
      if (category) { sesiones.set(chatId, { estado: "detalle_categoria", categoryId: category.id }); await enviarTexto(chatId, detalleCategoria(category)); return; }
      await enviarTexto(chatId, `Selecciona una opción válida.\n\n${menuCategorias()}`); return;
    }
    if (sesion.estado === "detalle_categoria" && texto === "0") { const schedule = turnoVigente(); sesiones.set(chatId, { estado: "categorias", scheduleId: schedule?.id || null }); await enviarTexto(chatId, menuCategorias(schedule)); return; }
    if (/^[1-7]$/.test(texto)) { sesiones.set(chatId, { estado: "principal" }); await procesarMenuPrincipal(chatId, texto); return; }
    await enviarTexto(chatId, MENU_PRINCIPAL);
  } catch (error) { console.error("Error procesando webhook:", error.response?.data || error.message); }
});

app.listen(PORT, () => { console.log(`Bot Terranova ejecutándose en http://localhost:${PORT}`); console.log(`Panel: http://localhost:${PORT}/admin`); });
