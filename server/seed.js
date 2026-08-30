/**
 * 演示数据种子 —— 沿用原型的 mock 数据集。
 * 首次启动（employees 表为空）自动灌入；`npm run seed` 强制重建。
 * 管理员 901003/admin123，其余在职员工统一 123456；客户经理角色本期 can_login=0。
 */
'use strict';

const { get, run, all, now, nextPlainId } = require('./db');
const { hashPassword } = require('./auth');
const { ROLE_PRESETS } = require('./constants');

const ORGS = [
  ['ORG000', '360000', '授信审批部', '九江银行股份有限公司'],
  ['ORG001', '361000', '分行营业部', '九江银行股份有限公司'],
  ['ORG002', '361001', '城东支行', '九江银行股份有限公司'],
  ['ORG003', '361002', '城西支行', '九江银行股份有限公司'],
  ['ORG004', '361003', '城南支行', '九江银行股份有限公司'],
  ['ORG005', '361004', '城北支行', '九江银行股份有限公司'],
  ['ORG006', '361005', '浔阳支行', '九江银行股份有限公司'],
  ['ORG007', '361006', '开发区支行', '九江银行股份有限公司', '停用']
];

/* [id, 工号, 姓名, 机构, 岗位, 角色, 可登录] */
const EMPLOYEES = [
  ['E1001', '901001', '陈明远', 'ORG000', '授信审查岗', 'reviewer', 1],
  ['E1002', '901002', '周涛', 'ORG000', '授信审批部副总经理', 'chief', 1],
  ['E1003', '901003', '郑立群', 'ORG000', '系统管理员', 'admin', 1],
  ['E1004', '901004', '林可', 'ORG000', '授信审查岗', 'reviewer', 1],
  ['E1005', '901005', '高翔', 'ORG000', '授信审查岗', 'reviewer', 1],
  ['E2001', '902001', '李文博', 'ORG002', '客户经理（高级）', 'manager', 0],
  ['E2002', '902002', '王思远', 'ORG002', '客户经理', 'manager', 0],
  ['E2003', '902003', '张慧敏', 'ORG003', '客户经理（高级）', 'manager', 0],
  ['E2004', '902004', '吴建华', 'ORG003', '客户经理', 'manager', 0],
  ['E2005', '902005', '刘建国', 'ORG004', '客户经理（资深）', 'manager', 0],
  ['E2006', '902006', '赵一鸣', 'ORG005', '客户经理（高级）', 'manager', 0],
  ['E2007', '902007', '孙梦琪', 'ORG005', '客户经理', 'manager', 0],
  ['E2008', '902008', '胡雅琳', 'ORG001', '客户经理（资深）', 'manager', 0],
  ['E2009', '902009', '徐鹏', 'ORG006', '客户经理', 'manager', 0],
  ['E2010', '902010', '何静', 'ORG007', '客户经理', 'manager', 0]
];

/* [id, 编号, 名称, 行业, 规模] */
const CUSTOMERS = [
  ['C001', 'KH202601', '江西晨光新材料股份有限公司', '化学原料和化学制品制造业', '中型'],
  ['C002', 'KH202602', '九江华远物流有限公司', '道路运输业', '小型'],
  ['C003', 'KH202603', '萍乡金鼎机械制造有限公司', '通用设备制造业', '中型'],
  ['C004', 'KH202604', '南昌恒信电子科技有限公司', '计算机、通信和其他电子设备制造业', '小型'],
  ['C005', 'KH202605', '赣州绿源农业发展有限公司', '农、林、牧、渔专业及辅助性活动', '中型'],
  ['C006', 'KH202606', '宜春昌盛建材有限公司', '非金属矿物制品业', '小型'],
  ['C007', 'KH202607', '上饶通达汽配有限公司', '汽车制造业', '小型'],
  ['C008', 'KH202608', '吉安鑫旺纺织有限公司', '纺织业', '中型'],
  ['C009', 'KH202609', '抚州康泰医药有限公司', '批发业', '中型'],
  ['C010', 'KH202610', '景德镇陶源陶瓷有限公司', '非金属矿物制品业', '小型'],
  ['C011', 'KH202611', '新余钢联金属制品有限公司', '金属制品业', '中型'],
  ['C012', 'KH202612', '鹰潭铜都铜业有限公司', '有色金属冶炼和压延加工业', '大型']
];

