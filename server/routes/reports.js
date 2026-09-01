/**
 * 评价台账路由 —— 列表/详情/登记/修改 + 工作流动作（提交、审查评价、退回）+ 流程时间线
 *
 * 状态机：draft/returned --submit--> pending_review --review(审查评价+意见)--> archived
 *                                    pending_review --return--> returned
 * 审查评价评价对象是审批人员的审查工作（非调查报告本身），由审批负责人打分。
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { all, get, run, now, nextId, DATA_DIR } = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { GRADE_MAP, reportScore } = require('../constants');
const { serialize, validatePayload, logAction, selfScopeSql } = require('../report-util');

const router = express.Router();
router.use(requireAuth);

const can = (user, perm) => user.perms.includes(perm);
const roleKeysOf = (u) => u.roles.map((r) => r.key);

/* 记录可见性（与列表口径一致：report:read 全量；report:read:self 按角色） */
function canViewRecord(u, row) {
  if (can(u, 'report:read')) return true;
  if (!can(u, 'report:read:self')) return false;
  const ids = roleKeysOf(u);
  return (ids.includes('manager') && row.main_investigator === u.id) ||
         (ids.includes('reviewer') && row.reviewer === u.id);
}

/* ---------------- 附件（审批人员上传，多个） ---------------- */
const UPLOAD_ROOT = path.join(DATA_DIR, 'uploads');
const safeName = (name) => String(name || '附件')
  .split(/[\\/]/).pop().replace(/[\x00-\x1f]/g, '').slice(0, 120) || '附件';

router.get('/reports/:id/attachments', (req, res) => {
  const report = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!report) return res.status(404).json({ error: '记录不存在' });
  if (!canViewRecord(req.user, report)) return res.status(403).json({ error: '没有查看该记录的权限' });
  const items = all(
    `SELECT a.id, a.filename, a.size, a.uploaded_by, a.created_at, e.name AS uploaderName
     FROM attachments a LEFT JOIN employees e ON e.id = a.uploaded_by
     WHERE a.report_id = ? ORDER BY a.id`, report.id);
  res.json({ items });
});

router.post('/reports/:id/attachments', express.raw({ type: () => true, limit: '50mb' }), requirePerm('report:score'), (req, res) => {
  const report = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!report) return res.status(404).json({ error: '记录不存在' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: '附件内容为空' });
  const filename = safeName(req.query.name || '');
  const ins = run('INSERT INTO attachments (report_id, filename, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)',
    report.id, filename, req.body.length, req.user.id, now());
  const attId = Number(ins.lastInsertRowid);
  try {
    const dir = path.join(UPLOAD_ROOT, report.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, String(attId)), req.body);
  } catch (e) {
    /* 写盘失败回滚附件行，返回可定位的错误而非笼统 500 */
    run('DELETE FROM attachments WHERE id = ?', attId);
    console.error('[attachment] 写盘失败:', e.message);
    return res.status(500).json({ error: '附件写入失败：存储目录不可写（' + (e.code || '未知') + '），请检查 data/uploads 权限' });
  }
  logAction(report.id, req.user, 'upload', `上传附件「${filename}」`);
  res.json({ id: attId, filename, size: req.body.length });
});

router.get('/reports/:id/attachments/:attId', (req, res) => {
  const report = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!report) return res.status(404).json({ error: '记录不存在' });
  if (!canViewRecord(req.user, report)) return res.status(403).json({ error: '没有查看该记录的权限' });
  const att = get('SELECT * FROM attachments WHERE id = ? AND report_id = ?', req.params.attId, report.id);
  if (!att) return res.status(404).json({ error: '附件不存在' });
  const file = path.join(UPLOAD_ROOT, report.id, String(att.id));
  if (!fs.existsSync(file)) return res.status(404).json({ error: '附件文件已丢失' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
  fs.createReadStream(file).pipe(res);
});

router.delete('/reports/:id/attachments/:attId', (req, res) => {
  const report = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!report) return res.status(404).json({ error: '记录不存在' });
  const att = get('SELECT * FROM attachments WHERE id = ? AND report_id = ?', req.params.attId, report.id);
  if (!att) return res.status(404).json({ error: '附件不存在' });
  if (att.uploaded_by !== req.user.id && !can(req.user, 'report:delete')) {
    return res.status(403).json({ error: '只能删除本人上传的附件' });
  }
  run('DELETE FROM attachments WHERE id = ?', att.id);
  const file = path.join(UPLOAD_ROOT, report.id, String(att.id));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  logAction(report.id, req.user, 'delete-attachment', `删除附件「${att.filename}」`);
  res.json({ ok: true });
});

