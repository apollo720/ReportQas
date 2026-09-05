/**
 * 认证与权限 —— 工号+密码登录（scrypt 哈希）、SQLite 会话表 + HttpOnly Cookie、
 * 权限中间件。客户经理角色本期 can_login=0，不开放登录。
 */
'use strict';

const crypto = require('crypto');
const { all, get, run, now } = require('./db');
const { MENUS } = require('./constants');

const SESSION_MS = 60 * 60 * 1000; /* 会话有效期 1 小时 */
const COOKIE_NAME = 'lrsid';
const COOKIE_SECURE = process.env.LR_COOKIE_SECURE === '1'; /* HTTPS 部署时开启 */
const LOGIN_FAIL_LIMIT = 5;   /* 同一 工号+IP 连续失败上限 */
const LOGIN_LOCK_MS = 15 * 60 * 1000;

/* 登录失败锁定（内存实现，重启即清）：同 工号+IP 连续失败 LOGIN_FAIL_LIMIT 次后临时锁定 */
const loginFails = new Map();
function loginLocked(key) {
  const rec = loginFails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.last >= LOGIN_LOCK_MS) { loginFails.delete(key); return false; }
  return rec.count >= LOGIN_FAIL_LIMIT;
}
function recordLoginFail(key) {
  const rec = loginFails.get(key) || { count: 0, last: 0 };
  rec.count += 1; rec.last = Date.now();
  loginFails.set(key, rec);
}
function clearLoginFails(key) { loginFails.delete(key); }

/* ---------- 密码 ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 32);
  const expect = Buffer.from(expected, 'hex');
  return actual.length === expect.length && crypto.timingSafeEqual(actual, expect);
}

/* ---------- 会话 ---------- */
function createSession(res, employeeId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_MS);
  run('INSERT INTO sessions (token, employee_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    token, employeeId, now(), expires.toISOString());
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${COOKIE_SECURE ? '; Secure' : ''}`);
}

function destroySession(req, res) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/* 用户上下文：会话 → 员工 + 角色 + 权限 + 可见菜单 */
function resolveUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  /* created_at 下限同时拦截旧版本签发的长有效期会话 */
  const createdAfter = new Date(Date.now() - SESSION_MS).toISOString();
  const sess = get('SELECT * FROM sessions WHERE token = ? AND expires_at >= ? AND created_at >= ?',
    token, now(), createdAfter);
  if (!sess) return null;
  const emp = get('SELECT * FROM employees WHERE id = ?', sess.employee_id);
  if (!emp || emp.status !== '在职' || !emp.can_login) return null;
  return buildUser(emp);
}

function buildUser(emp) {
  const roles = all(
    `SELECT r.key, r.name FROM employee_roles er JOIN roles r ON r.key = er.role_key
     WHERE er.employee_id = ? ORDER BY r.key`, emp.id);
  const perms = new Set();
  for (const r of roles) {
    for (const p of JSON.parse(get('SELECT perms FROM roles WHERE key = ?', r.key).perms || '[]')) {
      perms.add(p);
    }
  }
  const org = emp.org_id ? get('SELECT name FROM orgs WHERE id = ?', emp.org_id) : null;
  return {
    id: emp.id, no: emp.no, name: emp.name, orgId: emp.org_id,
    orgName: org ? org.name : '', post: emp.post || '',
    roles: roles.map((r) => ({ key: r.key, name: r.name })),
    perms: [...perms],
    menus: filterMenus(perms)
  };
}

function filterMenus(perms) {
  const out = [];
  for (const m of MENUS) {
    if (m.children) {
      const kids = m.children.filter((c) => !c.perm || perms.has(c.perm));
      if (kids.length) out.push({ ...m, children: kids });
    } else if (!m.perm || perms.has(m.perm)) {
      out.push(m);
    }
  }
  return out;
}

/* ---------- 中间件 ---------- */
function requireAuth(req, res, next) {
  const user = resolveUser(req);
  if (!user) {
    res.clearCookie ? res.clearCookie(COOKIE_NAME) : null;
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  req.user = user;
  next();
}

function requirePerm(...needed) {
  return (req, res, next) => {
    const held = new Set(req.user.perms);
    const ok = needed.some((p) => held.has(p));
    if (!ok) return res.status(403).json({ error: '没有执行该操作的权限' });
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  resolveUser, buildUser, requireAuth, requirePerm, COOKIE_NAME,
  loginLocked, recordLoginFail, clearLoginFails
};
