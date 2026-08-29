/**
 * 待办 / 已办 —— 按角色区分：
 *   审批人员：待办 = 本人草稿 + 被退回；已办 = 本人已提交（待审查/已归档）
 *   审批负责人：待办 = 全部待审查；已办 = 本人已审查归档
 */
'use strict';

const express = require('express');
const { all, get } = require('../db');
const { requireAuth } = require('../auth');
const { serialize } = require('../report-util');

const router = express.Router();
router.use(requireAuth);

const hasRole = (user, key) => user.roles.some((r) => r.key === key);

function countsFor(user) {
  const evaluate = get(
    `SELECT COUNT(*) AS n FROM reports WHERE reviewer = ? AND status IN ('draft', 'returned')`,
    user.id).n;
  const returned = get(
    `SELECT COUNT(*) AS n FROM reports WHERE reviewer = ? AND status = 'returned'`, user.id).n;
  const review = get(`SELECT COUNT(*) AS n FROM reports WHERE status = 'pending_review'`).n;
  const returnedByChief = get(
    `SELECT COUNT(*) AS n FROM reports WHERE status = 'returned' AND review_by = ?`, user.id).n;
  return { evaluate, returned, review, returnedByChief };
}

router.get('/tasks/counts', (req, res) => {
  res.json(countsFor(req.user));
});

router.get('/tasks', (req, res) => {
  const u = req.user;
  const box = req.query.box === 'done' ? 'done' : 'todo';
  let rows = [];

  if (box === 'todo') {
    if (hasRole(u, 'chief')) {
      rows = all(`SELECT * FROM reports WHERE status = 'pending_review'
                  ORDER BY submit_time ASC`);
    } else {
      rows = all(`SELECT * FROM reports WHERE reviewer = ? AND status IN ('draft', 'returned')
                  ORDER BY updated_at DESC`, u.id);
    }
  } else {
    if (hasRole(u, 'chief')) {
      rows = all(`SELECT * FROM reports WHERE status = 'archived' AND review_by = ?
                  ORDER BY review_time DESC`, u.id);
    } else {
      rows = all(`SELECT * FROM reports WHERE reviewer = ? AND submit_time IS NOT NULL
                  ORDER BY submit_time DESC`, u.id);
    }
  }

  res.json({ items: rows.map(serialize), box, counts: countsFor(u) });
});

module.exports = { router, countsFor };
