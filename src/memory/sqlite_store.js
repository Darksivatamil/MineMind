// SQLite storage for AGNES memory. Uses Node built-in node:sqlite (no npm install needed).
// One file: data/agnes_memory.db with 3 tables: memories, chats, summaries.
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.warn('[SQLite] node:sqlite not available:', e.message);
}

class SqliteStore {
  constructor(dbPath) {
    this.available = !!DatabaseSync;
    this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', 'agnes_memory.db');
    this.db = null;
    if (!this.available) return;
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.db = new DatabaseSync(this.dbPath);
      this._initTables();
    } catch (e) {
      console.error('[SQLite] open failed, falling back to memory:', e.message);
      this.available = false;
      this.db = null;
    }
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer TEXT NOT NULL DEFAULT 'short',
        category TEXT NOT NULL DEFAULT 'general',
        content TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        strength REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_time ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        response TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chats_user_time ON chats(username, created_at DESC);

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    // Prepared statements (fast, safe from SQL injection)
    this.stmtAddMemory = this.db.prepare(
      `INSERT INTO memories (layer, category, content, importance, strength, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtAddChat = this.db.prepare(
      `INSERT INTO chats (username, message, response, created_at) VALUES (?, ?, ?, ?)`
    );
    this.stmtAddSummary = this.db.prepare(
      `INSERT INTO summaries (content, created_at) VALUES (?, ?)`
    );
  }

  addMemory(layer, category, content, importance, strength, timestamp) {
    if (!this.available) return null;
    const r = this.stmtAddMemory.run(layer, category, content, importance, strength, timestamp);
    if (r && typeof r.lastInsertRowid === 'number') return Number(r.lastInsertRowid);
    const row = this.db.prepare('SELECT last_insert_rowid() AS id').get();
    return row ? row.id : null;
  }

  updateMemoryLayer(id, layer) {
    if (!this.available) return;
    this.db.prepare('UPDATE memories SET layer = ? WHERE id = ?').run(layer, id);
  }

  updateMemoryStrength(id, strength) {
    if (!this.available) return;
    this.db.prepare('UPDATE memories SET strength = ? WHERE id = ?').run(strength, id);
  }

  deleteMemory(id) {
    if (!this.available) return;
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  countByLayer(layer) {
    if (!this.available) return 0;
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM memories WHERE layer = ?').get(layer);
    return row ? row.c : 0;
  }

  // Delete oldest rows over the cap. Fast: single DELETE, no array shift().
  trimLayer(layer, maxKeep) {
    if (!this.available) return;
    this.db.prepare(`
      DELETE FROM memories WHERE id IN (
        SELECT id FROM memories WHERE layer = ?
        ORDER BY importance DESC, strength DESC, created_at DESC
        LIMIT -1 OFFSET ?
      )`).run(layer, maxKeep);
  }

  getRecent(count) {
    if (!this.available) return null;
    return this.db.prepare(
      `SELECT id, layer, category, content, importance, strength, created_at AS timestamp
       FROM memories ORDER BY created_at DESC LIMIT ?`
    ).all(count);
  }

  // Promotion candidates: no full-table scan in JS, DB filters.
  getPromotionCandidates(fromLayer, minImportance, minStrength, limit) {
    if (!this.available) return null;
    return this.db.prepare(
      `SELECT id, layer, category, content, importance, strength, created_at AS timestamp
       FROM memories WHERE layer = ? AND importance > ? AND strength > ?
       ORDER BY importance DESC LIMIT ?`
    ).all(fromLayer, minImportance, minStrength, limit || 50);
  }

  // Decay + prune in 2 SQL statements (was O(n) loop over arrays).
  decayAndPrune(now, minStrength, minImportance) {
    if (!this.available) return;
    // strength -= (age_hours/24)*0.1  -> computed in SQL, clamped at 0
    this.db.prepare(`
      UPDATE memories SET strength = MAX(0, strength - (MIN(1, (? - created_at) / 3600000.0 / 24.0) * 0.1))
      WHERE layer IN ('short','medium','long')
    `).run(now);
    // delete weak + unimportant
    this.db.prepare(
      `DELETE FROM memories WHERE strength < ? AND importance < ?`
    ).run(minStrength, minImportance);
  }

  searchMemories(query, limit) {
    if (!this.available) return null;
    return this.db.prepare(
      `SELECT id, layer, category, content, importance, strength, created_at AS timestamp
       FROM memories WHERE content LIKE ? ESCAPE '\\'
       ORDER BY strength DESC, importance DESC LIMIT ?`
    ).all(`%${String(query).replace(/[%_\\]/g, '\\$&')}%`, limit);
  }

  addChat(username, message, response, timestamp) {
    if (!this.available) return null;
    const r = this.stmtAddChat.run(username, message, response || null, timestamp);
    if (r && typeof r.lastInsertRowid === 'number') return Number(r.lastInsertRowid);
    const row = this.db.prepare('SELECT last_insert_rowid() AS id').get();
    return row ? row.id : null;
  }

  updateChatResponse(id, response) {
    if (!this.available) return;
    this.db.prepare('UPDATE chats SET response = ? WHERE id = ?').run(response, id);
  }

  getChats(username, count) {
    if (!this.available) return null;
    return this.db.prepare(
      `SELECT id, username, message, response, created_at AS timestamp
       FROM chats WHERE username = ? ORDER BY created_at DESC LIMIT ?`
    ).all(username, count);
  }

  getAllChats(username) {
    if (!this.available) return null;
    return this.db.prepare(
      `SELECT id, username, message, response, created_at AS timestamp
       FROM chats WHERE username = ? ORDER BY created_at ASC LIMIT 1000`
    ).all(username);
  }

  countChats() {
    if (!this.available) return 0;
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM chats').get();
    return row ? row.c : 0;
  }

  // Keep newest maxKeep chats, summarize the removed ones in JS.
  popOldChats(maxKeep) {
    if (!this.available) return [];
    const over = this.db.prepare('SELECT COUNT(*) AS c FROM chats').get().c - maxKeep;
    if (over <= 0) return [];
    const old = this.db.prepare(
      `SELECT id, username, message, response, created_at AS timestamp
       FROM chats ORDER BY created_at ASC LIMIT ?`
    ).all(over);
    const ids = old.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM chats WHERE id IN (${placeholders})`).run(...ids);
    return old;
  }

  addSummary(content, timestamp) {
    if (!this.available) return;
    this.stmtAddSummary.run(content, timestamp);
    // keep only 10 newest summaries
    this.db.prepare(`
      DELETE FROM summaries WHERE id IN (
        SELECT id FROM summaries ORDER BY created_at DESC LIMIT -1 OFFSET 10
      )`).run();
  }

  getSummaries(count) {
    if (!this.available) return null;
    return this.db.prepare(
      `SELECT content, created_at AS timestamp FROM summaries ORDER BY created_at DESC LIMIT ?`
    ).all(count);
  }

  countSummaries() {
    if (!this.available) return 0;
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM summaries').get();
    return row ? row.c : 0;
  }

  countMemories() {
    if (!this.available) return 0;
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM memories').get();
    return row ? row.c : 0;
  }

  close() {
    try { if (this.db) this.db.close(); } catch (e) {}
  }
}

module.exports = { SqliteStore };
