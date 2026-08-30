/**
 * 元数据路由 —— 枚举字典 + 下拉引用数据（登录即可读，供表单与筛选使用）
 */
'use strict';

const express = require('express');
const { all } = require('../db');
const {
  GRADES, DIMENSIONS, STATUS_MAP, PERM_CATALOG, WORKFLOW
} = require('../constants');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/meta', requireAuth, (req, res) => {
  res.json({
    grades: GRADES,
    dimensions: DIMENSIONS,
    statusMap: STATUS_MAP,
    permCatalog: PERM_CATALOG,
    workflow: WORKFLOW,
    orgs: all('SELECT id, code, name, status FROM orgs ORDER BY code'),
    employees: all(`SELECT id, no, name, org_id AS orgId, post, status FROM employees ORDER BY no`),
    customers: all(`SELECT id, no, name FROM customers ORDER BY no`)
  });
});

module.exports = router;
