/**
 * 台账共享工具 —— 行序列化（关联名称、得分计算）、录入校验、操作日志
 */
'use strict';

const { all, get, run, now } = require('./db');
const { GRADE_MAP, DIMENSIONS, reportScore, GOOD_SCORE_LINE, REVIEW_SCORES } = require('./constants');

/* 缓存主数据名映射，主数据变更或导入后调用 invalidateDicts() 立即失效 */
let cache = { at: 0, orgs: null, emps: null, custs: null };
function dicts(force) {
  if (force || !cache.orgs || Date.now() - cache.at > 5000) {
    cache = {
      at: Date.now(),
      orgs: new Map(all('SELECT id, name FROM orgs').map((r) => [r.id, r.name])),
      emps: new Map(all('SELECT id, no, name FROM employees').map((r) => [r.id, r])),
      custs: new Map(all('SELECT id, name FROM customers').map((r) => [r.id, r.name]))
    };
  }
  return cache;
}

function invalidateDicts() {
  cache = { at: 0, orgs: null, emps: null, custs: null };
}

/* 仅本人相关范围（report:read:self / stats:read:self）：按用户角色判定——
   含客户经理角色 → 本人主调查的台账；含审批人员角色 → 本人审批的台账；两者皆有取并集 */
function selfScopeSql(userId, roleKeys) {
  const conds = [];
  const params = [];
  if (roleKeys.includes('manager')) { conds.push('r.main_investigator = ?'); params.push(userId); }
  if (roleKeys.includes('reviewer')) { conds.push('r.reviewer = ?'); params.push(userId); }
  return { sql: conds.length ? `(${conds.join(' OR ')})` : '(1 = 0)', params };
}

/* 行序列化：id → 名称，附计算得分 */
function serialize(row) {
  if (!row) return null;
  const d = dicts();
  const r = { ...row };
  r.orgName = d.orgs.get(row.org_id) || row.org_id;
  r.customerName = d.custs.get(row.customer_id) || row.customer_id;
  for (const [col, key] of [
    ['main_investigator', 'mainInvestigatorName'],
    ['assistant_investigator', 'assistantInvestigatorName'],
    ['first_responsible', 'firstResponsibleName'],
    ['reviewer', 'reviewerName'],
    ['review_by', 'reviewByName']
  ]) {
    const emp = row[col] ? d.emps.get(row[col]) : null;
    r[key] = emp ? `${emp.name}` : (row[col] || '');
  }
  r.score = reportScore(row);
  r.scoreGrade = gradeOf(r.score);
  r.good = r.score !== null && r.score >= GOOD_SCORE_LINE;
  r.reviewScore = row.review ? (REVIEW_SCORES[row.review] ?? null) : null;
  r.returnCount = [row.return1, row.return2, row.return3, row.return4].filter(Boolean).length;
  return r;
}

function gradeOf(score) {
  if (score === null || score === undefined) return '';
  if (score >= 85) return '优';
  if (score >= 75) return '良';
  if (score >= 65) return '中';
  return '差';
}

const GRADE_KEYS = Object.keys(GRADE_MAP);
const SCORE_COLS = DIMENSIONS.map((d) => `score_${d.key}`);

/* 校验并提取可编辑字段；返回 {data, errors} */
function validatePayload(body) {
  const errors = [];
  const data = {};

  if (body.orgId !== undefined) data.org_id = String(body.orgId || '').trim();
  if (body.reportDate !== undefined) data.report_date = String(body.reportDate || '').trim();
  if (body.customerId !== undefined) data.customer_id = String(body.customerId || '').trim();
  if (body.approved !== undefined) data.approved = body.approved === '是' ? '是' : '否';
  if (body.amount !== undefined) {
    const n = Number(body.amount);
    if (!Number.isFinite(n) || n < 0) errors.push('授信金额必须是非负数字');
    else data.amount = n;
  }
  if (body.exposureAmount !== undefined) {
    const n = Number(body.exposureAmount);
    if (!Number.isFinite(n) || n < 0) errors.push('敞口金额必须是非负数字');
    else data.exposure_amount = n;
  }
  for (const [k, col] of [
    ['mainInvestigator', 'main_investigator'],
    ['assistantInvestigator', 'assistant_investigator'],
    ['firstResponsible', 'first_responsible']
  ]) {
    if (body[k] !== undefined) data[col] = String(body[k] || '').trim() || null;
  }

  if (body.reportDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(data.report_date || '')) {
    errors.push('上报日期格式应为 YYYY-MM-DD');
  }

  for (const d of DIMENSIONS) {
    const k = 'score_' + d.key;
    if (body[d.key] !== undefined || body[k] !== undefined) {
      const v = body[d.key] !== undefined ? body[d.key] : body[k];
      if (v === '' || v === null) data[k] = null;
      else if (!GRADE_KEYS.includes(v)) errors.push(`${d.label}取值应为 优/良/中/差`);
      else data[k] = v;
    }
  }

  for (let i = 1; i <= 4; i++) {
    if (body['return' + i] !== undefined) {
      data['return' + i] = String(body['return' + i] || '').trim() || null;
    }
  }

  if (data.org_id && !get('SELECT id FROM orgs WHERE id = ?', data.org_id)) errors.push('经办机构不存在');
  if (data.customer_id && !get('SELECT id FROM customers WHERE id = ?', data.customer_id)) errors.push('客户不存在');
  for (const col of ['main_investigator', 'assistant_investigator', 'first_responsible']) {
    if (data[col] && !get('SELECT id FROM employees WHERE id = ?', data[col])) {
      errors.push('调查人引用的员工不存在');
      break;
    }
  }

  return { data, errors };
}

function logAction(reportId, user, action, detail) {
  run('INSERT INTO op_logs (report_id, employee_id, employee_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    reportId, user.id, user.name, action, detail, now());
}

module.exports = { serialize, validatePayload, logAction, gradeOf, SCORE_COLS, dicts, invalidateDicts, selfScopeSql };
