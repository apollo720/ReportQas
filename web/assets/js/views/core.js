/**
 * 视图层（一）：登录 / 工作台 / 评价台账 / 待办已办
 * 全部数据来自后端接口；按钮显隐按服务端下发的权限点控制。
 */
(function (global) {
  'use strict';

  var Vue = global.Vue;
  var D = global.LRDICT;
  var api = global.LRAPI;
  var V = global.LRViews || (global.LRViews = {});

  /* ================================================================== *
   * 登录页（真实鉴权：工号 + 密码）
   * ================================================================== */
  V.login = {
    name: 'ViewLogin',
    setup: function () {
      var store = global.LRStore;
      var form = Vue.reactive({ no: '', password: '' });
      var loading = Vue.ref(false);
      /* 演示模式由后端下发（生产镜像 LR_SEED_DEMO=0 时不显示演示账号） */
      var demoMode = Vue.ref(false);

      /* 演示账号一键填入（正式账号由管理员在员工管理中维护） */
      var demoAccounts = [
        { no: '901001', name: '陈明远 · 审批人员' },
        { no: '901002', name: '周涛 · 审批负责人' },
        { no: '901003', name: '郑立群 · 超级管理员' }
      ];

      Vue.onMounted(function () {
        api.health().then(function (h) { demoMode.value = !!h.demo; }).catch(function () {});
      });

      function fillDemo(acc) {
        form.no = acc.no;
        form.password = acc.no === '901003' ? 'admin123' : '123456';
      }

      async function submit() {
        if (!form.no || !form.password) {
          global.LRUI.toast('warning', '请填写完整', '工号和密码均必填');
          return;
        }
        loading.value = true;
        try {
          await global.LRUI.login(form.no, form.password);
        } catch (e) {
          global.LRUI.toast('error', '登录失败', e.message);
        }
        loading.value = false;
      }

      return {
        form: form, loading: loading, demoMode: demoMode, demoAccounts: demoAccounts, fillDemo: fillDemo, submit: submit, store: store
      };
    },
    template: [
      '<div class="login">',
      '  <aside class="login__brand">',
      '    <div class="login__logo">',
      '      <div class="app-brand__mark" style="background:rgba(255,255,255,.18)"><t-icon name="creditcard" size="18" /></div>',
      '      <span class="login__logo-name">九江银行新余分行</span>',
      '    </div>',
      '    <h1 class="login__title">贷款调查报告\n质量评价系统</h1>',
      '  </aside>',
      '  <div class="login__form">',
      '    <div class="login__panel">',
      '      <h2>欢迎使用</h2>',
      '      <div class="login__field">',
      '        <label class="login__field-label">员工工号</label>',
      '        <t-input v-model="form.no" size="large" placeholder="请输入工号" clearable @enter="submit">',
      '          <template #prefix-icon><t-icon name="user" /></template>',
      '        </t-input>',
      '      </div>',
      '      <div class="login__field">',
      '        <label class="login__field-label">登录密码</label>',
      '        <t-input v-model="form.password" type="password" size="large" placeholder="请输入密码" clearable @enter="submit">',
      '          <template #prefix-icon><t-icon name="lock-on" /></template>',
      '        </t-input>',
      '      </div>',
      '      <t-button class="login__btn" theme="primary" size="large" :loading="loading" @click="submit">',
      '        <template #icon><t-icon name="login" /></template>登 录',
      '      </t-button>',
      '      <div v-if="demoMode" class="login__hint">',
      '        <strong>演示账号（点击填入）：</strong>',
      '        <div class="row gap-4" style="flex-wrap:wrap;margin-top:6px">',
      '          <t-link v-for="a in demoAccounts" :key="a.no" theme="primary" hover="color" @click="fillDemo(a)">{{ a.name }}</t-link>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 工作台
   * ================================================================== */
  V.dashboard = {
    name: 'ViewDashboard',
    setup: function () {
      var store = global.LRStore;
      var router = global.LRRouter;
      var tab = Vue.ref('todo');
      var keyword = Vue.ref('');
      var rows = Vue.ref([]);
      var summary = Vue.ref(null);

      var me = Vue.computed(function () { return store.user; });
      var isChief = Vue.computed(function () { return global.LRUI.hasPerm('report:review'); });
      var isReviewer = Vue.computed(function () { return global.LRUI.hasPerm('report:submit'); });
      var isAdmin = Vue.computed(function () { return global.LRUI.hasPerm('role:manage'); });

      var hour = new Date().getHours();
      var greet = hour < 12 ? '上午好' : (hour < 18 ? '下午好' : '晚上好');

      var kpis = Vue.computed(function () {
        var c = store.counts;
        var s = summary.value || {};
        var list = [];
        if (isReviewer.value) {
          list = [
            { icon: 'edit', theme: 'brand', label: '待我评价', value: c.evaluate, unit: '笔', extra: '含被退回 ' + (c.returned || 0) + ' 笔' },
            { icon: 'rollback', theme: 'warning', label: '被退回待修改', value: c.returned || 0, unit: '笔', extra: '请查看退回说明后修改' },
            { icon: 'file-paste', theme: 'success', label: '评价总笔数', value: s.count || 0, unit: '笔', extra: '全部门口径' },
            { icon: 'chart-bubble', theme: 'brand', label: '平均得分', value: s.avgScore != null ? s.avgScore : '—', unit: '分', extra: '优良占比 ' + (s.goodRate != null ? s.goodRate + '%' : '—') }
          ];
        } else if (isChief.value) {
          list = [
            { icon: 'secured', theme: 'brand', label: '待我审查评价', value: c.review, unit: '笔', extra: '审查对象：审批人员的审查工作' },
            { icon: 'check-circle-filled', theme: 'success', label: '已归档笔数', value: (s.byStatus && s.byStatus.archived) || 0, unit: '笔', extra: '归档后进入统计' },
            { icon: 'chart-bubble', theme: 'brand', label: '报告平均得分', value: s.avgScore != null ? s.avgScore : '—', unit: '分', extra: '六维平均口径' },
            { icon: 'star', theme: 'warning', label: '审查评价优良占比', value: s.reviewGoodRate != null ? s.reviewGoodRate : '—', unit: '%', extra: '审查评价平均 ' + (s.reviewAvg != null ? s.reviewAvg : '—') + ' 分' }
          ];
        } else {
          list = [
            { icon: 'file-paste', theme: 'brand', label: '评价总笔数', value: s.count || 0, unit: '笔', extra: '统计区间内' },
            { icon: 'chart-bubble', theme: 'success', label: '平均得分', value: s.avgScore != null ? s.avgScore : '—', unit: '分', extra: '六维平均口径' },
            { icon: 'star', theme: 'warning', label: '优良占比', value: s.goodRate != null ? s.goodRate : '—', unit: '%', extra: '得分 ≥ 90 占比' },
            { icon: 'secured', theme: 'danger', label: '待审查', value: (s.byStatus && s.byStatus.pending_review) || 0, unit: '笔', extra: '待负责人审查评价' }
          ];
        }
        return list;
      });

      async function load() {
        try {
          var data = await api.tasks.list(tab.value);
          rows.value = data.items;
          global.LRUI.refreshCounts();
        } catch (e) { rows.value = []; }
      }

      Vue.onMounted(async function () {
        load();
        try { summary.value = await api.stats.summary({}); } catch (e) { summary.value = null; }
      });
      Vue.watch(tab, load);

      var filteredRows = Vue.computed(function () {
        var k = keyword.value.trim();
        if (!k) return rows.value.slice(0, 8);
        return rows.value.filter(function (r) {
          return r.id.indexOf(k) >= 0 || (r.customerName || '').indexOf(k) >= 0;
        }).slice(0, 8);
      });

      var columns = [
        { colKey: 'id', title: '报告编号', width: 130, fixed: 'left' },
        { colKey: 'customerName', title: '客户名称', width: 240, ellipsis: true },
        { colKey: 'orgName', title: '经办机构', width: 120 },
        { colKey: 'report_date', title: '上报日期', width: 110 },
        { colKey: 'amount', title: '授信金额（万元）', width: 140, align: 'right' },
        { colKey: 'score', title: '报告得分', width: 100, align: 'right' },
        { colKey: 'returnCount', title: '退回次数', width: 90, align: 'center' },
        { colKey: 'status', title: '状态', width: 120 },
        { colKey: 'op', title: '操作', width: 130, fixed: 'right', align: 'center' }
      ];

      function open(row) { router.go('report-detail', { id: row.id }); }
      function actLabel(row) {
        if (row.status === 'pending_review' && isChief.value) return '审查评价';
        if (row.status === 'archived') return '查看详情';
        return tab.value === 'todo' ? '去评价' : '查看详情';
      }

      return {
        greet: greet, me: me, isChief: isChief, isReviewer: isReviewer,
        tab: tab, keyword: keyword, kpis: kpis, rows: filteredRows, columns: columns,
        open: open, actLabel: actLabel,
        evaluateCount: function () { return store.counts.evaluate; },
        reviewCount: function () { return store.counts.review; },
        fmtAmount: D.fmtAmount
      };
    },
    template: [
      '<div>',
      '  <page-header :title="greet + \'，\' + me.name">',
      '  </page-header>',
      '',
      '  <div class="kpi-grid">',
      '    <app-kpi v-for="k in kpis" :key="k.label" :icon="k.icon" :theme="k.theme" :label="k.label"',
      '      :value="k.value" :unit="k.unit" :extra="k.extra" />',
      '  </div>',
      '',
      '  <app-card flush>',
      '    <div style="padding:0 16px;border-bottom:1px solid var(--td-border-level-1-color)">',
      '      <t-tabs v-model="tab">',
      '        <t-tab-panel value="todo" :label="\'待办事项 \' + (isChief ? reviewCount() : evaluateCount())" />',
      '        <t-tab-panel value="done" label="已办事项" />',
      '      </t-tabs>',
      '    </div>',
      '    <t-table :data="rows" :columns="columns" row-key="id" size="small" hover',
      '      :empty="\'当前没有\' + (tab === \'todo\' ? \'待办\' : \'已办\') + \'事项\'">',
      '      <template #amount="{ row }"><span class="text-number">{{ fmtAmount(row.amount) }}</span></template>',
      '      <template #score="{ row }"><span class="text-number cell-strong">{{ row.score != null ? row.score : \'—\' }}</span></template>',
      '      <template #returnCount="{ row }">',
      '        <span v-if="row.returnCount" style="color:var(--td-warning-color)">{{ row.returnCount }} 次</span>',
      '        <span v-else class="cell-muted">—</span>',
      '      </template>',
      '      <template #status="{ row }">',
      '        <t-tag :theme="STATUS_MAP[row.status].theme" variant="light">{{ STATUS_MAP[row.status].label }}</t-tag>',
      '      </template>',
      '      <template #op="{ row }">',
      '        <t-link theme="primary" hover="color" @click="open(row)">{{ actLabel(row) }}</t-link>',
      '      </template>',
      '    </t-table>',
      '  </app-card>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 评价台账
   * ================================================================== */
  V['report-list'] = {
    name: 'ViewReportList',
    setup: function () {
      var store = global.LRStore;
      var router = global.LRRouter;

      var filter = Vue.reactive({ org: '', status: '', keyword: '', date: [] });
      var pagination = Vue.reactive({ current: 1, pageSize: 10, total: 0, showJumper: true, pageSizeOptions: [10, 20, 50] });
      var rows = Vue.ref([]);
      var loading = Vue.ref(false);
      var meta = store.meta;

      var canCreate = Vue.computed(function () { return global.LRUI.hasPerm('report:create'); });
      var canScore = Vue.computed(function () { return global.LRUI.hasPerm('report:score'); });
      var canExport = Vue.computed(function () { return global.LRUI.hasPerm('excel:export'); });
      var canImport = Vue.computed(function () { return global.LRUI.hasPerm('excel:import'); });

      var orgOptions = Vue.computed(function () {
        return ((store.meta && store.meta.orgs) || []).map(function (o) { return { value: o.id, label: o.name }; });
      });
      var statusOptions = Object.keys(D.STATUS_MAP).map(function (k) {
        return { value: k, label: D.STATUS_MAP[k].label };
      });

      async function fetchList() {
        loading.value = true;
        try {
          var data = await api.reports.list({
            orgId: filter.org, status: filter.status, keyword: filter.keyword.trim(),
            date: filter.date && filter.date.length === 2 ? filter.date : null,
            page: pagination.current, pageSize: pagination.pageSize
          });
          rows.value = data.items;
          pagination.total = data.total;
        } catch (e) {
          global.LRUI.handle(e, '台账加载失败');
        }
        loading.value = false;
      }

      Vue.onMounted(async function () {
        await global.LRUI.loadMeta();
        if (router.route.params.id) filter.keyword = router.route.params.id;
        fetchList();
      });
      Vue.watch(function () { return [filter.org, filter.status, filter.keyword, filter.date].join('|'); },
        function () { pagination.current = 1; fetchList(); });
      Vue.watch(function () { return pagination.current + '/' + pagination.pageSize; }, fetchList);

      var columns = [
        { colKey: 'id', title: '报告编号', width: 128, fixed: 'left' },
        { colKey: 'report_date', title: '上报日期', width: 108, fixed: 'left' },
        { colKey: 'customerName', title: '客户名称', width: 230, ellipsis: true },
        { colKey: 'orgName', title: '经办机构', width: 110 },
        { colKey: 'approved', title: '是否核额', width: 86, align: 'center' },
        { colKey: 'amount', title: '授信金额(万)', width: 118, align: 'right' },
        { colKey: 'mainInvestigatorName', title: '主调查人', width: 96 },
        { colKey: 'reviewerName', title: '审批人员', width: 96 },
        { colKey: 'scores', title: '六维分析质量', width: 210 },
        { colKey: 'review', title: '审查评价', width: 88, align: 'center' },
        { colKey: 'status', title: '状态', width: 116 },
        { colKey: 'op', title: '操作', width: 130, fixed: 'right', align: 'center' }
      ];

      function reset() {
        filter.org = ''; filter.status = ''; filter.keyword = ''; filter.date = [];
        pagination.current = 1;
      }
      function open(row) { router.go('report-detail', { id: row.id }); }
      function createNew() { router.go('report-detail', { id: 'new' }); }
      function exportLedger() {
        global.window.open(api.excel.exportReportsUrl({
          orgId: filter.org, status: filter.status,
          dateFrom: filter.date && filter.date[0], dateTo: filter.date && filter.date[1]
        }));
      }

      /* 导入对话框 */
      var importVisible = Vue.ref(false);
      var importFile = Vue.ref(null);
      var importAutoCreate = Vue.ref(true);
      var importing = Vue.ref(false);
      var importResult = Vue.ref(null);

      function pickFile(e) {
        importFile.value = e.target.files && e.target.files[0];
      }
      async function doImport() {
        if (!importFile.value) {
          global.LRUI.toast('warning', '请选择文件', '先选择要导入的 .xlsx 台账文件');
          return;
        }
        importing.value = true;
        importResult.value = null;
        try {
          importResult.value = await api.excel.import(importFile.value, importAutoCreate.value);
          fetchList();
        } catch (e) { global.LRUI.handle(e, '导入失败'); }
        importing.value = false;
      }
      function downloadTemplate() { global.window.open(api.excel.templateUrl); }

      return {
        store: store, filter: filter, orgOptions: orgOptions, statusOptions: statusOptions,
        pagination: pagination, rows: rows, loading: loading, columns: columns,
        canCreate: canCreate, canScore: canScore, canExport: canExport, canImport: canImport,
        reset: reset, open: open, createNew: createNew, exportLedger: exportLedger,
        importVisible: importVisible, importFile: importFile, importAutoCreate: importAutoCreate,
        importing: importing, importResult: importResult, pickFile: pickFile, doImport: doImport, downloadTemplate: downloadTemplate,
        fetchList: fetchList,        fmtAmount: D.fmtAmount
      };
    },
    template: [
      '<div>',
      '  <page-header title="调查报告评价台账">',
      '    <t-button v-if="canImport" variant="outline" @click="importVisible = true">',
      '      <template #icon><t-icon name="upload" /></template>导入台账',
      '    </t-button>',
      '    <t-button v-if="canExport" variant="outline" @click="exportLedger">',
      '      <template #icon><t-icon name="download" /></template>导出台账',
      '    </t-button>',
      '    <t-button v-if="canCreate" theme="primary" @click="createNew">',
      '      <template #icon><t-icon name="add" /></template>新建评价',
      '    </t-button>',
      '  </page-header>',
      '',
      '  <app-card>',
      '    <div class="row row--wrap gap-6" style="align-items:flex-end">',
      '      <div>',
      '        <div class="form-field__label">经办机构</div>',
      '        <t-select v-model="filter.org" :options="orgOptions" clearable placeholder="全部机构" style="width:180px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">上报日期</div>',
      '        <t-date-range-picker v-model="filter.date" valueType="YYYY-MM-DD" clearable style="width:260px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">状态</div>',
      '        <t-select v-model="filter.status" :options="statusOptions" clearable placeholder="全部状态" style="width:150px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">关键词</div>',
      '        <t-input v-model="filter.keyword" clearable placeholder="报告编号 / 客户 / 客户经理" style="width:220px">',
      '          <template #prefix-icon><t-icon name="search" /></template>',
      '        </t-input>',
      '      </div>',
      '      <t-button variant="outline" @click="reset"><template #icon><t-icon name="refresh" /></template>重置</t-button>',
      '    </div>',
      '  </app-card>',
      '',
      '  <app-card flush>',
      '    <t-table :data="rows" :columns="columns" row-key="id" size="small" hover bordered :loading="loading"',
      '      :pagination="pagination" @page-change="(p) => pagination.current = p.current"',
      '      @page-size-change="(s) => pagination.pageSize = s"',
      '      empty="没有符合条件的评价记录">',
      '      <template #approved="{ row }">',
      '        <t-tag v-if="row.approved === \'是\'" theme="success" variant="light-outline">已核额</t-tag>',
      '        <t-tag v-else theme="default" variant="light-outline">未核额</t-tag>',
      '      </template>',
      '      <template #amount="{ row }"><span class="text-number">{{ fmtAmount(row.amount) }}</span></template>',
      '      <template #scores="{ row }">',
      '        <div class="row gap-2">',
      '          <t-popup v-for="d in DIMENSIONS" :key="d.key" placement="top" :content="d.label + \'：\' + (row[\'score_\' + d.key] || \'未评\')">',
      '            <grade-pill v-if="row[\'score_\' + d.key]" :grade="row[\'score_\' + d.key]" />',
      '          </t-popup>',
      '        </div>',
      '      </template>',
      '      <template #review="{ row }">',
      '        <grade-pill v-if="row.review" :grade="row.review" />',
      '        <span v-else class="cell-muted">待审查</span>',
      '      </template>',
      '      <template #status="{ row }">',
      '        <t-tag :theme="STATUS_MAP[row.status].theme" variant="light">{{ STATUS_MAP[row.status].label }}</t-tag>',
      '      </template>',
      '      <template #op="{ row }">',
      '        <t-space size="small">',
      '          <t-link theme="primary" hover="color" @click="open(row)">',
      '            {{ row.status === \'pending_review\' && canScore === false ? \'审查评价\' : \'详情\' }}',
      '          </t-link>',
      '        </t-space>',
      '      </template>',
      '    </t-table>',
      '    <template #foot><span class="text-sm">共 {{ pagination.total }} 笔评价记录</span></template>',
      '  </app-card>',
      '',
      '  <t-dialog v-model:visible="importVisible" header="导入评价台账（Excel）" :footer="false" :close-on-overlay-click="false">',
      '    <div class="notice notice--brand" style="margin-bottom:12px">',
      '      <t-icon name="info-circle-filled" class="notice__icon" />',
      '      <span class="text-sm">列名须与原线下台账一致（经办机构 / 上报日期 / 客户名称 / 六项质量 / 退回原因 / 审查评价…）；机构、人员按名称匹配系统主数据。</span>',
      '    </div>',
      '    <div class="form-field"><label class="form-field__label">选择 .xlsx 文件</label>',
      '      <input type="file" accept=".xlsx" @change="pickFile" /></div>',
      '    <t-checkbox v-model="importAutoCreate">客户不存在时自动创建客户</t-checkbox>',
      '    <div class="row gap-4" style="margin-top:12px">',
      '      <t-button theme="primary" :loading="importing" @click="doImport"><template #icon><t-icon name="upload" /></template>开始导入</t-button>',
      '      <t-button variant="outline" @click="downloadTemplate"><template #icon><t-icon name="download" /></template>下载导入模板</t-button>',
      '    </div>',
      '    <div v-if="importResult" style="margin-top:12px">',
      '      <t-tag theme="success" variant="light">成功导入 {{ importResult.imported }} 笔</t-tag>',
      '      <t-tag v-if="importResult.skipped.length" theme="danger" variant="light" style="margin-left:8px">跳过 {{ importResult.skipped.length }} 行</t-tag>',
      '      <div v-for="(s, i) in importResult.skipped" :key="i" class="text-sm" style="margin-top:6px;color:var(--td-error-color)">',
      '        第 {{ s.row }} 行（{{ s.customer || \'—\' }}）：{{ s.reason }}',
      '      </div>',
      '    </div>',
      '  </t-dialog>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 待办 / 已办（整页版）
   * ================================================================== */
  V.todo = {
    name: 'ViewTodo',
    setup: function () {
      var store = global.LRStore;
      var router = global.LRRouter;
      var tab = Vue.ref('todo');
      var rows = Vue.ref([]);
      var isChief = Vue.computed(function () { return global.LRUI.hasPerm('report:review'); });

      async function load() {
        try {
          var data = await api.tasks.list(tab.value);
          rows.value = data.items;
        } catch (e) { rows.value = []; }
      }
      Vue.onMounted(load);
      Vue.watch(tab, load);

      var columns = [
        { colKey: 'id', title: '报告编号', width: 130 },
        { colKey: 'customerName', title: '客户名称', width: 240, ellipsis: true },
        { colKey: 'orgName', title: '经办机构', width: 120 },
        { colKey: 'report_date', title: '上报日期', width: 110 },
        { colKey: 'node', title: '当前节点', width: 170 },
        { colKey: 'score', title: '报告得分', width: 100, align: 'right' },
        { colKey: 'status', title: '状态', width: 120 },
        { colKey: 'op', title: '操作', width: 120, align: 'center' }
      ];

      function nodeOf(row) {
        if (row.status === 'draft') return '① 评价录入（审批人员）';
        if (row.status === 'returned') return '① 评价录入（已退回）';
        if (row.status === 'pending_review') return '② 负责人审查评价';
        return '③ 已归档';
      }

      return {
        tab: tab, rows: rows, columns: columns, nodeOf: nodeOf, isChief: isChief,
        open: function (row) { router.go('report-detail', { id: row.id }); }
      };
    },
    template: [
      '<div>',
      '  <page-header title="待办 / 已办" />',
      '  <app-card flush>',
      '    <div style="padding:0 16px;border-bottom:1px solid var(--td-border-level-1-color)">',
      '      <t-tabs v-model="tab">',
      '        <t-tab-panel value="todo" :label="\'待我处理 \' + rows.length" />',
      '        <t-tab-panel value="done" label="我已处理" />',
      '      </t-tabs>',
      '    </div>',
      '    <t-table :data="rows" :columns="columns" row-key="id" size="small" hover>',
      '      <template #score="{ row }"><span class="text-number cell-strong">{{ row.score != null ? row.score : \'—\' }}</span></template>',
      '      <template #node="{ row }"><span class="text-secondary">{{ nodeOf(row) }}</span></template>',
      '      <template #status="{ row }">',
      '        <t-tag :theme="STATUS_MAP[row.status].theme" variant="light">{{ STATUS_MAP[row.status].label }}</t-tag>',
      '      </template>',
      '      <template #op="{ row }">',
      '        <t-link theme="primary" hover="color" @click="open(row)">处理</t-link>',
      '      </template>',
      '    </t-table>',
      '  </app-card>',
      '</div>'
    ].join('')
  };
})(window);