const RETURN_TEXTS = {
  r1: '调查报告未说明借款人近一年主要结算账户流水变动情况，缺少异常大额资金进出的合理性分析，请补充流水明细及说明后重新上报。',
  r2: '担保人资信材料不完整，未提供保证人近三个月个人征信报告及对外担保清单，请补充后重新提交。',
  r3: '贷款用途分析未核实贸易背景真实性，缺少上下游购销合同、增值税发票等佐证材料，请补充佐证。',
  r4: '资产负债表中存货与应收账款占比异常但未作说明，请补充存货构成、账龄结构及周转情况分析。',
  r5: '经营情况分析仅罗列财务数据，未结合行业周期与在手订单论证持续经营能力，建议重新撰写该章节。'
};

const REVIEW_COMMENTS = {
  '优': '六维评价客观到位，评分与报告实际质量匹配，退回原因登记规范，审查工作质量高。',
  '良': '整体评价基本客观，个别维度评分依据可以更充分，审查工作质量良好。',
  '中': '部分维度评分偏宽，退回原因描述不够具体，审查工作有待改进。',
  '差': '评分与报告质量明显不符，退回原因登记缺失，审查工作流于形式。'
};

/* [编号, 机构, 上报日期, 客户, 核额, 金额, 主调查, 辅调查, 第一责任, 审批人,
    sys, credit, asset, operate, purpose, guarantee, 退回1, 退回2, 审查评价, 状态] */
