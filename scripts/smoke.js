/**
 * API 冒烟测试 —— 覆盖登录鉴权、权限边界、工作流闭环、统计聚合与 Excel 导入导出。
 * 运行：先启动服务（npm start），再执行 npm run smoke。
 */
'use strict';

const BASE = process.env.LR_BASE || 'http://localhost:3000';
const XLSX = require('xlsx');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else {
    failed += 1;
    failures.push(name + (extra ? ` :: ${JSON.stringify(extra).slice(0, 200)}` : ''));
    console.log(`  FAIL  ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 200) : ''}`);
  }
}

function client() {
  let cookie = '';
  return {
    async call(method, path, body, raw) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + path, {
        method,
        headers,
        body: raw ? body : (body !== undefined ? JSON.stringify(body) : undefined)
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
      return { status: res.status, data, headers: res.headers };
    }
  };
}

async function main() {
  const admin = client();
  const reviewer = client();
  const chief = client();
  const anon = client();

  console.log('\n== 1. 登录与鉴权 ==');
  let r = await anon.call('GET', '/api/reports');
  check('未登录访问台账返回 401', r.status === 401, r);

  r = await anon.call('POST', '/api/auth/login', { no: '901001', password: 'wrong' });
  check('错误密码返回 401', r.status === 401, r);

  r = await anon.call('POST', '/api/auth/login', { no: '902001', password: '123456' });
  check('客户经理账号未开放登录（403）', r.status === 403, r);

  r = await reviewer.call('POST', '/api/auth/login', { no: '901001', password: '123456' });
  check('审批人员登录成功', r.status === 200 && r.data.user.name === '陈明远', r.data);
  check('审批人员拥有 report:score 权限', r.data.user.perms.includes('report:score'));
  check('审批人员不含系统管理菜单', !JSON.stringify(r.data.user.menus).includes('sys-org'));

  r = await chief.call('POST', '/api/auth/login', { no: '901002', password: '123456' });
  check('审批负责人登录成功', r.status === 200 && r.data.user.perms.includes('report:review'));

  r = await admin.call('POST', '/api/auth/login', { no: '901003', password: 'admin123' });
  check('管理员登录成功', r.status === 200 && r.data.user.perms.includes('role:manage'));
  check('管理员包含全部系统管理菜单', JSON.stringify(r.data.user.menus).includes('sys-workflow'));
  check('登录响应附带待办数量', typeof r.data.counts === 'object');

  console.log('\n== 2. 台账查询 ==');
  r = await reviewer.call('GET', '/api/reports?pageSize=100');
  check('台账列表返回 24 条种子数据', r.status === 200 && r.data.total === 24, r.data.total);

  r = await reviewer.call('GET', '/api/reports?status=pending_review');
  check('按状态筛选待审查', r.status === 200 && r.data.items.every((i) => i.status === 'pending_review'));

  r = await reviewer.call('GET', '/api/reports?keyword=晨光');
  check('按客户名称关键字检索', r.status === 200 && r.data.items.every((i) => i.customerName.includes('晨光')));

  r = await reviewer.call('GET', '/api/reports?dateFrom=2026-08-10&dateTo=2026-08-15');
  check('按日期区间筛选', r.status === 200 && r.data.items.every((i) => i.report_date >= '2026-08-10' && i.report_date <= '2026-08-15'));

  const one = (await reviewer.call('GET', '/api/reports?status=archived&pageSize=1')).data.items[0];
  check('归档记录带报告得分与审查评价得分', one && typeof one.score === 'number' && typeof one.reviewScore === 'number', one);

  r = await reviewer.call('GET', `/api/reports/${one.id}`);
  check('详情含流程时间线', r.status === 200 && Array.isArray(r.data.timeline) && r.data.timeline.length >= 2);

  console.log('\n== 3. 工作流闭环（登记→提交→审查评价→归档）==');
  r = await reviewer.call('POST', '/api/reports', {
    orgId: 'ORG002', reportDate: '2026-08-28', customerId: 'C001', approved: '是',
    amount: 888, mainInvestigator: 'E2001', assistantInvestigator: 'E2002', firstResponsible: 'E2001'
  });
  const newId = r.data.id;
  check('登记草稿成功且编号自动生成', r.status === 200 && /^BG-\d{4}-\d{4}$/.test(newId), r.data);

  r = await reviewer.call('POST', `/api/reports/${newId}/submit`);
  check('六维未评分不允许提交', r.status === 400, r.data);

  r = await reviewer.call('PUT', `/api/reports/${newId}`, {
    sys: '优', credit: '良', asset: '良', operate: '中', purpose: '良', guarantee: '优',
    return1: '测试退回原因：缺少流水分析'
  });
  check('六维评分与退回原因保存', r.status === 200, r.data);

  r = await chief.call('POST', `/api/reports/${newId}/review`, { grade: '优', comment: 'x' });
  check('草稿状态负责人不能直接审查', r.status === 400, r.data);

  r = await reviewer.call('POST', `/api/reports/${newId}/submit`);
  check('提交负责人审查成功', r.status === 200, r.data);

  r = await reviewer.call('PUT', `/api/reports/${newId}`, { amount: 999 });
  check('提交后审批人员不可再修改', r.status === 400, r.data);

  r = await reviewer.call('POST', `/api/reports/${newId}/review`, { grade: '优', comment: '越权' });
  check('审批人员无权审查评价（403）', r.status === 403, r.data);

  r = await chief.call('POST', `/api/reports/${newId}/return`, { note: '用途维度评分依据不足，请复核' });
  check('负责人退回成功', r.status === 200, r.data);

  r = await reviewer.call('GET', `/api/reports/${newId}`);
  check('退回后状态为 returned 且带退回说明', r.data.item.status === 'returned' && r.data.item.return_note.includes('用途维度'));

  r = await reviewer.call('PUT', `/api/reports/${newId}`, { operate: '良' });
  check('退回后修改并自动回到草稿', r.status === 200);
  r = await reviewer.call('GET', `/api/reports/${newId}`);
  check('状态回到 draft', r.data.item.status === 'draft');

  await reviewer.call('POST', `/api/reports/${newId}/submit`);
  r = await chief.call('POST', `/api/reports/${newId}/review`, {
    grade: '良', comment: '评分基本客观，用途维度依据补充后已完善，审查工作质量良好。'
  });
  check('审查评价并自动归档', r.status === 200, r.data);

  r = await reviewer.call('GET', `/api/reports/${newId}`);
  check('归档后报告得分=六维平均，审查评价单列',
    r.data.item.score === 93.3 && r.data.item.reviewScore === 90,
    { score: r.data.item.score, reviewScore: r.data.item.reviewScore });

  console.log('\n== 4. 待办 / 已办 ==');
  r = await reviewer.call('GET', '/api/tasks?box=todo');
  check('审批人员待办含本人草稿', r.data.items.some((i) => i.id === newId) === false && r.status === 200);
  r = await reviewer.call('GET', '/api/tasks?box=done');
  check('审批人员已办包含刚归档记录', r.data.items.some((i) => i.id === newId), r.data.items.length);
  r = await chief.call('GET', '/api/tasks?box=todo');
  check('负责人待办为待审查列表', r.status === 200 && r.data.items.every((i) => i.status === 'pending_review'));
  r = await chief.call('GET', '/api/tasks?box=done');
  check('负责人已办包含本人审查归档记录', r.data.items.some((i) => i.id === newId));

  console.log('\n== 5. 统计 ==');
  r = await reviewer.call('GET', '/api/stats/summary');
  check('总览 KPI：审查笔数/平均得分/优良占比', r.status === 200 && r.data.count > 0 && typeof r.data.avgScore === 'number', r.data);

  for (const period of ['week', 'month', 'quarter', 'year']) {
    r = await reviewer.call('GET', `/api/stats/trend?period=${period}`);
    check(`趋势聚合（${period}）返回桶`, r.status === 200 && r.data.items.length > 0);
  }

  r = await reviewer.call('GET', '/api/stats/aggregate?groupBy=org');
  check('按机构聚合', r.status === 200 && r.data.items.length >= 6 && r.data.items[0].name.includes('支行') || r.data.items[0].name.includes('营业部'), r.data.items.slice(0, 2));
  r = await reviewer.call('GET', '/api/stats/aggregate?groupBy=manager');
  check('按客户经理聚合（含优良占比）', r.status === 200 && r.data.items.every((i) => typeof i.goodRate === 'number' || i.goodRate === null));
  r = await reviewer.call('GET', '/api/stats/aggregate?groupBy=reviewer');
  check('按审查人员聚合（含审查评价平均分）', r.status === 200 && r.data.items.every((i) => 'reviewAvg' in i), r.data.items[0]);

  r = await reviewer.call('GET', '/api/stats/dim-avg');
  check('六维均分返回 6 项', r.status === 200 && r.data.items.length === 6);

  console.log('\n== 6. 主数据与权限 ==');
  r = await reviewer.call('GET', '/api/orgs');
  check('审批人员无机构管理权限（403）', r.status === 403);
  r = await admin.call('GET', '/api/orgs');
  check('管理员查看机构列表', r.status === 200 && r.data.items.length === 8);

  r = await admin.call('POST', '/api/customers', { name: '冒烟测试客户有限公司', industry: '批发业', scale: '小型' });
  check('新增客户', r.status === 200, r.data);
  const custId = r.data.id;
  r = await admin.call('PUT', `/api/customers/${custId}`, { scale: '中型' });
  check('编辑客户', r.status === 200);

  r = await admin.call('POST', '/api/employees', {
    no: '901099', name: '冒烟审查员', orgId: 'ORG000', roleKeys: ['reviewer'], password: 'test123456'
  });
  check('新增员工并分配角色', r.status === 200, r.data);
  const smokeEmp = client();
  r = await smokeEmp.call('POST', '/api/auth/login', { no: '901099', password: 'test123456' });
  check('新员工可登录且具备角色权限', r.status === 200 && r.data.user.perms.includes('report:score'));

  r = await admin.call('GET', '/api/roles');
  check('角色列表含权限矩阵', r.data.items.length === 4 && Array.isArray(r.data.items[0].perms));
  const adminRole = r.data.items.find((x) => x.key === 'admin');
  const metaR = await admin.call('GET', '/api/meta');
  const totalPerms = metaR.data.permCatalog.reduce((a, g) => a + g.items.length, 0);
  check('超级管理员固定拥有全部权限', adminRole.perms.length === totalPerms, adminRole.perms.length);
  r = await admin.call('PUT', '/api/roles/admin/perms', { perms: ['menu:customer'] });
  check('超级管理员权限不可修改（403）', r.status === 403, r.data);
  r = await admin.call('PUT', '/api/roles/reviewer/perms', {
    perms: ['menu:report-list', 'menu:todo', 'menu:customer', 'menu:analytics',
      'report:read', 'report:create', 'report:score', 'report:submit',
      'customer:read', 'customer:manage', 'stats:read', 'excel:import', 'excel:export']
  });
  check('更新角色权限矩阵', r.status === 200);

  console.log('\n== 7. Excel 导入导出 ==');
  r = await reviewer.call('GET', '/api/excel/template', undefined, true);
  check('下载导入模板（xlsx 字节流）', r.status === 200 && r.data.byteLength > 1000);

  r = await reviewer.call('GET', '/api/excel/export/reports', undefined, true);
  check('导出台账（xlsx）', r.status === 200 && r.data.byteLength > 2000);
  const wb = XLSX.read(Buffer.from(r.data), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  check('导出台账表头与台账要素一致', JSON.stringify(rows[0].slice(1, 21)) === JSON.stringify([
    '经办机构', '上报日期', '客户名称', '是否核额', '授信金额（万元）', '主调查人', '辅助调查人', '第一责任人', '审批人',
    '系统操作质量', '信用情况分析质量', '资产负债分析质量', '经营情况分析质量', '用途情况分析质量', '担保情况分析质量',
    '第一次退回原因', '第二次退回原因', '第三次退回原因', '第四次退回原因', '审查评价']), rows[0]);

  r = await reviewer.call('GET', '/api/excel/export/stats?groupBy=reviewer', undefined, true);
  check('导出统计（xlsx）', r.status === 200 && r.data.byteLength > 1000);

  /* 构造导入文件：1 行有效（新客户+自动创建），1 行无效（机构不存在） */
  const header = ['经办机构', '上报日期', '客户名称', '是否核额', '授信金额（万元）', '主调查人', '辅助调查人', '第一责任人', '审批人',
    '系统操作质量', '信用情况分析质量', '资产负债分析质量', '经营情况分析质量', '用途情况分析质量', '担保情况分析质量',
    '第一次退回原因', '第二次退回原因', '第三次退回原因', '第四次退回原因', '审查评价'];
  const okRow = ['城东支行', '2026-08-29', '导入测试客户股份有限公司', '是', 660, '李文博', '王思远', '李文博', '陈明远',
    '优', '良', '优', '良', '优', '良', '', '', '', '', ''];
  const badRow = ['不存在机构', '2026-08-29', '某客户', '是', 100, '李文博', '', '李文博', '陈明远',
    '优', '良', '优', '良', '优', '良', '', '', '', '', ''];
  const wsImp = XLSX.utils.aoa_to_sheet([header, okRow, badRow]);
  const wbImp = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbImp, wsImp, '导入');
  const importBuf = XLSX.write(wbImp, { type: 'buffer', bookType: 'xlsx' });

  r = await reviewer.call('POST', '/api/excel/import?autoCreateCustomer=1', importBuf, true);
  check('导入：1 行成功 1 行被跳过并给出原因', r.status === 200 && r.data.imported === 1 && r.data.skipped.length === 1 && r.data.skipped[0].reason.includes('机构'), r.data);

  r = await reviewer.call('GET', '/api/reports?keyword=导入测试客户');
  check('导入的记录已入台账（草稿状态）', r.data.total === 1 && r.data.items[0].status === 'draft', r.data);
  check('导入时自动创建了客户', r.data.items[0].customerName === '导入测试客户股份有限公司');

  r = await reviewer.call('POST', '/api/excel/import?autoCreateCustomer=1', importBuf, true);
  check('重复导入被去重跳过', r.data.imported === 0 && r.data.skipped.length === 2
    && r.data.skipped[0].reason.includes('重复') && r.data.skipped[1].reason.includes('机构'), r.data);

  /* 员工批量导入：1 行有效，1 行工号重复，1 行机构不存在 */
  r = await reviewer.call('GET', '/api/excel/employee-template', undefined, true);
  check('审批人员无员工导入模板权限（403）', r.status === 403);
  r = await admin.call('GET', '/api/excel/employee-template', undefined, true);
  check('下载员工导入模板（xlsx 字节流）', r.status === 200 && r.data.byteLength > 1000);

  const empHeader = ['工号', '姓名', '所属机构', '岗位', '角色', '登录权限'];
  const empRows = [
    ['904001', '批量导入员工甲', '城东支行', '客户经理', '客户经理', '否'],
    ['901001', '重复工号员工', '城东支行', '客户经理', '客户经理', '否'],
    ['904002', '批量导入员工乙', '不存在机构', '客户经理', '客户经理', '是']
  ];
  const wsEmp = XLSX.utils.aoa_to_sheet([empHeader, ...empRows]);
  const wbEmp = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbEmp, wsEmp, '员工');
  const empBuf = XLSX.write(wbEmp, { type: 'buffer', bookType: 'xlsx' });

  r = await admin.call('POST', '/api/excel/import-employees', empBuf, true);
  check('员工导入：1 行成功 2 行被跳过并给出原因', r.status === 200 && r.data.imported === 1
    && r.data.skipped.length === 2 && r.data.skipped[0].reason.includes('已存在')
    && r.data.skipped[1].reason.includes('机构'), r.data);

  r = await admin.call('GET', '/api/employees');
  const impEmp = r.data.items.find((e) => e.no === '904001');
  check('导入的员工已入主数据（含角色）', !!impEmp && (impEmp.roleKeys || []).includes('manager')
    && (impEmp.roleNames || '').includes('客户经理'), impEmp);

  /* 内置超级管理员 admin */
  const anonClient = client();
  r = await anonClient.call('POST', '/api/auth/login', { no: 'admin', password: '123456' });
  check('内置 admin 账号可登录且具备管理员权限', r.status === 200 && r.data.user.perms.includes('role:manage'), r.data);
  const builtinId = r.data.user.id;
  r = await admin.call('PUT', `/api/employees/${builtinId}`, { name: '改名测试' });
  check('内置账号不可编辑（403）', r.status === 403, r.data);
  r = await admin.call('POST', `/api/employees/${builtinId}/reset-password`, { password: 'x' });
  check('内置账号不可重置密码（403）', r.status === 403, r.data);

  /* 机构 / 员工删除与关联检测 */
  r = await admin.call('DELETE', '/api/orgs/ORG002');
  check('删除有员工的机构被拒绝', r.status === 400 && r.data.error.includes('员工'), r.data);
  r = await admin.call('POST', '/api/orgs', { code: '999999', name: '待删除机构' });
  const delOrgId = r.data.id;
  r = await admin.call('DELETE', `/api/orgs/${delOrgId}`);
  check('删除无关联机构成功', r.status === 200, r.data);
  r = await admin.call('DELETE', '/api/employees/E1001');
  check('删除已关联台账的员工被拒绝', r.status === 400 && r.data.error.includes('台账'), r.data);
  r = await admin.call('DELETE', `/api/employees/${builtinId}`);
  check('内置账号不可删除（403）', r.status === 403, r.data);

  /* 台账查看（仅本人经办）：客户经理按主调查人、审批人员按审批人 */
  r = await admin.call('PUT', '/api/roles/reviewer/perms', { perms: ['menu:report-list', 'menu:todo', 'menu:customer', 'menu:analytics',
    'report:read:self', 'report:create', 'report:score', 'report:submit', 'customer:read', 'customer:manage', 'stats:read', 'excel:import', 'excel:export'] });
  const lwb = client();
  r = await admin.call('PUT', '/api/employees/E2001', { name: '李文博', orgId: 'ORG002', post: '客户经理（高级）', roleKeys: ['manager'], canLogin: true, status: '在职' });
  r = await lwb.call('POST', '/api/auth/login', { no: '902001', password: '123456' });
  check('李文博（客户经理角色）可登录', r.status === 200, r.data);
  r = await admin.call('GET', '/api/reports?mainInvestigatorId=E2001');
  const asMain = r.data.total;
  r = await lwb.call('GET', '/api/reports');
  check('仅本人经办（客户经理）：仅见本人主调查的台账', r.data.total === asMain
    && r.data.items.every((i) => i.mainInvestigatorName === '李文博'), r.data.total + '/' + asMain);
  r = await lwb.call('GET', '/api/stats/summary');
  check('统计仅本人相关（客户经理）：与本人主调查台账数一致', r.data.count === asMain, r.data.count + '/' + asMain);
  r = await admin.call('PUT', '/api/employees/E2001', { name: '李文博', orgId: 'ORG002', post: '客户经理（高级）', roleKeys: ['reviewer'], canLogin: true, status: '在职' });
  r = await admin.call('GET', '/api/reports?reviewerId=E2001');
  const asRev = r.data.total;
  r = await lwb.call('GET', '/api/reports');
  check('仅本人经办（审批人员）：仅见本人审批的台账', r.data.total === asRev, r.data.total + '/' + asRev);
  r = await admin.call('PUT', '/api/roles/reviewer/perms', { perms: ['menu:report-list', 'menu:todo', 'menu:customer', 'menu:analytics',
    'report:read', 'report:create', 'report:score', 'report:submit', 'customer:read', 'customer:manage', 'stats:read', 'excel:import', 'excel:export'] });
  check('审批人员角色权限已还原', r.status === 200, r.data);

  console.log('\n== 8. 收尾 ==');
  r = await admin.call('DELETE', `/api/reports/${newId}`);
  check('已归档记录不可删除', r.status === 400);
  r = await reviewer.call('POST', '/api/auth/logout');
  check('退出登录', r.status === 200);
  r = await reviewer.call('GET', '/api/auth/me');
  check('登出后会话失效（401）', r.status === 401);

  console.log(`\n========== 冒烟结果：${passed} 通过 / ${failed} 失败 ==========`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
