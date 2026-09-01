/**
 * Excel 路由 —— 台账导入（按台账要素列名映射）、台账/统计导出、导入模板下载。
 * 导入接口接收原始 xlsx 字节流（application/octet-stream），无需 multipart 依赖。
 */
'use strict';

const express = require('express');
const XLSX = require('xlsx');
const { all, get, run, now, nextId, nextPlainId, nextDailyId } = require('../db');
const { requireAuth, requirePerm, hashPassword } = require('../auth');
const { GRADE_MAP, reportScore } = require('../constants');
const { serialize, logAction, invalidateDicts } = require('../report-util');

const router = express.Router();
router.use(requireAuth);

/* 台账要素 → 列名（与原线下 Excel 台账一致） */
const LEDGER_COLS = [
  { key: 'org', title: '经办机构' },
  { key: 'date', title: '上报日期' },
  { key: 'customer', title: '客户名称' },
  { key: 'approved', title: '是否核额' },
  { key: 'amount', title: '授信金额（万元）' },
  { key: 'exposure', title: '敞口金额（万元）' },
  { key: 'main', title: '主调查人' },
  { key: 'assist', title: '辅助调查人' },
  { key: 'first', title: '第一责任人' },
  { key: 'reviewer', title: '审批人' },
  { key: 's_sys', title: '系统操作质量' },
  { key: 's_credit', title: '信用情况分析质量' },
  { key: 's_asset', title: '资产负债分析质量' },
  { key: 's_operate', title: '经营情况分析质量' },
  { key: 's_purpose', title: '用途情况分析质量' },
  { key: 's_guarantee', title: '担保情况分析质量' },
  { key: 'r1', title: '第一次退回原因' },
  { key: 'r2', title: '第二次退回原因' },
  { key: 'r3', title: '第三次退回原因' },
  { key: 'r4', title: '第四次退回原因' },
  { key: 'review', title: '审查评价' }
];

const GRADE_KEYS = Object.keys(GRADE_MAP);

function sendWorkbook(res, wb, filename) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    `attachment; filename="ledger.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buf);
}

/* ---------------- 台账导出 ---------------- */
router.get('/excel/export/reports', requirePerm('excel:export'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.dateFrom) { where.push('report_date >= ?'); params.push(req.query.dateFrom); }
  if (req.query.dateTo) { where.push('report_date <= ?'); params.push(req.query.dateTo); }
  if (req.query.orgId) { where.push('org_id = ?'); params.push(req.query.orgId); }
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  const sql = `SELECT * FROM reports ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY report_date DESC, id DESC`;
  const rows = all(sql, ...params).map(serialize);

  const header = ['台账编号', ...LEDGER_COLS.map((c) => c.title),
    '报告得分', '审查评价得分', '审查意见', '状态'];
  const statusLabel = { draft: '草稿', pending_review: '待负责人审查', returned: '已退回修改', archived: '已归档' };
  const data = rows.map((r) => [
    r.id, r.orgName, r.report_date, r.customerName, r.approved, r.amount, r.exposure_amount,
    r.mainInvestigatorName, r.assistantInvestigatorName, r.firstResponsibleName, r.reviewerName,
    r.score_sys, r.score_credit, r.score_asset, r.score_operate, r.score_purpose, r.score_guarantee,
    r.return1 || '', r.return2 || '', r.return3 || '', r.return4 || '',
    r.review || '', r.reviewScore || '', r.review_comment || '', statusLabel[r.status] || r.status
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 32 }, { wch: 9 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, '评价台账');
  sendWorkbook(res, wb, `评价台账_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