const RAW_RECORDS = [
  ['BG-2026-0801', 'ORG002', '2026-08-24', 'C001', '是', 1200, 'E2001', 'E2002', 'E2001', 'E1001', '良', '优', '良', '中', '优', '良', RETURN_TEXTS.r1, RETURN_TEXTS.r3, '', 'draft'],
  ['BG-2026-0802', 'ORG002', '2026-08-23', 'C002', '是', 680, 'E2002', 'E2001', 'E2001', 'E1001', '优', '良', '优', '良', '优', '良', '', '', '', 'pending_review'],
  ['BG-2026-0803', 'ORG003', '2026-08-22', 'C003', '是', 2350, 'E2003', 'E2004', 'E2003', 'E1001', '优', '优', '优', '优', '优', '优', '', '', '优', 'archived'],
  ['BG-2026-0804', 'ORG003', '2026-08-21', 'C004', '否', 450, 'E2004', 'E2003', 'E2003', 'E1004', '中', '良', '中', '中', '良', '中', RETURN_TEXTS.r3, RETURN_TEXTS.r5, '', 'returned'],
  ['BG-2026-0805', 'ORG004', '2026-08-20', 'C005', '是', 1560, 'E2005', 'E2002', 'E2005', 'E1001', '良', '良', '优', '良', '优', '良', '', '', '良', 'archived'],
  ['BG-2026-0806', 'ORG004', '2026-08-19', 'C006', '是', 320, 'E2005', '', 'E2005', 'E1004', '良', '中', '良', '中', '良', '良', RETURN_TEXTS.r4, '', '', 'returned'],
  ['BG-2026-0807', 'ORG005', '2026-08-18', 'C007', '是', 890, 'E2006', 'E2007', 'E2006', 'E1005', '优', '优', '良', '优', '优', '优', '', '', '优', 'archived'],
  ['BG-2026-0808', 'ORG005', '2026-08-17', 'C008', '否', 700, 'E2007', 'E2006', 'E2006', 'E1005', '中', '中', '良', '中', '中', '中', RETURN_TEXTS.r1, RETURN_TEXTS.r2, '', 'draft'],
  ['BG-2026-0809', 'ORG001', '2026-08-16', 'C009', '是', 3200, 'E2008', '', 'E2008', 'E1001', '优', '优', '优', '良', '优', '优', '', '', '优', 'archived'],
  ['BG-2026-0810', 'ORG001', '2026-08-15', 'C010', '是', 260, 'E2008', 'E2001', 'E2008', 'E1004', '良', '良', '中', '良', '良', '中', RETURN_TEXTS.r2, '', '', 'returned'],
  ['BG-2026-0811', 'ORG006', '2026-08-14', 'C011', '是', 1980, 'E2009', '', 'E2009', 'E1005', '优', '良', '优', '良', '优', '良', '', '', '良', 'archived'],
  ['BG-2026-0812', 'ORG006', '2026-08-13', 'C012', '是', 5600, 'E2009', 'E2007', 'E2009', 'E1001', '优', '优', '优', '优', '优', '良', '', '', '优', 'archived'],
  ['BG-2026-0813', 'ORG002', '2026-08-12', 'C002', '否', 500, 'E2002', '', 'E2001', 'E1005', '中', '良', '中', '良', '中', '良', RETURN_TEXTS.r5, '', '', 'draft'],
  ['BG-2026-0814', 'ORG003', '2026-08-11', 'C003', '是', 1750, 'E2003', 'E2004', 'E2003', 'E1004', '良', '优', '良', '优', '优', '良', '', '', '良', 'archived'],
  ['BG-2026-0815', 'ORG004', '2026-08-10', 'C005', '是', 940, 'E2005', '', 'E2005', 'E1001', '良', '良', '良', '中', '良', '良', RETURN_TEXTS.r4, '', '', 'returned'],
  ['BG-2026-0816', 'ORG005', '2026-08-09', 'C007', '是', 1120, 'E2006', 'E2007', 'E2006', 'E1001', '优', '良', '优', '良', '优', '优', '', '', '优', 'archived'],
  ['BG-2026-0817', 'ORG001', '2026-08-08', 'C009', '是', 2100, 'E2008', '', 'E2008', 'E1004', '优', '优', '良', '优', '优', '良', '', '', '优', 'archived'],
  ['BG-2026-0818', 'ORG002', '2026-08-07', 'C001', '是', 1600, 'E2001', 'E2002', 'E2001', 'E1005', '优', '优', '良', '优', '优', '优', '', '', '优', 'archived'],
  ['BG-2026-0819', 'ORG006', '2026-08-06', 'C012', '是', 4300, 'E2009', 'E2007', 'E2009', 'E1005', '优', '优', '优', '优', '优', '优', '', '', '优', 'archived'],
  ['BG-2026-0820', 'ORG003', '2026-08-05', 'C004', '否', 380, 'E2004', '', 'E2003', 'E1001', '差', '中', '中', '差', '中', '中', RETURN_TEXTS.r1, RETURN_TEXTS.r3, '', 'returned'],
  ['BG-2026-0821', 'ORG005', '2026-08-04', 'C008', '是', 760, 'E2007', 'E2006', 'E2006', 'E1004', '良', '良', '中', '良', '良', '中', '', '', '良', 'archived'],
  ['BG-2026-0822', 'ORG001', '2026-08-03', 'C010', '是', 430, 'E2008', 'E2001', 'E2008', 'E1001', '良', '中', '良', '中', '良', '良', RETURN_TEXTS.r2, '', '', 'returned'],
  ['BG-2026-0823', 'ORG004', '2026-08-02', 'C006', '是', 610, 'E2005', 'E2002', 'E2005', 'E1005', '良', '良', '良', '良', '优', '良', '', '', '良', 'archived'],
  ['BG-2026-0824', 'ORG002', '2026-08-01', 'C002', '是', 850, 'E2002', 'E2001', 'E2001', 'E1001', '优', '优', '优', '良', '优', '优', '', '', '优', 'archived']
];

function plusDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function seedIfEmpty() {
  const row = get('SELECT COUNT(*) AS n FROM employees');
  if (row.n > 0) return false;
  seed();
  return true;
}

