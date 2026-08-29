/**
 * 工作流管理 —— 流程定义 + 在途实例（停留天数）+ 各状态统计
 */
'use strict';

const express = require('express');
const { all } = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { WORKFLOW } = require('../constants');
const { serialize } = require('../report-util');

const router = express.Router();
router.use(requireAuth, requirePerm('workflow:manage'));

router.get('/workflow', (req, res) => {
  const nowMs = Date.now();
  const dwell = (t) => t ? Math.max(0, Math.floor((nowMs - new Date(t.replace(' ', 'T') + 'Z').getTime()) / 86400e3)) : 0;

  const pending = all(`SELECT * FROM reports WHERE status = 'pending_review' ORDER BY submit_time`)
    .map(serialize)
    .map((r) => ({ ...r, dwellDays: dwell(r.submit_time) }));
  const returned = all(`SELECT * FROM reports WHERE status = 'returned' ORDER BY updated_at DESC`)
    .map(serialize);
  const archived = all(`SELECT * FROM reports WHERE status = 'archived' ORDER BY archive_time DESC LIMIT 20`)
    .map(serialize);

  res.json({
    definition: WORKFLOW,
    stats: {
      pending_review: pending.length,
      returned: returned.length,
      archived: archived.length,
      draft: all(`SELECT COUNT(*) AS n FROM reports WHERE status = 'draft'`)[0].n
    },
    instances: { pending, returned, archived }
  });
});

module.exports = router;
