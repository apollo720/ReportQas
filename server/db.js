/**
 * 数据库层 —— SQLite（Node 内置 node:sqlite，无原生编译依赖）
 * 库文件默认 data/app.db，可用环境变量 LR_DB 覆盖（Docker 中挂卷持久化）。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.LR_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.LR_DB || path.join(DATA_DIR, 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  parent      TEXT,
  status      TEXT DEFAULT '启用',
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  descr       TEXT,
  perms       TEXT NOT NULL DEFAULT '[]',
  builtin     INTEGER DEFAULT 0,
  created_at  TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  no            TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  org_id        TEXT,
  post          TEXT,
  status        TEXT DEFAULT '在职',
  can_login     INTEGER DEFAULT 1,
  password_hash TEXT,
  salt          TEXT,
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS employee_roles (
  employee_id TEXT NOT NULL,
  role_key    TEXT NOT NULL,
  PRIMARY KEY (employee_id, role_key)
);

CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  no            TEXT UNIQUE,
  name          TEXT NOT NULL,
  industry      TEXT,
  scale         TEXT,
  status        TEXT DEFAULT '存量',
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL,
  report_date            TEXT NOT NULL,
  customer_id            TEXT NOT NULL,
  approved               TEXT DEFAULT '否',
  amount                 REAL DEFAULT 0,
  main_investigator      TEXT,
  assistant_investigator TEXT,
  first_responsible      TEXT,
  reviewer               TEXT,
  score_sys              TEXT,
  score_credit           TEXT,
  score_asset            TEXT,
  score_operate          TEXT,
  score_purpose          TEXT,
  score_guarantee        TEXT,
  return1                TEXT,
  return2                TEXT,
  return3                TEXT,
  return4                TEXT,
  review                 TEXT,
  review_comment         TEXT,
  review_by              TEXT,
  status                 TEXT DEFAULT 'draft',
  submit_time            TEXT,
  review_time            TEXT,
  archive_time           TEXT,
  return_note            TEXT,
  created_by             TEXT,
  created_at             TEXT,
  updated_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  created_at  TEXT,
  expires_at  TEXT
);

CREATE TABLE IF NOT EXISTS op_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id     TEXT,
  employee_id   TEXT,
  employee_name TEXT,
  action        TEXT,
  detail        TEXT,
  created_at    TEXT
);
`;

db.exec(SCHEMA);

/* 存量库迁移：废弃列启动时删除（客户表三列、机构表两列、员工表电话列） */
for (const [table, cols] of [
  ['customers', ['org_id', 'owner_id', 'credit_rating']],
  ['orgs', ['manager', 'staff']],
  ['employees', ['phone']]
]) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const col of cols) {
    if (existing.has(col)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
  }
}

/* 清理过期会话（启动时执行一次即可，量小） */
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());

const now = () => new Date().toISOString();

/* 通用小工具 */
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

/* 编号生成：前缀 + 年份 + 4 位流水（台账用，如 BG-2026-0825） */
function nextId(table, prefix) {
  const year = new Date().getFullYear();
  const head = `${prefix}-${year}-`;
  const row = get(
    `SELECT id FROM ${table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1`,
    head + '%'
  );
  const seq = row ? parseInt(row.id.slice(head.length), 10) + 1 : 1;
  return head + String(seq).padStart(4, '0');
}

/* 编号生成：前缀 + 定长流水（主数据用，如 ORG008 / E2011 / C013） */
function nextPlainId(table, prefix, pad = 3) {
  const row = get(
    `SELECT id FROM ${table} WHERE id LIKE ? ORDER BY LENGTH(id) DESC, id DESC LIMIT 1`,
    prefix + '%'
  );
  const seq = row ? parseInt(row.id.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(seq).padStart(pad, '0');
}

module.exports = { db, all, get, run, now, nextId, nextPlainId, DB_PATH };
