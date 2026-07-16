const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "terranova.db"));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🍽️',
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_text TEXT NOT NULL DEFAULT '',
    days TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
    specific_date TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
`);

// Migración para instalaciones creadas antes de asignar categorías por turno.
if (!db.prepare("PRAGMA table_info(categories)").all().some((column) => column.name === "schedule_id")) {
  db.exec("ALTER TABLE categories ADD COLUMN schedule_id INTEGER REFERENCES schedules(id)");
}
const categorySchedulesExisted = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'category_schedules'").get());
db.exec(`
  CREATE TABLE IF NOT EXISTS category_schedules (
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    PRIMARY KEY (category_id, schedule_id)
  )
`);

function seed() {
  const defaults = {
    business_name: "Terranova Restobar",
    address: "Jr. Manuel Gonzales Prada 814, Los Olivos",
    address_reference: "A dos cuadras de la Municipalidad de Los Olivos, al costado del colegio Pitágoras.",
    phone: "+51 947 406 173",
    card_url: process.env.CARTA_URL || ""
  };
  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  Object.entries(defaults).forEach(([key, value]) => insertSetting.run(key, value));

  if (db.prepare("SELECT COUNT(*) total FROM schedules").get().total === 0) {
    const add = db.prepare("INSERT INTO schedules (name, days, start_time, end_time, sort_order) VALUES (?, '1,2,3,4,5,6', ?, ?, ?)");
    add.run("Turno desayunos", "08:00", "11:00", 1);
    add.run("Turno menú", "12:00", "16:00", 2);
    add.run("Turno restobar", "17:00", "00:00", 3);
  }

  if (db.prepare("SELECT COUNT(*) total FROM categories").get().total === 0) {
    const add = db.prepare("INSERT INTO categories (name, emoji, sort_order) VALUES (?, ?, ?)");
    [["Alitas", "🍗"], ["Hamburguesas", "🍔"], ["Salchipapas", "🍟"], ["Piqueos", "🧀"], ["Waffles y crepes", "🧇"], ["Bebidas", "🥤"]]
      .forEach(([name, emoji], index) => add.run(name, emoji, index + 1));
  }

  if (db.prepare("SELECT COUNT(*) total FROM promotions").get().total === 0) {
    const add = db.prepare("INSERT INTO promotions (title, description, days, start_time, end_time, priority) VALUES (?, ?, '1,2,3,4,5,6', ?, ?, ?)");
    add.run("Promoción de desayunos", "Consulta el desayuno promocional disponible hoy.", "08:00", "11:00", 10);
    add.run("Promoción de restobar", "Consulta la promoción nocturna disponible hoy.", "17:00", "00:00", 10);
  }

  if (!categorySchedulesExisted) {
    const restobar = db.prepare("SELECT id FROM schedules WHERE lower(name) LIKE '%restobar%' ORDER BY sort_order LIMIT 1").get();
    if (restobar) db.prepare("UPDATE categories SET schedule_id = ? WHERE schedule_id IS NULL").run(restobar.id);
    db.exec("INSERT OR IGNORE INTO category_schedules (category_id, schedule_id) SELECT id, schedule_id FROM categories WHERE schedule_id IS NOT NULL");
  }
}
seed();

function all(sql, ...params) { return db.prepare(sql).all(...params); }
function get(sql, ...params) { return db.prepare(sql).get(...params); }
function run(sql, ...params) { return db.prepare(sql).run(...params); }
function settings() { return Object.fromEntries(all("SELECT key, value FROM settings").map((row) => [row.key, row.value])); }

module.exports = { db, all, get, run, settings };
