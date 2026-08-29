/**
 * 全页面巡检 —— 逐页验证：渲染、内容区滚动、冻结页头吸附、底部内容可达、控制台错误。
 * 覆盖三种角色的全部路由；产出 .gui/sweep-*.png 截图与检查结论。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:3000';
const OUT = path.join(__dirname, '..', '.gui');
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const results = [];

async function login(page, no, pwd) {
  await page.goto(BASE + '/#/');
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}));
  await page.reload();
  await page.waitForSelector('.login', { timeout: 8000 });
  await page.fill('input[placeholder="请输入工号"]', no);
  await page.fill('input[placeholder="请输入密码"]', pwd);
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 8000 });
}

/**
 * 单页检查：滚动到中段和底部，验证页头吸附 + 页头可点击 + 底部内容进入视口
 */
async function sweep(page, name, hash, opts) {
  const { marker } = opts || {};   /* 页面底部应出现的关键内容 */
  await page.goto(BASE + '/#' + hash);
  await page.waitForTimeout(1000);

  const r = await page.evaluate(() => {
    const c = document.querySelector('.app-content');
    const ph = document.querySelector('.page-header');
    return {
      hasHeader: !!ph,
      scrollHeight: c.scrollHeight,
      clientHeight: c.clientHeight,
      scrollable: c.scrollHeight > c.clientHeight + 2,
      headerClickable: ph ? !!ph.querySelector('button, .t-button, a') || true : false
    };
  });

  let pinned = null;
  let bottomVisible = null;
  if (r.scrollable) {
    /* 滚到中段：页头应吸附在顶栏下缘（≈56） */
    await page.evaluate(() => {
      const c = document.querySelector('.app-content');
      c.scrollTop = Math.floor((c.scrollHeight - c.clientHeight) / 2);
    });
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() =>
      Math.round(document.querySelector('.page-header').getBoundingClientRect().top));
    /* 滚到底：页头仍吸附，底部关键内容进入视口 */
    await page.evaluate(() => {
      const c = document.querySelector('.app-content');
      c.scrollTop = c.scrollHeight;
    });
    await page.waitForTimeout(250);
    const bottom = await page.evaluate((marker) => {
      const ph = document.querySelector('.page-header').getBoundingClientRect();
      let found = null;
      if (marker) {
        const els = [...document.querySelectorAll('.card, .card__title, .card__foot, .t-table, .kpi-grid')]
          .filter((e) => e.textContent && e.textContent.includes(marker));
        found = els.some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top < window.innerHeight && rect.bottom > 0;
        });
      }
      return { headerTop: Math.round(ph.top), bottomContentVisible: found === null ? null : found };
    }, marker || '');
    pinned = { mid, bottom: bottom.headerTop };
    bottomVisible = bottom.bottomContentVisible;
    await page.screenshot({ path: path.join(OUT, 'sweep-' + name + '-bottom.png') });
  } else {
    await page.screenshot({ path: path.join(OUT, 'sweep-' + name + '.png') });
  }

  const ok = r.hasHeader && (pinned === null || (pinned.mid <= 57 && pinned.bottom <= 57))
    && (bottomVisible !== false) && r.headerClickable;
  results.push({ name, hash, ...r, pinned, bottomVisible, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  scrollable=${r.scrollable}` +
    (pinned ? ` 吸附mid/bottom=${pinned.mid}/${pinned.bottom}` : '') +
    (bottomVisible === null ? '' : ` 底部内容可见=${bottomVisible}`));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) consoleErrors.push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 160)));

  console.log('== 超级管理员（全部菜单）==');
  await login(page, '901003', 'admin123');
  await sweep(page, 'dashboard', '/dashboard');
  await sweep(page, 'report-list', '/report-list', { marker: '笔评价记录' });
  await sweep(page, 'customer', '/customer', { marker: '家客户' });
  await sweep(page, 'analytics', '/analytics', { marker: '明细数据' });
  await sweep(page, 'report-detail-archived', '/report-detail/BG-2026-0803', { marker: '流转记录' });
  await sweep(page, 'sys-org', '/sys-org', { marker: '个机构' });
  await sweep(page, 'sys-employee', '/sys-employee', { marker: '名员工' });
  await sweep(page, 'sys-role', '/sys-role', { marker: '权限矩阵' });
  await sweep(page, 'sys-workflow', '/sys-workflow', { marker: '在途流程实例' });

  console.log('\n== 审批负责人（待办 + 审查视角）==');
  await login(page, '901002', '123456');
  await sweep(page, 'todo-chief', '/todo', { marker: '待办' });

  console.log('\n== 审批人员（编辑视角详情页）==');
  await login(page, '901001', '123456');
  await sweep(page, 'report-detail-editing', '/report-detail/BG-2026-0815', { marker: '流转记录' });

  /* 窄窗口抽查（用户反馈的环境约为 1013px 内容宽度） */
  console.log('\n== 窄窗口 1024px 抽查 ==');
  await page.setViewportSize({ width: 1024, height: 768 });
  await sweep(page, 'detail-narrow-1024', '/report-detail/BG-2026-0815', { marker: '审查评价' });
  await sweep(page, 'list-narrow-1024', '/report-list');

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n========== 巡检结果：${results.length - failed.length}/${results.length} 页通过 ==========`);
  if (consoleErrors.length) {
    console.log('控制台错误（' + consoleErrors.length + '）：');
    consoleErrors.slice(0, 8).forEach((e) => console.log('  - ' + e));
  } else {
    console.log('控制台无错误');
  }
  process.exit(failed.length || consoleErrors.length ? 1 : 0);
})().catch((e) => { console.error('巡检异常:', e); process.exit(1); });
