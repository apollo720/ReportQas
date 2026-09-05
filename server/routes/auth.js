/**
 * 认证路由 —— 登录 / 登出 / 当前用户 / 修改密码
 */
'use strict';

const express = require('express');
const { get, run } = require('../db');
const {
  hashPassword, verifyPassword, createSession, destroySession, buildUser, requireAuth,
  loginLocked, recordLoginFail, clearLoginFails
} = require('../auth');
const { countsFor } = require('./tasks');

const router = express.Router();
const PWD_COMPLEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/; /* ≥8 位且同时含字母与数字 */

function mePayload(user) {
  /* 附带待办数量，前端工作台/角标一次取齐 */
  let counts = { evaluate: 0, review: 0, returnedByChief: 0 };
  try { counts = countsFor(user); } catch (e) { /* ignore */ }
  return { user, counts, ts: Date.now() };
}

router.post('/login', (req, res) => {
  const { no, password } = req.body || {};
  if (!no || !password) return res.status(400).json({ error: '请输入工号和密码' });
  const noKey = String(no).trim();
  const failKey = noKey + '|' + (req.socket.remoteAddress || '');
  if (loginLocked(failKey)) {
    return res.status(429).json({ error: '登录失败次数过多，该账号已临时锁定，请 15 分钟后再试' });
  }
  const emp = get('SELECT * FROM employees WHERE no = ?', noKey);
  /* 恒定时间路径：工号不存在时也执行一次哈希比较，避免时序差枚举工号 */
  const dummy = hashPassword('timing-equalizer');
  if (!emp || !verifyPassword(password, emp.salt || dummy.salt, emp.password_hash || dummy.hash)) {
    recordLoginFail(failKey);
    return res.status(401).json({ error: '工号或密码不正确' });
  }
  if (emp.status !== '在职') return res.status(403).json({ error: '该账号已停用（离职）' });
  if (!emp.can_login) return res.status(403).json({ error: '该账号未开通系统登录权限' });
  clearLoginFails(failKey);
  createSession(res, emp.id);
  res.json(mePayload(buildUser(emp)));
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(mePayload(req.user));
});

router.post('/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写原密码和新密码' });
  if (!PWD_COMPLEX.test(String(newPassword))) {
    return res.status(400).json({ error: '新密码至少 8 位，且需同时包含字母和数字' });
  }
  const emp = get('SELECT * FROM employees WHERE id = ?', req.user.id);
  if (!verifyPassword(oldPassword, emp.salt, emp.password_hash)) {
    return res.status(400).json({ error: '原密码不正确' });
  }
  const { salt, hash } = hashPassword(newPassword);
  run('UPDATE employees SET password_hash = ?, salt = ? WHERE id = ?', hash, salt, emp.id);
  res.json({ ok: true });
});

module.exports = router;