/* ---------------- 列表 ---------------- */
router.get('/reports', requireAuth, (req, res) => {
  const u = req.user;
  const q = req.query;
  const where = [];
  const params = [];

  if (can(u, 'report:read')) {
    /* 全量可见，按条件过滤 */
  } else if (can(u, 'report:read:self')) {
    where.push(selfScopeSql(u.id, roleKeysOf(u)));
  } else {
    return res.status(403).json({ error: '没有查看评价台账的权限' });
  }

  if (q.keyword) {
    const k = `%${q.keyword}%`;
    /* 按客户名称 / 主调查人姓名 / 审批人姓名检索（台账存人员 ID，用子查询匹配姓名） */
    where.push(`(c.name LIKE ? OR EXISTS (SELECT 1 FROM employees em
      WHERE em.id = r.main_investigator AND em.name LIKE ?)
      OR EXISTS (SELECT 1 FROM employees em WHERE em.id = r.reviewer AND em.name LIKE ?))`);
    params.push(k, k, k);
  }
  if (q.orgId) { where.push('r.org_id = ?'); params.push(q.orgId); }
  if (q.status) { where.push('r.status = ?'); params.push(q.status); }
  if (q.customerId) { where.push('r.customer_id = ?'); params.push(q.customerId); }
  if (q.reviewerId) { where.push('r.reviewer = ?'); params.push(q.reviewerId); }
  if (q.mainInvestigatorId) { where.push('r.main_investigator = ?'); params.push(q.mainInvestigatorId); }
  if (q.dateFrom) { where.push('r.report_date >= ?'); params.push(q.dateFrom); }
  if (q.dateTo) { where.push('r.report_date <= ?'); params.push(q.dateTo); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(
    `SELECT COUNT(*) AS n FROM reports r LEFT JOIN customers c ON c.id = r.customer_id ${whereSql}`,
    ...params).n;

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 20));
  const items = all(
    `SELECT r.* FROM reports r LEFT JOIN customers c ON c.id = r.customer_id
     ${whereSql} ORDER BY r.report_date DESC, r.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  ).map(serialize);

  res.json({ items, total, page, pageSize });
});

/* ---------------- 详情（含流程时间线） ---------------- */
router.get('/reports/:id', requireAuth, (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  const u = req.user;
  if (!can(u, 'report:read')) {
    /* self 权限只能看本人相关记录（范围与列表一致：按角色判定） */
    const ids = roleKeysOf(u);
    const involved = can(u, 'report:read:self') && (
      (ids.includes('manager') && row.main_investigator === u.id) ||
      (ids.includes('reviewer') && row.reviewer === u.id));
    if (!involved) return res.status(403).json({ error: '没有查看该记录的权限' });
  }
  const timeline = all(
    'SELECT employee_name, action, detail, created_at FROM op_logs WHERE report_id = ? ORDER BY id',
    row.id);
  const customer = get('SELECT * FROM customers WHERE id = ?', row.customer_id);
  res.json({ item: serialize(row), customer, timeline });
});

/* ---------------- 登记（草稿） ---------------- */
router.post('/reports', requirePerm('report:create'), (req, res) => {
  const { data, errors } = validatePayload(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('；') });
  if (!data.org_id || !data.customer_id || !data.report_date) {
    return res.status(400).json({ error: '经办机构、上报日期、客户名称必填' });
  }
  const id = nextId('reports', 'BG');
  const ts = now();
  const cols = ['org_id', 'report_date', 'customer_id', 'approved', 'amount', 'exposure_amount',
    'main_investigator', 'assistant_investigator', 'first_responsible',
    'score_sys', 'score_credit', 'score_asset', 'score_operate', 'score_purpose', 'score_guarantee',
    'return1', 'return2', 'return3', 'return4'];
  const values = cols.map((c) => data[c] !== undefined ? data[c] : null);
  run(`INSERT INTO reports (id, ${cols.join(',')}, reviewer, status, created_by, created_at, updated_at)
       VALUES (?, ${cols.map(() => '?').join(',')}, ?, 'draft', ?, ?, ?)`,
    id, ...values, req.user.id, req.user.id, ts, ts);
  logAction(id, req.user, 'create', '登记评价记录（草稿）');
  res.json({ id });
});

/* ---------------- 修改（仅草稿/退回状态，且为本人经办） ---------------- */
router.put('/reports/:id', requirePerm('report:score'), (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (!['draft', 'returned'].includes(row.status)) {
    return res.status(400).json({ error: '当前状态不可修改（已提交或已归档，需负责人退回）' });
  }
  if (row.reviewer !== req.user.id && row.created_by !== req.user.id) {
    return res.status(403).json({ error: '只能修改本人经办的记录' });
  }
  const { data, errors } = validatePayload(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join('；') });
  const cols = Object.keys(data);
  if (cols.length) {
    run(`UPDATE reports SET ${cols.map((c) => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`,
      ...cols.map((c) => data[c]), now(), row.id);
    if (row.status === 'returned') {
      run('UPDATE reports SET status = ?, return_note = NULL WHERE id = ?', 'draft', row.id);
      logAction(row.id, req.user, 'revise', '修改评价内容（退回后重新进入草稿）');
    } else {
      logAction(row.id, req.user, 'update', '修改评价内容');
    }
  }
  res.json({ ok: true });
});

/* ---------------- 提交负责人审查 ---------------- */
router.post('/reports/:id/submit', requirePerm('report:submit'), (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (!['draft', 'returned'].includes(row.status)) {
    return res.status(400).json({ error: '当前状态不可提交' });
  }
  if (row.reviewer !== req.user.id && row.created_by !== req.user.id) {
    return res.status(403).json({ error: '只能提交本人经办的记录' });
  }
  const missing = ['sys', 'credit', 'asset', 'operate', 'purpose', 'guarantee']
    .filter((k) => !row['score_' + k]);
  if (missing.length) {
    return res.status(400).json({ error: '六项分析质量未评分完整，不能提交' });
  }
  run('UPDATE reports SET status = ?, submit_time = ?, return_note = NULL, updated_at = ? WHERE id = ?',
    'pending_review', now(), now(), row.id);
  logAction(row.id, req.user, 'submit', '提交负责人审查');
  res.json({ ok: true });
});

/* ---------------- 审查评价（审批负责人对审批人员的审查工作打分）并归档 ---------------- */
router.post('/reports/:id/review', requirePerm('report:review'), (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (row.status !== 'pending_review') {
    return res.status(400).json({ error: '该记录不在待审查状态' });
  }
  const { grade, comment } = req.body || {};
  if (!GRADE_MAP[grade]) return res.status(400).json({ error: '审查评价取值应为 优/良/中/差' });
  if (!String(comment || '').trim()) {
    return res.status(400).json({ error: '请填写审查意见' });
  }
  const ts = now();
  run(`UPDATE reports SET review = ?, review_comment = ?, review_by = ?, status = 'archived',
       review_time = ?, archive_time = ?, updated_at = ? WHERE id = ?`,
    grade, String(comment).trim(), req.user.id, ts, ts, ts, row.id);
  logAction(row.id, req.user, 'review', `审查评价「${grade}」（评价对象：审批人 ${serialize(row).reviewerName} 的审查工作），已归档`);
  res.json({ ok: true });
});

/* ---------------- 退回评价修改（负责人 → 审批人员） ---------------- */
router.post('/reports/:id/return', requirePerm('report:return'), (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (row.status !== 'pending_review') {
    return res.status(400).json({ error: '该记录不在待审查状态' });
  }
  const note = String((req.body || {}).note || '').trim();
  if (!note) return res.status(400).json({ error: '请填写退回原因' });
  run("UPDATE reports SET status = 'returned', return_note = ?, updated_at = ? WHERE id = ?",
    note, now(), row.id);
  logAction(row.id, req.user, 'return', `退回评价修改：${note}`);
  res.json({ ok: true });
});

/* ---------------- 删除（管理员，未归档的记录） ---------------- */
router.delete('/reports/:id', requirePerm('report:delete'), (req, res) => {
  const row = get('SELECT * FROM reports WHERE id = ?', req.params.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  if (row.status === 'archived') {
    return res.status(400).json({ error: '已归档记录不可删除（统计口径需要）' });
  }
  run('DELETE FROM reports WHERE id = ?', row.id);
  res.json({ ok: true });
});

module.exports = router;