/* ---------------- 统计导出 ---------------- */
router.get('/excel/export/stats', requirePerm('excel:export'), (req, res) => {
  const groupBy = ['org', 'manager', 'reviewer'].includes(req.query.groupBy) ? req.query.groupBy : 'org';
  const q = { ...req.query };

  /* 复用统计路由的聚合逻辑 */
  const { rows } = loadForExport(q);
  const groupKey = (row) => groupBy === 'org' ? row.org_id
    : groupBy === 'manager' ? (row.main_investigator || 'none')
    : (row.reviewer || 'none');
  const groups = new Map();
  for (const row of rows) {
    const k = groupKey(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  const nameOf = (key) => {
    if (key === 'none') return '—';
    const t = groupBy === 'org'
      ? get('SELECT name FROM orgs WHERE id = ?', key)
      : get('SELECT name FROM employees WHERE id = ?', key);
    return t ? t.name : key;
  };

  const header = ['名称', '审查笔数', '报告平均得分', '报告优良占比(%)', '已审查笔数',
    '审查评价平均分', '审查评价优良占比(%)', '退回次数', '授信金额合计(万元)'];
  const data = [...groups.keys()].map((key) => {
    const g = aggForExport(groups.get(key));
    return [nameOf(key), g.count, g.avgScore, g.goodRate, g.reviewed, g.reviewAvg, g.reviewGoodRate, g.returns, g.amount];
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 13 }, { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 17 }, { wch: 9 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws, '统计分析');
  sendWorkbook(res, wb, `统计分析_${groupBy}_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

/* 导出用的轻量聚合（与 stats 路由口径一致，剔除主调查人已离职的台账） */
function loadForExport(query) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : '2000-01-01';
  const t = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : '2999-12-31';
  const rows = all(`SELECT * FROM reports WHERE report_date >= ? AND report_date <= ?
    AND NOT EXISTS (SELECT 1 FROM employees le
      WHERE le.id = main_investigator AND le.status = '离职')
    ORDER BY report_date`, f, t)
    .map(serialize);
  return { rows };
}

function aggForExport(rows) {
  const scored = rows.filter((r) => r.score !== null);
  const reviewed = rows.filter((r) => r.review);
  const r1 = (x) => x === null || x === undefined ? '' : Math.round(x * 10) / 10;
  return {
    count: rows.length,
    reviewed: reviewed.length,
    avgScore: scored.length ? r1(scored.reduce((a, r) => a + r.score, 0) / scored.length) : '',
    goodRate: scored.length ? r1(scored.filter((r) => r.score >= 90).length / scored.length * 100) : '',
    reviewAvg: reviewed.length ? r1(reviewed.reduce((a, r) => a + r.reviewScore, 0) / reviewed.length) : '',
    reviewGoodRate: reviewed.length ? r1(reviewed.filter((r) => ['优', '良'].includes(r.review)).length / reviewed.length * 100) : '',
    returns: rows.reduce((a, r) => a + r.returnCount, 0),
    amount: r1(rows.reduce((a, r) => a + (r.amount || 0), 0))
  };
}

/* ---------------- 导入模板 ---------------- */
router.get('/excel/template', requirePerm('excel:import'), (req, res) => {
  const header = LEDGER_COLS.map((c) => c.title);
  const example = ['分行营业部', '2026-08-29', '示例客户有限公司', '是', 500, 300,
    '陈明远', '', '陈明远', '陈明远', '良', '优', '良', '中', '优', '良',
    '', '', '', '', ''];
  const note = ['填写说明：', '1. 请勿修改列名；机构/人员/客户按名称填写，须与系统主数据一致；',
    '2. 质量列取值：优 / 良 / 中 / 差；是否核额：是 / 否；', '3. 审查评价为负责人评分，可留空；敞口金额、授信金额留空默认为 0；',
    '4. 客户不存在时勾选"自动创建客户"即可导入。'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, example, [], note]);
  ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 30 }, { wch: 9 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, '导入模板');
  sendWorkbook(res, wb, '评价台账导入模板.xlsx');
});

/* ---------------- 台账导入 ---------------- */
router.post('/excel/import', express.raw({ type: () => true, limit: '20mb' }), requirePerm('excel:import'), (req, res) => {
  let wb;
  try {
    /* SheetJS 自动识别 xlsx 与 Excel「另存为 XML 表格 2003」（SpreadsheetML）两种格式 */
    wb = XLSX.read(req.body, { type: 'buffer', cellDates: true });
  } catch (e) {
    return res.status(400).json({ error: '文件解析失败，请上传 .xlsx 或 Excel「另存为 XML 表格 2003」格式的台账文件' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) return res.status(400).json({ error: '表格没有数据行' });

  const autoCreate = req.query.autoCreateCustomer === '1';
  const orgs = new Map(all('SELECT id, name FROM orgs').map((r) => [r.name, r.id]));
  const emps = new Map(all('SELECT id, name FROM employees WHERE status = \'在职\'').map((r) => [r.name, r.id]));
  const custs = new Map(all('SELECT id, name FROM customers').map((r) => [r.name, r.id]));

  const titleOf = (key) => {
    const c = LEDGER_COLS.find((x) => x.key === key);
    return c ? c.title : '';
  };

  const skipped = [];
  let imported = 0;

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2; /* 表头占第 1 行 */
    const cell = (key) => {
      const v = raw[titleOf(key)];
      return v === undefined || v === null ? '' : String(v).trim();
    };

    const orgName = cell('org');
    const custName = cell('customer');
    const dateVal = raw[titleOf('date')];
    const dateStr = dateVal instanceof Date
      ? dateVal.toISOString().slice(0, 10)
      : String(dateVal || '').trim().slice(0, 10);

    const fail = (reason) => skipped.push({ row: rowNo, customer: custName, reason });

    const orgId = orgs.get(orgName);
    if (!orgId) return fail(`经办机构「${orgName || '空'}」不存在`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return fail('上报日期无法解析');
    if (!custName) return fail('客户名称为空');

    const grades = {};
    for (const k of ['s_sys', 's_credit', 's_asset', 's_operate', 's_purpose', 's_guarantee']) {
      const v = cell(k);
      if (v && !GRADE_KEYS.includes(v)) return fail(`${titleOf[k]}取值「${v}」无效`);
      grades[k] = v || null;
    }
    const review = cell('review');
    if (review && !GRADE_KEYS.includes(review)) return fail(`审查评价取值「${review}」无效`);

    const empId = (name, label, required) => {
      if (!name) {
        if (required) fail(`${label}为空`);
        return null;
      }
      const id = emps.get(name);
      if (!id) { fail(`${label}「${name}」不存在或已离职`); return null; }
      return id;
    };
    const mainId = empId(cell('main'), '主调查人', true);
    const assistId = empId(cell('assist'), '辅助调查人', false);
    const firstId = empId(cell('first'), '第一责任人', false) || mainId;
    const reviewerId = empId(cell('reviewer'), '审批人', false) || req.user.id;
    if (!mainId || (cell('assist') && !assistId) || (cell('first') && !firstId) ||
        (cell('reviewer') && !reviewerId)) return;

    const amount = Number(cell('amount')) || 0;
    const exposure = Number(cell('exposure')) || 0;

    let custId = custs.get(custName);
    if (!custId) {
      if (!autoCreate) return fail(`客户「${custName}」不存在（未勾选自动创建）`);
      custId = nextPlainId('customers', 'C', 3);
      const custNo = nextDailyId('customers', 'no', 'KH');
      run(`INSERT INTO customers (id, no, name, created_at)
           VALUES (?, ?, ?, ?)`,
        custId, custNo, custName, now());
      custs.set(custName, custId);
    }

    /* 去重：同客户 + 同上报日期 + 同金额视为重复 */
    const dup = get(
      'SELECT id FROM reports WHERE customer_id = ? AND report_date = ? AND amount = ?',
      custId, dateStr, amount);
    if (dup) return fail(`与已存在记录 ${dup.id} 重复（同客户/日期/金额）`);

    const id = nextId('reports', 'BG');
    const ts = now();
    const archived = GRADE_KEYS.includes(review);
    run(`INSERT INTO reports (id, org_id, report_date, customer_id, approved, amount, exposure_amount,
          main_investigator, assistant_investigator, first_responsible, reviewer,
          score_sys, score_credit, score_asset, score_operate, score_purpose, score_guarantee,
          return1, return2, return3, return4, review, review_comment, review_by, status,
          submit_time, review_time, archive_time, created_by, created_at, updated_at)
         VALUES (${Array(31).fill('?').join(', ')})`,
      id, orgId, dateStr, custId, cell('approved') === '是' ? '是' : '否', amount, exposure,
      mainId, assistId, firstId, reviewerId,
      grades.s_sys, grades.s_credit, grades.s_asset, grades.s_operate, grades.s_purpose, grades.s_guarantee,
      cell('r1') || null, cell('r2') || null, cell('r3') || null, cell('r4') || null,
      archived ? review : null, archived ? '' : null, archived ? req.user.id : null,
      archived ? 'archived' : 'draft',
      archived ? ts : null, archived ? ts : null, archived ? ts : null,
      req.user.id, ts, ts);
    logAction(id, req.user, 'import', 'Excel 导入' + (archived ? '（已归档）' : '（草稿）'));
    invalidateDicts();
    imported += 1;
  });

  res.json({ imported, skipped, total: rows.length });
});

/* ---------------- 员工导入模板 ---------------- */
router.get('/excel/employee-template', requirePerm('employee:manage'), (req, res) => {
  const header = ['工号', '姓名', '所属机构', '岗位', '角色', '登录权限'];
  const example = ['903001', '张示例', '城东支行', '客户经理', '客户经理', '否'];
  const note = ['填写说明：', '1. 请勿修改列名；所属机构按名称填写，须与系统「机构管理」一致；',
    '2. 角色取值：超级管理员 / 审批负责人 / 客户经理 / 审批人员，多个角色用「、」分隔；',
    '3. 登录权限：是 / 否，留空默认为否；', '4. 工号与系统重复的行跳过；导入员工的初始密码统一为 123456。'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, example, [], note]);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, '员工导入模板');
  sendWorkbook(res, wb, '员工导入模板.xlsx');
});

/* ---------------- 员工批量导入 ---------------- */
router.post('/excel/import-employees', express.raw({ type: () => true, limit: '20mb' }), requirePerm('employee:manage'), (req, res) => {
  let wb;
  try {
    /* SheetJS 自动识别 xlsx 与 Excel「另存为 XML 表格 2003」（SpreadsheetML）两种格式 */
    wb = XLSX.read(req.body, { type: 'buffer', cellDates: true });
  } catch (e) {
    return res.status(400).json({ error: '文件解析失败，请上传 .xlsx 或 Excel「另存为 XML 表格 2003」格式的员工文件' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) return res.status(400).json({ error: '表格没有数据行' });

  const orgs = new Map(all('SELECT id, name FROM orgs').map((r) => [r.name, r.id]));
  const roleMap = new Map();
  for (const r of all('SELECT key, name FROM roles')) {
    roleMap.set(r.key, r.key);
    roleMap.set(r.name, r.key);
  }
  const existingNos = new Set(all('SELECT no FROM employees').map((r) => r.no));
  const HEADER = { no: '工号', name: '姓名', org: '所属机构', post: '岗位', roles: '角色', canLogin: '登录权限' };
  const cell = (raw, key) => {
    const v = raw[HEADER[key]];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  const ts = now();
  const skipped = [];
  let imported = 0;

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2; /* 表头占第 1 行 */
    const no = cell(raw, 'no');
    const name = cell(raw, 'name');
    const orgName = cell(raw, 'org');
    const post = cell(raw, 'post');
    const roleText = cell(raw, 'roles');
    const canLogin = cell(raw, 'canLogin') === '是' ? 1 : 0;
    const fail = (reason) => skipped.push({ row: rowNo, name: name || '—', reason });

    if (!no) return fail('工号为空');
    if (!name) return fail('姓名为空');
    if (existingNos.has(no)) return fail(`工号「${no}」已存在`);
    const orgId = orgs.get(orgName);
    if (!orgId) return fail(`所属机构「${orgName || '空'}」不存在`);
    const roleKeys = [...new Set(roleText.split(/[、,，/\/\s]+/).filter(Boolean).map((r) => roleMap.get(r) || r))];
    if (!roleKeys.length) return fail('角色为空');
    const unknown = roleKeys.filter((r) => !get('SELECT key FROM roles WHERE key = ?', r));
    if (unknown.length) return fail(`角色「${unknown.join('、')}」不存在`);

    const id = nextPlainId('employees', 'E', 4);
    const { salt, hash } = hashPassword('123456');
    run(`INSERT INTO employees (id, no, name, org_id, post, status, can_login, password_hash, salt, created_at)
         VALUES (?, ?, ?, ?, ?, '在职', ?, ?, ?, ?)`,
      id, no, name, orgId, post || null, canLogin, hash, salt, ts);
    for (const r of roleKeys) run('INSERT INTO employee_roles (employee_id, role_key) VALUES (?, ?)', id, r);
    existingNos.add(no);
    imported += 1;
  });

  if (imported) invalidateDicts();
  res.json({ imported, skipped, total: rows.length });
});

/* ---------------- 机构导入模板 ---------------- */
router.get('/excel/org-template', requirePerm('org:manage'), (req, res) => {
  const header = ['机构编码', '机构名称', '上级机构', '状态'];
  const example = ['361007', '示例支行', '九江银行股份有限公司', '启用'];
  const note = ['填写说明：', '1. 请勿修改列名；机构编码必填且不可与系统已有编码重复，重复的行跳过；',
    '2. 机构名称必填；上级机构为展示文本，可留空；', '3. 状态取值：启用 / 停用，留空默认为启用。'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, example, [], note]);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws, '机构导入模板');
  sendWorkbook(res, wb, '机构导入模板.xlsx');
});

/* ---------------- 机构批量导入 ---------------- */
router.post('/excel/import-orgs', express.raw({ type: () => true, limit: '20mb' }), requirePerm('org:manage'), (req, res) => {
  let wb;
  try {
    wb = XLSX.read(req.body, { type: 'buffer', cellDates: true });
  } catch (e) {
    return res.status(400).json({ error: '文件解析失败，请上传 .xlsx 或 Excel「另存为 XML 表格 2003」格式的机构文件' });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) return res.status(400).json({ error: '表格没有数据行' });

  const HEADER = { code: '机构编码', name: '机构名称', parent: '上级机构', status: '状态' };
  const cell = (raw, key) => {
    const v = raw[HEADER[key]];
    return v === undefined || v === null ? '' : String(v).trim();
  };

  const existingCodes = new Set(all('SELECT code FROM orgs').map((r) => r.code));
  const ts = now();
  const skipped = [];
  let imported = 0;

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2; /* 表头占第 1 行 */
    const code = cell(raw, 'code');
    const name = cell(raw, 'name');
    const parent = cell(raw, 'parent');
    const status = cell(raw, 'status') === '停用' ? '停用' : '启用';
    const fail = (reason) => skipped.push({ row: rowNo, name: name || '—', reason });

    if (!code) return fail('机构编码为空');
    if (!name) return fail('机构名称为空');
    if (existingCodes.has(code)) return fail(`机构编码「${code}」已存在`);

    const id = nextPlainId('orgs', 'ORG', 3);
    run('INSERT INTO orgs (id, code, name, parent, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, code, name, parent || null, status, ts);
    existingCodes.add(code);
    imported += 1;
  });

  if (imported) invalidateDicts();
  res.json({ imported, skipped, total: rows.length });
});

module.exports = router;
