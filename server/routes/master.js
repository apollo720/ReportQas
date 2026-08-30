/**
 * 主数据 CRUD —— 机构 / 员工（用户）/ 角色与权限 / 客户
 * 全部要求 admin 类权限；员工支持分配角色、重置密码、启停用与登录开关。
 */
'use strict';

const express = require('express');
const { all, get, run, now, nextPlainId, nextDailyId } = require('../db');
const { hashPassword, requireAuth, requirePerm } = require('../auth');
const { ROLE_PRESETS } = require('../constants');
const { invalidateDicts } = require('../report-util');

const router = express.Router();
router.use(requireAuth);

const trim = (v) => String(v == null ? '' : v).trim();

/* ---------------- 机构 ---------------- */
router.get('/orgs', requirePerm('org:manage'), (req, res) => {
  res.json({
    items: all(`
      SELECT o.*, (SELECT COUNT(*) FROM employees e WHERE e.org_id = o.id) AS employeeCount
      FROM orgs o ORDER BY o.code`)
  });
});

router.post('/orgs', requirePerm('org:manage'), (req, res) => {
  const { code, name, parent, status } = req.body || {};
  if (!trim(code) || !trim(name)) return res.status(400).json({ error: '机构编码与名称必填' });
  if (get('SELECT id FROM orgs WHERE code = ?', trim(code))) {
    return res.status(400).json({ error: '机构编码已存在' });
  }
  const id = nextPlainId('orgs', 'ORG', 3);
  run('INSERT INTO orgs (id, code, name, parent, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, trim(code), trim(name), trim(parent) || null, status === '停用' ? '停用' : '启用', now());
  invalidateDicts();
  res.json({ id });
});

router.put('/orgs/:id', requirePerm('org:manage'), (req, res) => {
  const org = get('SELECT * FROM orgs WHERE id = ?', req.params.id);
  if (!org) return res.status(404).json({ error: '机构不存在' });
  const { code, name, parent, status } = req.body || {};
  if (trim(code) && code !== org.code && get('SELECT id FROM orgs WHERE code = ?', trim(code))) {
    return res.status(400).json({ error: '机构编码已存在' });
  }
  run('UPDATE orgs SET code = ?, name = ?, parent = ?, status = ? WHERE id = ?',
    trim(code) || org.code, trim(name) || org.name,
    trim(parent) || null,
    status === undefined ? org.status : (status === '停用' ? '停用' : '启用'),
    org.id);
  invalidateDicts();
  res.json({ ok: true });
});

router.delete('/orgs/:id', requirePerm('org:manage'), (req, res) => {
  const org = get('SELECT * FROM orgs WHERE id = ?', req.params.id);
  if (!org) return res.status(404).json({ error: '机构不存在' });
  const empCount = get('SELECT COUNT(*) AS n FROM employees WHERE org_id = ?', org.id).n;
  if (empCount > 0) {
    return res.status(400).json({ error: `该机构下有 ${empCount} 名员工，请先调整其所属机构后再删除` });
  }
  const reportCount = get('SELECT COUNT(*) AS n FROM reports WHERE org_id = ?', org.id).n;
  if (reportCount > 0) {
    return res.status(400).json({ error: `该机构关联 ${reportCount} 笔评价台账（作为经办机构），不可删除` });
  }
  run('DELETE FROM orgs WHERE id = ?', org.id);
  invalidateDicts();
  res.json({ ok: true });
});

/* ---------------- 员工（用户） ---------------- */
router.get('/employees', requirePerm('employee:manage'), (req, res) => {
  const items = all(`
    SELECT e.*, o.name AS orgName,
      (SELECT GROUP_CONCAT(r.name, '、') FROM employee_roles er JOIN roles r ON r.key = er.role_key
       WHERE er.employee_id = e.id) AS roleNames,
      (SELECT GROUP_CONCAT(er.role_key, ',') FROM employee_roles er
       WHERE er.employee_id = e.id) AS roleKeysStr
    FROM employees e LEFT JOIN orgs o ON o.id = e.org_id
    ORDER BY e.no`).map((e) => {
    const { password_hash, salt, roleKeysStr, ...rest } = e;
    rest.roleKeys = roleKeysStr ? roleKeysStr.split(',') : [];
    return rest;
  });
  res.json({ items });
});

router.post('/employees', requirePerm('employee:manage'), (req, res) => {
  const { no, name, orgId, post, roleKeys, password, canLogin } = req.body || {};
  if (!trim(no) || !trim(name)) return res.status(400).json({ error: '工号与姓名必填' });
  if (get('SELECT id FROM employees WHERE no = ?', trim(no))) {
    return res.status(400).json({ error: '工号已存在' });
  }
  const roles = Array.isArray(roleKeys) ? roleKeys : [];
  if (!roles.length) return res.status(400).json({ error: '请至少分配一个角色' });
  for (const r of roles) {
    if (!get('SELECT key FROM roles WHERE key = ?', r)) return res.status(400).json({ error: '角色不存在：' + r });
  }
  const id = nextPlainId('employees', 'E', 4);
  const pwd = String(password || '123456');
  const { salt, hash } = hashPassword(pwd);
  run(`INSERT INTO employees (id, no, name, org_id, post, status, can_login, password_hash, salt, created_at)
       VALUES (?, ?, ?, ?, ?, '在职', ?, ?, ?, ?)`,
    id, trim(no), trim(name), trim(orgId) || null, trim(post) || null,
    canLogin === 0 ? 0 : 1, hash, salt, now());
  for (const r of roles) run('INSERT INTO employee_roles (employee_id, role_key) VALUES (?, ?)', id, r);
  invalidateDicts();
  res.json({ id });
});

router.put('/employees/:id', requirePerm('employee:manage'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  if (emp.no === 'admin') return res.status(403).json({ error: '内置超级管理员账号不可编辑' });
  const { name, orgId, post, status, canLogin, roleKeys } = req.body || {};
  const roles = roleKeys === undefined ? null : (Array.isArray(roleKeys) ? roleKeys : []);
  if (roles && !roles.length && emp.id === req.user.id) {
    return res.status(400).json({ error: '不能移除自己的全部角色' });
  }
  run('UPDATE employees SET name = ?, org_id = ?, post = ?, status = ?, can_login = ? WHERE id = ?',
    trim(name) || emp.name,
    orgId === undefined ? emp.org_id : (trim(orgId) || null),
    post === undefined ? emp.post : trim(post) || null,
    status === undefined ? emp.status : (status === '离职' ? '离职' : '在职'),
    canLogin === undefined ? emp.can_login : (canLogin ? 1 : 0),
    emp.id);
  if (roles) {
    run('DELETE FROM employee_roles WHERE employee_id = ?', emp.id);
    for (const r of roles) {
      if (get('SELECT key FROM roles WHERE key = ?', r)) {
        run('INSERT INTO employee_roles (employee_id, role_key) VALUES (?, ?)', emp.id, r);
      }
    }
  }
  invalidateDicts();
  res.json({ ok: true });
});

router.post('/employees/:id/reset-password', requirePerm('employee:manage'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  if (emp.no === 'admin') return res.status(403).json({ error: '内置超级管理员账号不可重置密码' });
  const pwd = String((req.body || {}).password || '123456');
  const { salt, hash } = hashPassword(pwd);
  run('UPDATE employees SET password_hash = ?, salt = ? WHERE id = ?', hash, salt, emp.id);
  res.json({ ok: true });
});

router.delete('/employees/:id', requirePerm('employee:manage'), (req, res) => {
  const emp = get('SELECT * FROM employees WHERE id = ?', req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  if (emp.no === 'admin') return res.status(403).json({ error: '内置超级管理员账号不可删除' });
  if (emp.id === req.user.id) return res.status(400).json({ error: '不能删除当前登录账号' });
  const reportCount = get(`SELECT COUNT(*) AS n FROM reports
    WHERE main_investigator = ? OR assistant_investigator = ? OR first_responsible = ?
       OR reviewer = ? OR created_by = ?`, emp.id, emp.id, emp.id, emp.id, emp.id).n;
  if (reportCount > 0) {
    return res.status(400).json({ error: `该员工关联 ${reportCount} 笔评价台账（调查人 / 审批人 / 登记人），不可删除` });
  }
  run('DELETE FROM employee_roles WHERE employee_id = ?', emp.id);
  run('DELETE FROM sessions WHERE employee_id = ?', emp.id);
  run('DELETE FROM employees WHERE id = ?', emp.id);
  invalidateDicts();
  res.json({ ok: true });
});

/* ---------------- 角色与权限 ---------------- */
router.get('/roles', requirePerm('role:manage'), (req, res) => {
  res.json({
    items: all('SELECT * FROM roles ORDER BY builtin DESC, key').map((r) => ({
      ...r, perms: JSON.parse(r.perms), userCount: get(
        'SELECT COUNT(*) AS n FROM employee_roles WHERE role_key = ?', r.key).n
    }))
  });
});

router.put('/roles/:key/perms', requirePerm('role:manage'), (req, res) => {
  if (req.params.key === 'admin') {
    return res.status(403).json({ error: '超级管理员角色固定拥有全部权限，不可修改' });
  }
  const role = get('SELECT * FROM roles WHERE key = ?', req.params.key);
  if (!role) return res.status(404).json({ error: '角色不存在' });
  const perms = Array.isArray((req.body || {}).perms) ? req.body.perms : [];
  run('UPDATE roles SET perms = ? WHERE key = ?', JSON.stringify([...new Set(perms)]), role.key);
  res.json({ ok: true });
});

router.put('/roles/:key', requirePerm('role:manage'), (req, res) => {
  const role = get('SELECT * FROM roles WHERE key = ?', req.params.key);
  if (!role) return res.status(404).json({ error: '角色不存在' });
  const { name, descr } = req.body || {};
  run('UPDATE roles SET name = ?, descr = ? WHERE key = ?',
    trim(name) || role.name, descr === undefined ? role.descr : trim(descr), role.key);
  res.json({ ok: true });
});

/* ---------------- 客户 ---------------- */
router.get('/customers', requireAuth, (req, res) => {
  const { keyword } = req.query;
  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM reports r WHERE r.customer_id = c.id) AS reportCount
    FROM customers c
    WHERE 1 = 1`;
  const params = [];
  if (keyword) {
    sql += ' AND (c.name LIKE ? OR c.no LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  sql += ' ORDER BY c.no';
  res.json({ items: all(sql, ...params) });
});

router.post('/customers', requirePerm('customer:manage'), (req, res) => {
  const { name, industry, scale } = req.body || {};
  if (!trim(name)) return res.status(400).json({ error: '客户名称必填' });
  if (get('SELECT id FROM customers WHERE name = ?', trim(name))) {
    return res.status(400).json({ error: '客户名称已存在' });
  }
  const id = nextPlainId('customers', 'C', 3);
  const no = nextDailyId('customers', 'no', 'KH');
  run(`INSERT INTO customers (id, no, name, industry, scale, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    id, no, trim(name),
    trim(industry) || null, trim(scale) || null, now());
  invalidateDicts();
  res.json({ id });
});

router.delete('/customers/:id', requirePerm('customer:delete'), (req, res) => {
  const cust = get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!cust) return res.status(404).json({ error: '客户不存在' });
  const reportCount = get('SELECT COUNT(*) AS n FROM reports WHERE customer_id = ?', cust.id).n;
  if (reportCount > 0) {
    return res.status(400).json({ error: `该客户关联 ${reportCount} 笔评价台账，不可删除` });
  }
  run('DELETE FROM customers WHERE id = ?', cust.id);
  invalidateDicts();
  res.json({ ok: true });
});

router.put('/customers/:id', requirePerm('customer:manage'), (req, res) => {
  const cust = get('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!cust) return res.status(404).json({ error: '客户不存在' });
  const { name, industry, scale } = req.body || {};
  if (trim(name) && trim(name) !== cust.name &&
      get('SELECT id FROM customers WHERE name = ? AND id <> ?', trim(name), cust.id)) {
    return res.status(400).json({ error: '客户名称已存在' });
  }
  run('UPDATE customers SET name = ?, industry = ?, scale = ? WHERE id = ?',
    trim(name) || cust.name,
    industry === undefined ? cust.industry : trim(industry) || null,
    scale === undefined ? cust.scale : trim(scale) || null,
    cust.id);
  invalidateDicts();
  res.json({ ok: true });
});

module.exports = router;
