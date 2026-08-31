/**
 * 前端字典层 —— 质量等级 / 评价维度 / 状态 / 工作流定义 + 客户端得分试算
 * 与 server/constants.js 保持同口径；权限目录与菜单由服务端下发。
 */
(function (global) {
  'use strict';

  var GRADES = [
    { key: '优', score: 90, theme: 'brand' },
    { key: '良', score: 80, theme: 'success' },
    { key: '中', score: 70, theme: 'warning' },
    { key: '差', score: 50, theme: 'danger' }
  ];

  var GRADE_MAP = GRADES.reduce(function (acc, g) { acc[g.key] = g; return acc; }, {});

  var DIMENSIONS = [
    { key: 'sys', label: '系统操作质量', tip: '信贷系统录入完整性、影像资料上传规范性' },
    { key: 'credit', label: '信用情况分析质量', tip: '征信解读、历史履约与他行负债分析' },
    { key: 'asset', label: '资产负债分析质量', tip: '资产构成、负债结构与偿债能力测算' },
    { key: 'operate', label: '经营情况分析质量', tip: '行业周期、经营模式与持续经营能力' },
    { key: 'purpose', label: '用途情况分析质量', tip: '贷款用途真实性、贸易背景佐证' },
    { key: 'guarantee', label: '担保情况分析质量', tip: '保证人资信、抵质押物估值与变现能力' }
  ];

  var STATUS_MAP = {
    draft: { label: '草稿（待评价）', theme: 'default' },
    pending_review: { label: '待负责人审查', theme: 'primary' },
    returned: { label: '已退回修改', theme: 'warning' },
    archived: { label: '已归档', theme: 'success' }
  };

  /* 报告得分 = 六维平均（优90/良80/中70/差50）；审查评价单列，不并入
     入参兼容两种形态：{sys,credit,...} 或台账记录 {score_sys,...} */
  function calcReportScore(obj) {
    if (!obj) return null;
    var sum = 0, n = 0;
    DIMENSIONS.forEach(function (d) {
      var v = obj['score_' + d.key] !== undefined ? obj['score_' + d.key] : obj[d.key];
      var g = v && GRADE_MAP[v];
      if (g) { sum += g.score; n += 1; }
    });
    return n ? Math.round((sum / n) * 10) / 10 : null;
  }

  function scoreToGrade(score) {
    if (score === null || score === undefined) return '';
    if (score >= 85) return '优';
    if (score >= 75) return '良';
    if (score >= 65) return '中';
    return '差';
  }

  function returnCount(returns) {
    return (returns || []).filter(function (t) { return !!t; }).length;
  }

  function fmtAmount(v) {
    return (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString();
  }

  /* 时间戳统一以 UTC ISO 存储（Z 后缀），展示时换算为浏览器本地时区 */
  function fmtDateTime(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s).replace('T', ' ').slice(0, 16);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  global.LRDICT = {
    GRADES: GRADES,
    GRADE_MAP: GRADE_MAP,
    REVIEW_SCORES: { '优': 90, '良': 80, '中': 70, '差': 50 },
    DIMENSIONS: DIMENSIONS,
    STATUS_MAP: STATUS_MAP,
    GOOD_LINE: 90,
    calcReportScore: calcReportScore,
    scoreToGrade: scoreToGrade,
    returnCount: returnCount,
    fmtAmount: fmtAmount,
    fmtDateTime: fmtDateTime
  };
})(window);
