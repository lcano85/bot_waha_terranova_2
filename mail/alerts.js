const { sendMail } = require('./php-mailer');

function createAlerts(db, { send = sendMail, now = Date.now, enabled = process.env.EMAIL_ALERTS_ENABLED === 'true', logger = console } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_contacts (chat_id TEXT PRIMARY KEY, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mail_events (event_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mail_queue (
      id INTEGER PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  let busy = false;
  function record(event, state) {
    if (!enabled || event?.event !== 'message' || event.session !== 'negocio_cz') return false;
    const p = event.payload || {};
    const chat = p.from || p.chatId;
    if (p.fromMe || typeof chat !== 'string' || !/@(?:c\.us|s\.whatsapp\.net|lid)$/.test(chat)) return false;
    const text = String(p.body ?? '').trim();
    const command = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const time = now();
    const eventId = typeof p.id === 'string' ? p.id : event.id;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (eventId && !db.prepare('INSERT OR IGNORE INTO mail_events VALUES (?, ?)').run(eventId, time).changes) {
        db.exec('COMMIT');
        return false;
      }
      const previous = db.prepare('SELECT last_seen FROM mail_contacts WHERE chat_id = ?').get(chat);
      const greetings = ['hola', 'buenas', 'menu', 'inicio', 'ayuda'];
      const orderCommand = ['pedido', 'pedir'].includes(command);
      const mainMenu = !state || state === 'principal';
      let reason = null;
      if (mainMenu && command === '7') reason = 'Cliente solicita asesor';
      else if (orderCommand || (mainMenu && command === '2')) reason = 'Cliente inicia un pedido';
      else if (state === 'esperando_pedido' && text && !greetings.includes(command)) reason = 'Nuevo pedido recibido';
      else if (!previous || time - previous.last_seen >= 30 * 60 * 1000) reason = 'Nuevo contacto por WhatsApp';
      db.prepare('INSERT INTO mail_contacts VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET last_seen = excluded.last_seen').run(chat, time);
      if (reason) {
        const phone = /^(\d+)@(?:c\.us|s\.whatsapp\.net)$/.exec(chat)?.[1];
        const name = String(p.notifyName || p.pushName || 'No disponible').slice(0, 200);
        const date = new Date(time).toLocaleString('es-PE', { timeZone: 'America/Lima' });
        const body = `${reason}\n\nBot: negocio_cz\nCliente: ${name}\n${phone ? `Numero: +${phone}\nAbrir chat: https://wa.me/${phone}` : `Identificador WhatsApp: ${chat} (no es un numero telefonico)`}\nHora de Peru: ${date}\n\nMensaje:\n${text.slice(0, 6000) || '[Mensaje sin texto: imagen, audio u otro contenido]'}\n\nRevisa WhatsApp para continuar la atencion.`;
        db.prepare('INSERT INTO mail_queue (subject, body, next_attempt, created_at) VALUES (?, ?, ?, ?)').run(`Terranova — ${reason}`, body, time, time);
      }
      // Retain deduplication IDs for seven days; discard sent message content after seven days.
      db.prepare('DELETE FROM mail_events WHERE created_at < ?').run(time - 7 * 86400000);
      db.prepare("DELETE FROM mail_queue WHERE status = 'sent' AND created_at < ?").run(time - 7 * 86400000);
      db.exec('COMMIT');
      return Boolean(reason);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function flush() {
    if (!enabled || busy) return;
    busy = true;
    try {
      const jobs = db.prepare("SELECT * FROM mail_queue WHERE status = 'pending' AND next_attempt <= ? ORDER BY id LIMIT 10").all(now());
      for (const job of jobs) {
        try {
          await send({ subject: job.subject, body: job.body });
          db.prepare("UPDATE mail_queue SET status = 'sent', attempts = attempts + 1 WHERE id = ?").run(job.id);
          logger.log(`[correo] Alerta ${job.id} aceptada por SMTP`);
        } catch (error) {
          const attempts = job.attempts + 1;
          db.prepare('UPDATE mail_queue SET attempts = ?, next_attempt = ?, status = ? WHERE id = ?').run(
            attempts, now() + Math.min(3600000, 60000 * 2 ** (attempts - 1)), attempts >= 8 ? 'failed' : 'pending', job.id
          );
          logger.error(`[correo] Alerta ${job.id}: intento ${attempts}/8 fallido; ${error.message}`);
        }
      }
    } finally { busy = false; }
  }
  function start() {
    if (!enabled) return;
    if (!process.env.SMTP_PASSWORD) logger.warn('[correo] Falta SMTP_PASSWORD: las alertas se guardaran pendientes sin enviarlas.');
    const tick = () => { if (process.env.SMTP_PASSWORD) flush().catch(error => logger.error('[correo] Error de cola:', error.message)); };
    const timer = setInterval(tick, 10000);
    timer.unref();
    tick();
    return timer;
  }
  return { record, flush, start };
}

module.exports = { createAlerts };
