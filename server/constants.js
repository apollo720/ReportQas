/**
 * 业务常量 —— 质量等级、评价维度、权限目录、菜单定义、角色预设
 * 前端通过 /api/meta 获取枚举，通过 /api/auth/me 获取过滤后的菜单。
 */
'use strict';

/* 质量四档：优 100 / 良 90 / 中 80 / 差 70 */
const GRADES = [
  { key: '优', score: 100, theme: 'brand' },
  { key: '良', score: 90, theme: 'success' },
  { key: '中', score: 80, theme: 'warning' },
  { key: '差', score: 70, theme: 'danger' }
];
const GRADE_MAP = Object.fromEntries(GRADES.map((g) => [g.key, g]));

/* 六项分析质量维度（对应台账要素，考核客户经理的调查报告） */
const DIMENSIONS = [
  { key: 'sys', label: '系统操作质量', tip: '信贷系统录入完整性、影像资料上传规范性' },
  { key: 'credit', label: '信用情况分析质量', tip: '征信解读、历史履约与他行负债分析' },
  { key: 'asset', label: '资产负债分析质量', tip: '资产构成、负债结构与偿债能力测算' },
  { key: 'operate', label: '经营情况分析质量', tip: '行业周期、经营模式与持续经营能力' },
  { key: 'purpose', label: '用途情况分析质量', tip: '贷款用途真实性、贸易背景佐证' },
  { key: 'guarantee', label: '担保情况分析质量', tip: '保证人资信、抵质押物估值与变现能力' }
];

/* 台账状态 */
const STATUS_MAP = {
  draft: { label: '草稿（待评价）', theme: 'default' },
  pending_review: { label: '待负责人审查', theme: 'primary' },
  returned: { label: '已退回修改', theme: 'warning' },
  archived: { label: '已归档', theme: 'success' }
};

/* 报告得分 = 六维平均；优良 = 得分 ≥ 90（考核客户经理报告质量）
   审查评价单列（考核审批人员的审查工作质量） */
const GOOD_SCORE_LINE = 90;