function seed() {
  const ts = now();

  run('DELETE FROM op_logs');
  run('DELETE FROM sessions');
  run('DELETE FROM reports');
  run('DELETE FROM employee_roles');
  run('DELETE FROM employees');
  run('DELETE FROM customers');
  run('DELETE FROM orgs');
  run('DELETE FROM roles');

  for (const r of ROLE_PRESETS) {
    run('INSERT INTO roles (key, name, descr, perms, builtin, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      r.key, r.name, r.descr, JSON.stringify(r.perms), ts);
  }

  for (const o of ORGS) {
    run('INSERT INTO orgs (id, code, name, parent, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      o[0], o[1], o[2], o[3], o[4] || '启用', ts);
  }

  for (const e of EMPLOYEES) {
    const pwd = e[1] === '901003' ? 'admin123' : '123456';
    const { salt, hash } = hashPassword(pwd);
    run(`INSERT INTO employees (id, no, name, org_id, post, status, can_login, password_hash, salt, created_at)
         VALUES (?, ?, ?, ?, ?, '在职', ?, ?, ?, ?)`,
      e[0], e[1], e[2], e[3], e[4], e[6], hash, salt, ts);
    run('INSERT INTO employee_roles (employee_id, role_key) VALUES (?, ?)', e[0], e[5]);
  }

  for (const c of CUSTOMERS) {
    run(`INSERT INTO customers (id, no, name, industry, scale, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      c[0], c[1], c[2], c[3], c[4], ts);
  }

  for (const r of RAW_RECORDS) {
    const [id, orgId, date, cust, approved, amount, main, assist, first, reviewer,
      s1, s2, s3, s4, s5, s6, ret1, ret2, review, status] = r;
    const archived = status === 'archived';
    const submitTime = status === 'draft' ? null : plusDays(date, 1);
    const reviewTime = archived ? plusDays(date, 2) : null;
    run(`INSERT INTO reports (id, org_id, report_date, customer_id, approved, amount,
          main_investigator, assistant_investigator, first_responsible, reviewer,
          score_sys, score_credit, score_asset, score_operate, score_purpose, score_guarantee,
          return1, return2, return3, return4, review, review_comment, review_by, status,
          submit_time, review_time, archive_time, created_by, created_at, updated_at)
         VALUES (${Array(30).fill('?').join(', ')})`,
      id, orgId, date, cust, approved, amount, main, assist || null, first, reviewer,
      s1, s2, s3, s4, s5, s6,
      ret1 || null, ret2 || null, null, null,
      review || null, archived ? REVIEW_COMMENTS[review] : null, archived ? 'E1002' : null, status,
      submitTime, reviewTime, archived ? reviewTime : null, reviewer, ts, ts);

    if (submitTime) {
      log(id, reviewer, 'submit', '提交负责人审查', submitTime);
    }
    if (archived) {
      log(id, 'E1002', 'review', `审查评价「${review}」并归档`, reviewTime);
    }
  }

  console.log(`[seed] 演示数据已写入：${ORGS.length} 机构 / ${EMPLOYEES.length} 员工 / ${CUSTOMERS.length} 客户 / ${RAW_RECORDS.length} 笔台账`);
  ensureBuiltin();
}

/* 内置数据引导（幂等）：内置角色 + 超级管理员 admin（初始密码 123456，不可编辑/删除） */
function ensureBuiltin() {
  for (const r of ROLE_PRESETS) {
    if (!get('SELECT key FROM roles WHERE key = ?', r.key)) {
      run('INSERT INTO roles (key, name, descr, perms, builtin, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        r.key, r.name, r.descr, JSON.stringify(r.perms), now());
    }
  }
  /* 超级管理员角色固定为全部权限（存量库自愈） */
  const adminPreset = ROLE_PRESETS.find((r) => r.key === 'admin');
  const adminRole = get('SELECT perms FROM roles WHERE key = ?', 'admin');
  if (adminRole && adminRole.perms !== JSON.stringify(adminPreset.perms)) {
    run('UPDATE roles SET perms = ? WHERE key = ?', JSON.stringify(adminPreset.perms), 'admin');
  }
  if (!get('SELECT id FROM employees WHERE no = ?', 'admin')) {
    const { salt, hash } = hashPassword('123456');
    const id = nextPlainId('employees', 'E', 4);
    run(`INSERT INTO employees (id, no, name, post, status, can_login, password_hash, salt, created_at)
         VALUES (?, 'admin', '超级管理员', '系统管理员', '在职', 1, ?, ?, ?)`,
      id, hash, salt, now());
    run('INSERT INTO employee_roles (employee_id, role_key) VALUES (?, ?)', id, 'admin');
    console.log('[boot] 已创建内置超级管理员账号 admin（初始密码 123456）');
  }
}

function log(reportId, employeeId, action, detail, createdAt) {
  const emp = get('SELECT name FROM employees WHERE id = ?', employeeId);
  run('INSERT INTO op_logs (report_id, employee_id, employee_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    reportId, employeeId, emp ? emp.name : '系统', action, detail, createdAt || now());
}

if (require.main === module) {
  if (process.argv.includes('--reset')) {
    seed();
  } else {
    seedIfEmpty();
  }
}

module.exports = { seedIfEmpty, seed, ensureBuiltin, log };
