/**
 * GUI 走查测试 —— 使用系统 Chrome（playwright-core 驱动）按角色走查全流程并截图。
 * 运行前提：npm start 已启动、数据已重置（npm run seed）。
 * 产物：.gui/*.png 截图 + 控制台错误清单 + 断言结果。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, '..', '.gui');
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}

async function gotoHash(page, hash) {
  await page.goto(BASE + '/#' + hash);
  await page.waitForTimeout(600);
}

async function login(page, no, pwd) {
  await page.goto(BASE + '/#/');
  /* 强制清会话并整页刷新，确保从已登录状态切换账号时回到登录页 */
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}));
  await page.reload();
  await page.waitForSelector('.login', { timeout: 8000 });
  await page.fill('input[placeholder="请输入工号"]', no);
  await page.fill('input[placeholder="请输入密码"]', pwd);
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 8000 });
  await page.waitForTimeout(700);
}

async function uiLogout(page) {
  await page.hover('.app-header__user');
  await page.waitForTimeout(300);
  await page.click('.t-dropdown__menu >> text=退出登录');
  await page.waitForTimeout(300);
  await page.click('.t-dialog button:has-text("退出")');
  await page.waitForSelector('.login', { timeout: 8000 });
}

async function apiLogout(page) {
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
}

async function pickGradeInCard(page, cardText, grade) {
  const card = page.locator('.card', { hasText: cardText }).first();
  await card.locator('.grade-picker button', { hasText: grade }).first().click();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  page.on('console', (m) => {
    /* 登录态探测（/api/auth/me）与主动清会话的 401 属预期行为，不算错误 */
    if (m.type() !== 'error') return;
    if (m.text().includes('401')) return;
    consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

  /* ---------- 1. 登录页 ---------- */
  console.log('\n== 登录页 ==');
  await page.goto(BASE + '/#/');
  await page.waitForSelector('.login', { timeout: 10000 });
  await page.waitForTimeout(500);
  check('登录页渲染', await page.locator('.login__panel').count() === 1);
  await shot(page, '01-login');

  /* ---------- 2. 审批人员：工作台 + 台账 + 评分提交 ---------- */
  console.log('\n== 审批人员（陈明远）==');
  await login(page, '901001', '123456');
  check('工作台 KPI 渲染', await page.locator('.kpi-grid .kpi').count() >= 4);
  await shot(page, '02-dashboard-reviewer');

  await gotoHash(page, '/report-list');
  await page.waitForSelector('.t-table', { timeout: 8000 });
  await page.waitForTimeout(600);
  const rowText = await page.locator('.t-table').first().textContent();
  check('台账包含种子记录 BG-2026-0801', rowText.includes('BG-2026-0801'));
  await shot(page, '03-report-list-reviewer');

  /* 打开草稿记录评分提交 */
  const draftRow = page.locator('.t-table tr', { hasText: 'BG-2026-0801' }).first();
  await draftRow.locator('a:has-text("详情"), a:has-text("去评价"), .t-link').first().click();
  await page.waitForSelector('.dim-row', { timeout: 8000 });
  await page.waitForTimeout(400);
  check('详情页六维评分器渲染', await page.locator('.dim-row .grade-picker').count() === 6);
  await shot(page, '04-report-detail-draft');

  /* 六维评分：优/良/优/良/良/优 */
  const grades = ['优', '良', '优', '良', '良', '优'];
  for (let i = 0; i < 6; i++) {
    await page.locator('.dim-row').nth(i).locator('.grade-picker button', { hasText: grades[i] }).first().click();
  }
  await page.locator('textarea').nth(0).fill('GUI 走查：第一次退回原因测试——请补充近一年流水明细及大额进出说明。');
  await page.waitForTimeout(300);
  const scoreText = await page.locator('.card', { hasText: '分析质量评分' }).first().textContent();
  check('报告得分实时计算（六维平均 95）', scoreText.includes('95'));
  await shot(page, '05-report-scored');

  await page.click('button:has-text("提交负责人审查")');
  await page.waitForTimeout(800);
  check('提交后状态变为待负责人审查', (await page.locator('.page-header').textContent()).includes('待负责人审查'));
  await shot(page, '06-submitted-pending-review');

  /* ---------- 3. 审批负责人：待办 → 审查评价 → 归档 ---------- */
  console.log('\n== 审批负责人（周涛）==');
  await uiLogout(page);
  await login(page, '901002', '123456');
  const chiefDash = await page.locator('.welcome').textContent();
  check('负责人工作台提示待审查', chiefDash.includes('待您审查'));
  await shot(page, '07-dashboard-chief');

  await gotoHash(page, '/todo');
  await page.waitForTimeout(600);
  const todoRow = page.locator('.t-table tr', { hasText: 'BG-2026-0801' }).first();
  check('待办列表包含刚提交的记录', await todoRow.count() === 1);
  await shot(page, '08-todo-chief');

  await todoRow.locator('.t-link').first().click();
  await page.waitForSelector('.grade-picker', { timeout: 8000 });
  await page.waitForTimeout(400);
  const reviewCard = page.locator('.card', { hasText: '审查评价' }).first();
  check('审查评价区标注评价对象（审批人）', (await reviewCard.getAttribute('class')) !== null &&
    (await page.locator('.app-content').textContent()).includes('陈明远'));
  await shot(page, '09-review-card-chief');

  await pickGradeInCard(page, '审查评价等级', '良');
  await page.locator('.card', { hasText: '审查评价等级' }).locator('textarea').fill('GUI 走查：六维评分总体客观，用途维度已补充依据，审查工作质量良好，同意归档。');
  await page.click('button:has-text("完成审查并归档")');
  await page.waitForTimeout(900);
  check('归档后状态为已归档', (await page.locator('.page-header').textContent()).includes('已归档'));
  const timeline = await page.locator('.card', { hasText: '流转记录' }).textContent();
  check('流转记录包含审查评价动作', timeline.includes('审查评价'));
  await shot(page, '10-archived-with-timeline');

  /* ---------- 4. 统计分析 ---------- */
  console.log('\n== 统计分析 ==');
  await gotoHash(page, '/analytics');
  await page.waitForTimeout(1200);
  check('ECharts 图表渲染（canvas）', await page.locator('.chart canvas').count() >= 4);
  await shot(page, '11-analytics-org');

  /* 切换统计对象为按审查人员 */
  await page.locator('input.t-input__inner').first().click();
  await page.waitForTimeout(400);
  await page.click('.t-select-option:has-text("按审查人员统计")');
  await page.waitForTimeout(1000);
  check('按审查人员统计包含审查评价列', (await page.locator('.app-content').textContent()).includes('审查评价平均'));
  await shot(page, '12-analytics-reviewer');

  /* ---------- 5. 超级管理员：系统管理 ---------- */
  console.log('\n== 超级管理员（郑立群）==');
  await apiLogout(page);
  await login(page, '901003', 'admin123');
  await gotoHash(page, '/sys-org');
  await page.waitForTimeout(700);
  check('机构管理列表渲染', (await page.locator('.app-content').textContent()).includes('城东支行'));
  await shot(page, '13-sys-org');

  await gotoHash(page, '/sys-employee');
  await page.waitForTimeout(700);
  check('员工管理列表渲染', (await page.locator('.app-content').textContent()).includes('陈明远'));
  await shot(page, '14-sys-employee');

  await gotoHash(page, '/sys-role');
  await page.waitForTimeout(700);
  check('权限矩阵渲染', await page.locator('.perm-matrix').count() === 1);
  await shot(page, '15-sys-role');

  await gotoHash(page, '/sys-workflow');
  await page.waitForTimeout(700);
  check('工作流在途实例渲染', (await page.locator('.app-content').textContent()).includes('在途流程实例'));
  await shot(page, '16-sys-workflow');

  /* 导入对话框 */
  await gotoHash(page, '/report-list');
  await page.waitForTimeout(700);
  await page.click('button:has-text("导入台账")');
  await page.waitForTimeout(500);
  check('导入对话框渲染', (await page.locator('.t-dialog:has-text("导入评价台账")').textContent()).includes('导入评价台账'));
  await shot(page, '17-import-dialog');
  await page.keyboard.press('Escape');

  /* ---------- 6. 权限边界：审批人员无系统管理菜单 ---------- */
  console.log('\n== 权限边界 ==');
  await apiLogout(page);
  await login(page, '901001', '123456');
  const menuText = await page.locator('.app-aside__menu').textContent();
  check('审批人员菜单不含系统管理', !menuText.includes('机构管理') && !menuText.includes('角色与权限'));
  check('审批人员菜单含评价台账与待办', menuText.includes('评价台账') && menuText.includes('待办 / 已办'));
  await shot(page, '18-reviewer-menu');

  await browser.close();

  console.log(`\n========== GUI 走查：${passed} 通过 / ${failed} 失败 ==========`);
  if (consoleErrors.length) {
    console.log('浏览器控制台错误（' + consoleErrors.length + '）：');
    consoleErrors.slice(0, 10).forEach((e) => console.log('  - ' + e));
  } else {
    console.log('浏览器控制台无错误');
  }
  process.exit(failed || consoleErrors.length ? 1 : 0);
})().catch((e) => { console.error('GUI 测试异常:', e); process.exit(1); });
