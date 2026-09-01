/**
 * 服务入口 —— Express 托管前端静态资源 + API 路由
 * 启动：npm start（首次启动自动灌入演示数据）
 */
'use strict';

const path = require('path');
const express = require('express');
const { seedIfEmpty, ensureBuiltin } = require('./seed');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_DIR = path.join(__dirname, '..', 'web');

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

/* 演示数据：默认空库时灌入；生产部署设 LR_SEED_DEMO=0 跳过（内置角色与 admin 账号仍自动创建） */
if (process.env.LR_SEED_DEMO !== '0' && seedIfEmpty()) {
  console.log('[boot] 首次启动，已灌入演示数据');
}

/* 内置引导：内置角色 + 超级管理员 admin（幂等，缺失时自动补齐，初始密码 123456） */
ensureBuiltin();

/* API 路由 */
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now(), demo: process.env.LR_SEED_DEMO !== '0', version: APP_VERSION }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/meta'));
app.use('/api', require('./routes/master'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/tasks').router);
app.use('/api', require('./routes/stats'));
app.use('/api', require('./routes/excel'));
app.use('/api', require('./routes/workflow'));

/* 前端静态资源（vendor 已本地化，内网离线可用）
   缓存策略：HTML 与业务 css/js 用协商缓存（更新即时生效，未变更走 304）；
   vendor 第三方库内容不变，长缓存。避免发版后浏览器仍用旧样式。 */
/* 静态资源版本化：给 index.html 内的本地资源 URL 追加 ?v=版本号，
   发版后浏览器强制拉取新文件（vendor 为一年强缓存，靠版本号失效，避免图标/样式坏缓存） */
const fs = require('fs');
const { version: APP_VERSION } = require('../package.json');
function sendIndex(res) {
  const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
    .replace(/(src|href)="(assets\/[^"]+)"/g, `$1="$2?v=${APP_VERSION}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(html);
}

app.use(express.static(WEB_DIR, {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.includes(path.join('assets', 'vendor'))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

/* API 404 与错误兜底 */
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器内部错误' });
});

/* 非 API 的 GET 回退到 index.html（hash 路由其实用不到，兜底直达刷新）；
   带文件扩展名的请求说明是缺失的静态资源（如 .map），返回 404 而非 HTML */
app.get('*', (req, res) => {
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).end();
  sendIndex(res);
});

app.listen(PORT, () => {
  console.log(`[boot] 贷款调查报告质量评价系统已启动: http://localhost:${PORT}`);
});