function reportScore(rec) {
  const cols = ['sys', 'credit', 'asset', 'operate', 'purpose', 'guarantee'];
  let sum = 0;
  let n = 0;
  for (const c of cols) {
    const g = rec['score_' + c] && GRADE_MAP[rec['score_' + c]];
    if (g) { sum += g.score; n += 1; }
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

/* 权限目录：菜单级 + 动作级（admin 在角色与权限页编辑矩阵） */
const PERM_CATALOG = [
  { group: '菜单', items: [
    { key: 'menu:report-list', label: '菜单：评价台账' },
    { key: 'menu:todo', label: '菜单：待办/已办' },
    { key: 'menu:customer', label: '菜单：客户信息' },
    { key: 'menu:analytics', label: '菜单：统计分析' },
    { key: 'menu:sys-org', label: '菜单：机构管理' },
    { key: 'menu:sys-employee', label: '菜单：员工管理' },
    { key: 'menu:sys-role', label: '菜单：角色与权限' },
    { key: 'menu:sys-workflow', label: '菜单：工作流管理' }
  ]},
  { group: '评价台账', items: [
    { key: 'report:read', label: '台账查看（全部）' },
    { key: 'report:read:self', label: '台账查看（仅本人经办）' },
    { key: 'report:create', label: '登记评价' },
    { key: 'report:score', label: '六维评分/退回原因维护' },
    { key: 'report:submit', label: '提交负责人审查' },
    { key: 'report:review', label: '审查评价打分' },
    { key: 'report:return', label: '退回评价修改' },
    { key: 'report:delete', label: '删除台账记录' }
  ]},
  { group: '客户', items: [
    { key: 'customer:read', label: '客户查看' },
    { key: 'customer:manage', label: '客户新增/编辑' }
  ]},
  { group: '统计与Excel', items: [
    { key: 'stats:read', label: '统计查看（全部）' },
    { key: 'stats:read:self', label: '统计查看（仅本人相关）' },
    { key: 'excel:import', label: '台账导入' },
    { key: 'excel:export', label: '台账/统计导出' }
  ]},
  { group: '系统管理', items: [
    { key: 'org:manage', label: '机构管理' },
    { key: 'employee:manage', label: '员工（用户）管理' },
    { key: 'role:manage', label: '角色与权限管理' },
    { key: 'workflow:manage', label: '工作流管理' }
  ]}
];

/* 菜单树：perm 为空表示登录即可见 */
const MENUS = [
  { key: 'dashboard', title: '工作台', icon: 'dashboard', perm: null },
  {
    key: 'grp-report', title: '调查报告评价', icon: 'file-paste', type: 'group',
    children: [
      { key: 'report-list', title: '评价台账', icon: 'list', perm: 'menu:report-list' },
      { key: 'todo', title: '待办 / 已办', icon: 'task', perm: 'menu:todo' },
      { key: 'customer', title: '客户信息', icon: 'user-circle', perm: 'menu:customer' }
    ]
  },
  { key: 'analytics', title: '统计分析', icon: 'chart-bubble', perm: 'menu:analytics' },
  {
    key: 'grp-sys', title: '系统管理', icon: 'setting', type: 'group',
    children: [
      { key: 'sys-org', title: '机构管理', icon: 'root-list', perm: 'menu:sys-org' },
      { key: 'sys-employee', title: '员工（用户）管理', icon: 'usergroup', perm: 'menu:sys-employee' },
      { key: 'sys-role', title: '角色与权限', icon: 'secured', perm: 'menu:sys-role' },
      { key: 'sys-workflow', title: '工作流管理', icon: 'swap', perm: 'menu:sys-workflow' }
    ]
  }
];

/* 全部功能权限键（按权限目录展开，供超级管理员角色固定使用） */
const ALL_PERM_KEYS = PERM_CATALOG.flatMap((g) => g.items.map((i) => i.key));

/* 角色预设（内置角色不可删除；超级管理员固定拥有全部权限） */
const ROLE_PRESETS = [
  {
    key: 'reviewer', name: '审批人员',
    descr: '审查客户经理的调查报告：录入客户与报告基本信息，完成六项分析质量评分，登记退回原因，提交负责人审查。',
    perms: ['menu:report-list', 'menu:todo', 'menu:customer', 'menu:analytics',
      'report:read', 'report:create', 'report:score', 'report:submit',
      'customer:read', 'customer:manage', 'stats:read', 'excel:import', 'excel:export']
  },
  {
    key: 'chief', name: '审批负责人',
    descr: '对审批人员的审查工作进行审查评价打分（审查评价）与意见填写，可退回评价修改，归档后数据进入统计。',
    perms: ['menu:report-list', 'menu:todo', 'menu:customer', 'menu:analytics',
      'report:read', 'report:review', 'report:return', 'customer:read', 'stats:read', 'excel:export']
  },
  {
    key: 'manager', name: '客户经理',
    descr: '查看本人主办业务的评价结果与退回原因，用于改进调查报告撰写质量（本期不开放登录）。',
    perms: ['menu:report-list', 'menu:customer', 'menu:analytics',
      'report:read:self', 'customer:read', 'stats:read:self']
  },
  {
    key: 'admin', name: '超级管理员',
    descr: '拥有系统全部权限，固定不可修改。',
    perms: ALL_PERM_KEYS
  }
];

/* 工作流定义（展示用；流转逻辑在 reports 路由中实现） */
const WORKFLOW = {
  name: '调查报告评价审批流',
  version: 'v1.0',
  nodes: [
    { key: 'n1', name: '评价录入', handler: '审批人员', desc: '录入客户与报告基本信息，完成六项分析质量评分及退回原因登记', autoAction: '可保存草稿' },
    { key: 'n2', name: '负责人审查评价', handler: '审批负责人', desc: '对审批人员的审查工作进行评价打分（审查评价）并填写意见，可退回修改', autoAction: '审查后自动归档' },
    { key: 'n3', name: '归档完成', handler: '系统', desc: '评价数据进入统计台账', autoAction: '自动归档' }
  ]
};

module.exports = {
  GRADES, GRADE_MAP, DIMENSIONS, STATUS_MAP, GOOD_SCORE_LINE, reportScore,
  PERM_CATALOG, MENUS, ROLE_PRESETS, WORKFLOW
};
