/**
 * 统计路由 —— 全部基于台账实时聚合（按上报日期）。
 *
 * 指标归属（两层评价体系）：
 *   报告质量（考核客户经理/机构）：审查笔数、报告平均得分（六维平均）、优良占比（≥90）
 *   审查工作质量（考核审批人员）：审查笔数、审查评价平均分、审查评价优良占比（负责人所打）
 * 时间维度：周（ISO）/月/季/年；分组对象：机构 / 客户经理（主调查人）/ 审查人员（审批人）
 */
'use strict';

const express = require('express');
const { all, get } = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { DIMENSIONS, GRADE_MAP, reportScore, GOOD_SCORE_LINE } = require('../constants');
const { serialize, selfScopeSql } = require('../report-util');

const router = express.Router();
router.use(requireAuth);

/* ---------- 工具 ---------- */
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fd = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fd + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400e3));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function bucketKey(dateStr, period) {
  if (period === 'week') return isoWeekKey(dateStr);
  if (period === 'quarter') {
    const q = Math.floor((parseInt(dateStr.slice(5, 7), 10) - 1) / 3) + 1;
    return `${dateStr.slice(0, 4)}-Q${q}`;
  }
  if (period === 'year') return dateStr.slice(0, 4);
  return dateStr.slice(0, 7); /* month */
}

/* 未显式给时间范围时，按周期回看 8 个桶 */
function defaultRange(period) {
  const nowD = new Date();
  const to = nowD.toISOString().slice(0, 10);
  const back = { week: 55, month: 240, quarter: 730, year: 1500 }[period] || 240;
  const from = new Date(nowD.getTime() - back * 86400e3).toISOString().slice(0, 10);
  return { from, to };
}

function loadRows(query, user) {
  const period = ['week', 'month', 'quarter', 'year'].includes(query.period)
    ? query.period : 'month';
  const { from, to } = defaultRange(period);
  const f = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : from;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : to;

  const params = [f, t];
  let scope = '';
  if (!user.perms.includes('stats:read')) {
    if (!user.perms.includes('stats:read:self')) return { error: '没有查看统计的权限' };
    /* 仅本人相关：与台账查看（仅本人经办）同口径，按角色判定 */
    scope = ' AND ' + selfScopeSql(user.id, user.roles.map((r) => r.key));
  }
  /* 主调查人已离职的台账不纳入任何统计 */
  scope += ` AND NOT EXISTS (SELECT 1 FROM employees le
    WHERE le.id = r.main_investigator AND le.status = '离职')`;

  const rows = all(
    `SELECT r.* FROM reports r WHERE r.report_date >= ? AND r.report_date <= ?${scope}
     ORDER BY r.report_date`, ...params).map(serialize);
  return { rows, period, from: f, to: t };
}

function aggOf(rows) {
  const n = rows.length;
  const scored = rows.filter((r) => r.score !== null);
  const reviewed = rows.filter((r) => r.review);
  const sum = (arr, fn) => arr.reduce((a, r) => a + fn(r), 0);
  const round1 = (x) => x === null ? null : Math.round(x * 10) / 10;
  const scoreAvg = scored.length ? sum(scored, (r) => r.score) / scored.length : null;
  const reviewAvg = reviewed.length ? sum(reviewed, (r) => r.reviewScore) / reviewed.length : null;
  return {
    count: n,
    reviewed: reviewed.length,
    avgScore: round1(scoreAvg),
    goodRate: scored.length
      ? Math.round(scored.filter((r) => r.score >= GOOD_SCORE_LINE).length / scored.length * 1000) / 10
      : null,
    reviewAvg: round1(reviewAvg),
    reviewGoodRate: reviewed.length
      ? Math.round(reviewed.filter((r) => ['优', '良'].includes(r.review)).length / reviewed.length * 1000) / 10
      : null,
    returns: sum(rows, (r) => r.returnCount),
    avgReturns: n ? round1(sum(rows, (r) => r.returnCount) / n) : null,
    amount: Math.round(sum(rows, (r) => r.amount || 0) * 10) / 10,
    exposure: Math.round(sum(rows, (r) => r.exposure_amount || 0) * 10) / 10
  };
}

/* ---------- 总览 KPI ---------- */
router.get('/stats/summary', (req, res) => {
  const r = loadRows(req.query, req.user);
  if (r.error) return res.status(403).json({ error: r.error });
  const byStatus = { draft: 0, pending_review: 0, returned: 0, archived: 0 };
  const gradeDist = { '优': 0, '良': 0, '中': 0, '差': 0 };
  for (const row of r.rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.score !== null && row.scoreGrade) gradeDist[row.scoreGrade] += 1;
  }
  res.json({ range: { from: r.from, to: r.to, period: r.period }, byStatus, gradeDist, ...aggOf(r.rows) });
});

/* ---------- 趋势（周/月/季/年） ---------- */
router.get('/stats/trend', (req, res) => {
  const r = loadRows(req.query, req.user);
  if (r.error) return res.status(403).json({ error: r.error });
  const buckets = new Map();
  for (const row of r.rows) {
    const key = bucketKey(row.report_date, r.period);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const items = [...buckets.keys()].sort().map((key) => ({
    key, ...aggOf(buckets.get(key))
  }));
  res.json({ period: r.period, range: { from: r.from, to: r.to }, items });
});

/* ---------- 分组聚合（机构 / 客户经理 / 审查人员） ---------- */
router.get('/stats/aggregate', (req, res) => {
  const groupBy = ['org', 'manager', 'reviewer'].includes(req.query.groupBy)
    ? req.query.groupBy : 'org';
  const q = { ...req.query, period: req.query.period || 'year' };
  const r = loadRows(q, req.user);
  if (r.error) return res.status(403).json({ error: r.error });

  const groups = new Map();
  for (const row of r.rows) {
    const key = groupBy === 'org' ? row.org_id
      : groupBy === 'manager' ? (row.main_investigator || 'none')
      : (row.reviewer || 'none');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const nameOf = (key) => {
    if (key === 'none') return '—';
    if (groupBy === 'org') {
      const o = get('SELECT name FROM orgs WHERE id = ?', key);
      return o ? o.name : key;
    }
    const e = get('SELECT name FROM employees WHERE id = ?', key);
    return e ? e.name : key;
  };

  const items = [...groups.keys()].map((key) => ({
    key, name: nameOf(key), ...aggOf(groups.get(key))
  })).sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));

  res.json({ groupBy, range: { from: r.from, to: r.to }, items });
});

/* ---------- 六维均分（雷达图） ---------- */
router.get('/stats/dim-avg', (req, res) => {
  const r = loadRows({ ...req.query, period: 'year' }, req.user);
  if (r.error) return res.status(403).json({ error: r.error });
  const items = DIMENSIONS.map((d) => {
    const vals = r.rows.map((row) => row['score_' + d.key]).filter((g) => g && GRADE_MAP[g]);
    const avg = vals.length
      ? Math.round(vals.reduce((a, g) => a + GRADE_MAP[g].score, 0) / vals.length * 10) / 10
      : null;
    return { key: d.key, name: d.label.replace('质量', ''), value: avg, full: 100 };
  });
  res.json({ range: { from: r.from, to: r.to }, items });
});

module.exports = router;
