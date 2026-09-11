const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'app.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    chat_title TEXT,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    message_count INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    import_id TEXT,
    source TEXT NOT NULL DEFAULT 'export',
    customer_name TEXT,
    customer_message TEXT,
    order_at TEXT NOT NULL,
    responder_name TEXT,
    response_message TEXT,
    responded_at TEXT,
    response_seconds REAL,
    response_ms INTEGER,
    timing_precision TEXT DEFAULT 's',
    operator_id TEXT,
    network_type TEXT,
    effective_type TEXT,
    downlink REAL,
    rtt INTEGER,
    save_data INTEGER DEFAULT 0,
    signal_captured_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    chat_title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (import_id) REFERENCES imports(id),
    FOREIGN KEY (operator_id) REFERENCES operators(id)
  );

  CREATE TABLE IF NOT EXISTS wa_events (
    id TEXT PRIMARY KEY,
    wa_message_id TEXT,
    direction TEXT NOT NULL,
    from_number TEXT,
    to_number TEXT,
    body TEXT,
    timestamp TEXT NOT NULL,
    order_id TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

try {
  db.exec('ALTER TABLE orders ADD COLUMN response_ms INTEGER');
} catch {
  /* already exists */
}
try {
  db.exec("ALTER TABLE orders ADD COLUMN timing_precision TEXT DEFAULT 's'");
} catch {
  /* already exists */
}

const defaultOps = ['Operador 1', 'Operador 2', 'Operador 3'];
const insertOp = db.prepare(
  'INSERT OR IGNORE INTO operators (id, name) VALUES (?, ?)'
);
for (const name of defaultOps) {
  insertOp.run(randomUUID(), name);
}

module.exports = db;
