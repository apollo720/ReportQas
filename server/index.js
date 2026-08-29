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

/* 首次启动灌入演示数据 */
if (seedIfEmpty()) {
  console.log('[boot] 首次启动，已灌入演示数据');
}

/* 内置引导：内置角色 + 超级管理员 admin（幂等，缺失时自动补齐，初始密码 123456） */
ensureBuiltin();

/* API 路由 */
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
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
app.use(express.static(WEB_DIR, {
  index: 'index.html',
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

/* 非 API 的 GET 回退到 index.html（hash 路由其实用不到，兜底直达刷新） */
app.get('*', (req, res) => res.sendFile(path.join(WEB_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`[boot] 贷款调查报告质量评价系统已启动: http://localhost:${PORT}`);
});
