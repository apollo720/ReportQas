/**
 * 视图层（三）：客户管理 / 统计分析
 * 统计全部来自后端实时聚合；按机构 / 客户经理 / 审查人员 × 周 / 月 / 季 / 年交叉分析。
 */
(function (global) {
  'use strict';

  var Vue = global.Vue;
  var D = global.LRDICT;
  var api = global.LRAPI;
  var V = global.LRViews;

  /* ================================================================== *
   * 客户管理
   * ================================================================== */
  V.customer = {
    name: 'ViewCustomer',
    setup: function () {
      var router = global.LRRouter;
      var filter = Vue.reactive({ keyword: '' });
      var pagination = Vue.reactive({ current: 1, pageSize: 10, total: 0, showJumper: true, pageSizeOptions: [10, 20, 50] });
      var rows = Vue.ref([]);
      var loading = Vue.ref(false);

      var canManage = Vue.computed(function () { return global.LRUI.hasPerm('customer:manage'); });
      var canDelete = Vue.computed(function () { return global.LRUI.hasPerm('customer:delete'); });

      async function load() {
        loading.value = true;
        try {
          var data = await api.customers.list(filter.keyword.trim());
          rows.value = data.items;
          pagination.total = data.items.length;
        } catch (e) { global.LRUI.handle(e, '客户加载失败'); }
        loading.value = false;
      }
      Vue.onMounted(async function () { await global.LRUI.loadMeta(); load(); });
      Vue.watch(function () { return filter.keyword; }, function () { pagination.current = 1; load(); });

      var filtered = Vue.computed(function () { return rows.value; });
      Vue.watch(filtered, function (l) { pagination.total = l.length; }, { immediate: true });
      var pageData = Vue.computed(function () {
        var start = (pagination.current - 1) * pagination.pageSize;
        return filtered.value.slice(start, start + pagination.pageSize);
      });

      var columns = [
        { colKey: 'no', title: '客户编号', width: 120 },
        { colKey: 'name', title: '客户名称', width: 260, ellipsis: true },
        { colKey: 'industry', title: '所属行业', width: 220, ellipsis: true },
        { colKey: 'scale', title: '规模', width: 80, align: 'center' },
        { colKey: 'reportCount', title: '关联报告', width: 96, align: 'right' },
        { colKey: 'op', title: '操作', width: 150, align: 'center' }
      ];

      /* 新增 / 编辑对话框 */
      var dlgVisible = Vue.ref(false);
      var dlgMode = Vue.ref('create');
      var form = Vue.reactive({ id: '', name: '', industry: '', scale: '小型' });
      var saving = Vue.ref(false);

      function openCreate() {
        dlgMode.value = 'create';
        Object.assign(form, { id: '', name: '', industry: '', scale: '小型' });
        dlgVisible.value = true;
      }
      function openEdit(row) {
        dlgMode.value = 'edit';
        Object.assign(form, {
          id: row.id, name: row.name, industry: row.industry || '', scale: row.scale || '小型'
        });
        dlgVisible.value = true;
      }
      async function save() {
        if (!form.name.trim()) { global.LRUI.toast('warning', '请填写客户名称', ''); return; }
        saving.value = true;
        try {
          if (dlgMode.value === 'create') {
            await api.customers.create({
              name: form.name, industry: form.industry, scale: form.scale
            });
            global.LRUI.toast('success', '已新增客户', form.name);
          } else {
            await api.customers.update(form.id, {
              name: form.name, industry: form.industry, scale: form.scale
            });
            global.LRUI.toast('success', '已保存', form.name);
          }
          dlgVisible.value = false;
          await global.LRUI.loadMeta(true);
          load();
        } catch (e) { global.LRUI.handle(e, '保存失败'); }
        saving.value = false;
      }

      function viewReports(row) {
        router.go('report-list', { id: row.name });
      }

      function deleteCustomer(row) {
        var dlg = global.TDesign.DialogPlugin.confirm({
          header: '删除确认',
          body: '确定删除客户「' + row.name + '」吗？该操作不可恢复；若已关联评价台账，将无法删除。',
          confirmBtn: { theme: 'danger', content: '删除' },
          cancelBtn: '取消',
          onConfirm: async function () {
            try {
              await api.customers.remove(row.id);
              global.LRUI.toast('success', '已删除', row.name);
              load();
            } catch (e) { global.LRUI.handle(e, '删除失败'); }
            dlg.hide();
          }
        });
      }

      return {
        filter: filter,
        pagination: pagination, pageData: pageData, filtered: filtered, columns: columns, loading: loading,
        canManage: canManage, canDelete: canDelete, dlgVisible: dlgVisible, dlgMode: dlgMode, form: form, saving: saving,
        openCreate: openCreate, openEdit: openEdit, save: save, deleteCustomer: deleteCustomer,
        reset: function () { filter.keyword = ''; },
        viewReports: viewReports
      };
    },
    template: [
      '<div>',
      '  <page-header title="客户管理">',
      '    <t-button v-if="canManage" theme="primary" @click="openCreate"><template #icon><t-icon name="add" /></template>新增客户</t-button>',
      '  </page-header>',
      '',
      '  <app-card>',
      '    <div class="row row--wrap gap-6" style="align-items:flex-end">',
      '      <div>',
      '        <div class="form-field__label">关键词</div>',
      '        <t-input v-model="filter.keyword" clearable placeholder="客户名称 / 客户编号" style="width:220px">',
      '          <template #prefix-icon><t-icon name="search" /></template>',
      '        </t-input>',
      '      </div>',
      '      <t-button variant="outline" @click="reset"><template #icon><t-icon name="refresh" /></template>重置</t-button>',
      '    </div>',
      '  </app-card>',
      '',
      '  <app-card flush>',
      '    <t-table :data="pageData" :columns="columns" row-key="id" size="small" hover bordered :loading="loading"',
      '      :pagination="pagination" @page-change="(p) => pagination.current = p.current">',
      '      <template #name="{ row }"><span class="cell-strong">{{ row.name }}</span></template>',
      '      <template #reportCount="{ row }"><span class="text-number">{{ row.reportCount }}</span></template>',
      '      <template #op="{ row }">',
      '        <t-space size="small">',
      '          <t-link theme="primary" hover="color" @click="viewReports(row)">评价记录</t-link>',
      '          <t-link v-if="canManage" theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>',
      '          <t-link v-if="canDelete" theme="danger" hover="color" @click="deleteCustomer(row)">删除</t-link>',
      '        </t-space>',
      '      </template>',
      '    </t-table>',
      '    <template #foot><span class="text-sm">共 {{ filtered.length }} 家客户</span></template>',
      '  </app-card>',
      '',
      '  <t-dialog v-model:visible="dlgVisible" :header="dlgMode === \'create\' ? \'新增客户\' : \'编辑客户\'"',
      '    :confirm-btn="{ content: \'保存\', loading: saving, theme: \'primary\' }" :close-on-overlay-click="false" @confirm="save">',
      '    <div class="form-grid">',
      '      <div class="form-field"><label class="form-field__label">客户名称（必填）</label>',
      '        <t-input v-model="form.name" placeholder="与行内系统名称保持一致" /></div>',
      '      <div class="form-field"><label class="form-field__label">所属行业</label>',
      '        <t-input v-model="form.industry" /></div>',
      '      <div class="form-field"><label class="form-field__label">规模</label>',
      '        <t-select v-model="form.scale" :options="[\'大型\',\'中型\',\'小型\',\'微型\'].map(s => ({ value: s, label: s }))" /></div>',
      '    </div>',
      '  </t-dialog>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 统计分析
   * ================================================================== */
  V.analytics = {
    name: 'ViewAnalytics',
    setup: function () {
      var store = global.LRStore;
      var form = Vue.reactive({ target: 'org', period: 'month', range: [] });

      var canExport = Vue.computed(function () { return global.LRUI.hasPerm('excel:export'); });

      var targetOptions = [
        { value: 'org', label: '按机构统计' },
        { value: 'manager', label: '按客户经理统计' },
        { value: 'reviewer', label: '按审查人员统计' }
      ];
      var periodOptions = [
        { value: 'week', label: '按周' },
        { value: 'month', label: '按月' },
        { value: 'quarter', label: '按季度' },
        { value: 'year', label: '按年' }
      ];

      var targetLabel = Vue.computed(function () {
        var hit = targetOptions.filter(function (o) { return o.value === form.target; })[0];
        return hit ? hit.label.replace('按', '').replace('统计', '') : '';
      });

      var summary = Vue.ref({});
      var trend = Vue.ref({ items: [] });
      var rows = Vue.ref([]);
      var dimAvg = Vue.ref([]);
      var loading = Vue.ref(false);

      var kpis = Vue.computed(function () {
        var s = summary.value || {};
        var prev = trend.value.items || [];
        var curKey = prev.length ? prev[prev.length - 1].key : '';
        var cur = prev.filter(function (b) { return b.key === curKey; })[0] || {};
        var prevBucket = prev.length > 1 ? prev[prev.length - 2] : {};
        var delta = (cur.avgScore != null && prevBucket.avgScore != null)
          ? Math.round((cur.avgScore - prevBucket.avgScore) * 10) / 10 : null;
        return [
          { icon: 'file-paste', theme: 'brand', label: '审查笔数', value: s.count != null ? s.count : '—', unit: '笔', extra: '统计区间内全部台账' },
          { icon: 'chart-bubble', theme: 'success', label: '平均得分', value: s.avgScore != null ? s.avgScore : '—', unit: '分', extra: '六维平均口径（报告得分）' },
          { icon: 'star', theme: 'warning', label: '优良占比', value: s.goodRate != null ? s.goodRate : '—', unit: '%', extra: '得分 ≥ 90 分的笔数占比' },
          { icon: 'secured', theme: 'brand', label: '审查评价平均分', value: s.reviewAvg != null ? s.reviewAvg : '—', unit: '分', extra: '负责人对审批人员审查工作的评分' }
        ];
      });

      var gradeDist = Vue.computed(function () {
        var s = summary.value || {};
        var dist = s.gradeDist || {};
        var C = global.LRChart.colors;
        var colorMap = { '优': C.brand, '良': C.success, '中': C.warning, '差': C.error };
        return D.GRADES.map(function (g) {
          return { name: g.key + '（' + g.score + '分）', value: dist[g.key] || 0, itemStyle: { color: colorMap[g.key] } };
        });
      });

      var columns = [
        { colKey: 'index', title: '排名', width: 72, align: 'center' },
        { colKey: 'name', title: '统计对象', width: 180 },
        { colKey: 'count', title: '审查笔数', width: 96, align: 'right' },
        { colKey: 'avgScore', title: '报告平均得分', width: 116, align: 'right' },
        { colKey: 'goodRate', title: '优良占比', width: 170 },
        { colKey: 'reviewed', title: '已审查', width: 88, align: 'right' },
        { colKey: 'reviewAvg', title: '审查评价平均', width: 116, align: 'right' },
        { colKey: 'reviewGoodRate', title: '审查优良占比', width: 96, align: 'right' },
        { colKey: 'returns', title: '退回次数', width: 92, align: 'right' },
        { colKey: 'amount', title: '授信金额合计（万元）', width: 160, align: 'right' }
      ];

      var trendEl = Vue.ref(null);
      var barEl = Vue.ref(null);
      var pieEl = Vue.ref(null);
      var radarEl = Vue.ref(null);

      function drawCharts() {
        var Ch = global.LRChart;
        var C = Ch.colors;
        Vue.nextTick(function () {
          var items = trend.value.items || [];
          Ch.render(trendEl.value, Ch.lineOption({
            labels: items.map(function (b) { return b.key; }),
            series: [
              { name: '平均得分', data: items.map(function (b) { return b.avgScore; }), color: C.brand, area: true },
              { name: '审查笔数', data: items.map(function (b) { return b.count; }), color: C.success, axis: 'right' }
            ]
          }));

          var agg = rows.value.slice(0, 8);
          Ch.render(barEl.value, Ch.barOption({
            labels: agg.map(function (a) { return a.name; }),
            rotate: agg.length > 5 ? 20 : 0,
            series: [
              { name: '报告平均得分', data: agg.map(function (a) { return a.avgScore; }), color: C.brand },
              { name: '优良占比(%)', data: agg.map(function (a) { return a.goodRate; }), color: C.success }
            ]
          }));

          Ch.render(pieEl.value, Ch.pieOption({ data: gradeDist.value }));

          Ch.render(radarEl.value, Ch.radarOption({
            indicators: dimAvg.value.map(function (d) { return { name: d.name, max: 100 }; }),
            data: [{ value: dimAvg.value.map(function (d) { return d.value; }), name: '平均分' }]
          }));
        });
      }

      async function query(silent) {
        loading.value = true;
        var range = form.range && form.range.length === 2
          ? { from: form.range[0], to: form.range[1] } : {};
        try {
          var p = Object.assign({ period: form.period }, range);
          summary.value = await api.stats.summary(p);
          trend.value = await api.stats.trend(p);
          var agg = await api.stats.aggregate(Object.assign({ groupBy: form.target, period: 'year' }, range));
          rows.value = agg.items;
          var da = await api.stats.dimAvg(range);
          dimAvg.value = da.items;
          drawCharts();
          if (!silent) global.LRUI.toast('success', '查询完成', '已按「' + targetLabel.value + ' · ' + form.period + '」重新聚合');
        } catch (e) { global.LRUI.handle(e, '统计查询失败'); }
        loading.value = false;
      }

      Vue.onMounted(function () { query(true); });
      Vue.watch(function () { return [form.target, form.period].join('|'); }, function () { query(true); });

      function reset() { form.target = 'org'; form.period = 'month'; form.range = []; query(true); }
      function barTheme(v) { return v >= 80 ? '' : (v >= 65 ? 'stat-bar__fill--warning' : 'stat-bar__fill--danger'); }
      function exportReport() {
        global.window.open(api.excel.exportStatsUrl({
          groupBy: form.target, from: form.range && form.range[0], to: form.range && form.range[1]
        }));
      }
      function fmt(v) { return v === null || v === undefined ? '—' : v; }

      return {
        store: store, form: form, targetOptions: targetOptions, periodOptions: periodOptions,
        targetLabel: targetLabel, kpis: kpis, rows: rows, columns: columns, loading: loading, dimAvg: dimAvg,
        trendEl: trendEl, barEl: barEl, pieEl: pieEl, radarEl: radarEl,
        query: query, reset: reset, barTheme: barTheme, exportReport: exportReport, canExport: canExport, fmt: fmt
      };
    },
    template: [
      '<div>',
      '  <page-header title="统计分析">',
      '    <t-button v-if="canExport" variant="outline" @click="exportReport"><template #icon><t-icon name="download" /></template>导出报表</t-button>',
      '  </page-header>',
      '',
      '  <app-card>',
      '    <div class="row row--wrap gap-6" style="align-items:flex-end">',
      '      <div>',
      '        <div class="form-field__label">统计对象</div>',
      '        <t-select v-model="form.target" :options="targetOptions" style="width:170px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">时间维度</div>',
      '        <t-select v-model="form.period" :options="periodOptions" style="width:140px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">统计区间（可选）</div>',
      '        <t-date-range-picker v-model="form.range" valueType="YYYY-MM-DD" clearable style="width:260px" />',
      '      </div>',
      '      <t-button theme="primary" :loading="loading" @click="query()"><template #icon><t-icon name="search" /></template>查询</t-button>',
      '      <t-button variant="outline" @click="reset"><template #icon><t-icon name="refresh" /></template>重置</t-button>',
      '    </div>',
      '  </app-card>',
      '',
      '  <div class="kpi-grid">',
      '    <app-kpi v-for="k in kpis" :key="k.label" :icon="k.icon" :theme="k.theme" :label="k.label" :value="k.value" :unit="k.unit" :extra="k.extra" />',
      '  </div>',
      '',
      '  <div class="grid-2">',
      '    <app-card title="得分趋势" desc="按所选时间维度聚合：平均得分与审查笔数双轴">',
      '      <div ref="trendEl" class="chart"></div>',
      '    </app-card>',
      '    <app-card title="各对象平均得分对比" :desc="\'按\' + targetLabel + \'对比报告平均得分与优良占比\'">',
      '      <div ref="barEl" class="chart"></div>',
      '    </app-card>',
      '  </div>',
      '',
      '  <div class="grid-2">',
      '    <app-card title="报告得分等级分布" desc="按六维平均得分落档（优≥95 / 良≥85 / 中≥75 / 差<75）">',
      '      <div ref="pieEl" class="chart"></div>',
      '    </app-card>',
      '    <app-card title="六维短板分析" desc="六个分析质量维度的平均分，越低越需要培训">',
      '      <div ref="radarEl" class="chart"></div>',
      '      <div class="row row--wrap gap-4 mt-4">',
      '        <t-tag v-for="d in dimAvg" :key="d.name" :theme="d.value >= 90 ? \'success\' : (d.value >= 85 ? \'primary\' : \'warning\')" variant="light-outline">',
      '          {{ d.name }} {{ fmt(d.value) }}',
      '        </t-tag>',
      '      </div>',
      '    </app-card>',
      '  </div>',
      '',
      '  <app-card :title="\'明细数据（按\' + targetLabel + \'）\'" :desc="\'共 \' + rows.length + \' 个统计对象，按报告平均得分降序排列；审查评价列为负责人对审批人员审查工作的评分\'" flush>',
      '    <t-table :data="rows" :columns="columns" row-key="key" size="small" hover bordered>',
      '      <template #index="{ rowIndex }">',
      '        <span :style="rowIndex < 3 ? \'color:var(--td-brand-color);font-weight:600\' : \'\'">{{ rowIndex + 1 }}</span>',
      '      </template>',
      '      <template #name="{ row }"><span class="cell-strong">{{ row.name }}</span></template>',
      '      <template #count="{ row }"><span class="text-number">{{ row.count }}</span></template>',
      '      <template #avgScore="{ row }">',
      '        <span class="text-number cell-strong" :style="row.avgScore != null && row.avgScore < 85 ? \'color:var(--td-warning-color)\' : \'\'">{{ fmt(row.avgScore) }}</span>',
      '      </template>',
      '      <template #goodRate="{ row }">',
      '        <div class="row gap-4">',
      '          <div class="stat-bar"><div class="stat-bar__fill" :class="barTheme(row.goodRate)" :style="{ width: (row.goodRate || 0) + \'%\' }"></div></div>',
      '          <span class="text-number" style="min-width:48px;text-align:right">{{ fmt(row.goodRate) }}{{ row.goodRate != null ? \'%\' : \'\' }}</span>',
      '        </div>',
      '      </template>',
      '      <template #reviewed="{ row }"><span class="text-number">{{ row.reviewed }}</span></template>',
      '      <template #reviewAvg="{ row }"><span class="text-number">{{ fmt(row.reviewAvg) }}</span></template>',
      '      <template #reviewGoodRate="{ row }"><span class="text-number">{{ fmt(row.reviewGoodRate) }}{{ row.reviewGoodRate != null ? \'%\' : \'\' }}</span></template>',
      '      <template #returns="{ row }">',
      '        <span class="text-number" :style="row.returns >= row.count ? \'color:var(--td-error-color)\' : \'\'">{{ row.returns }}</span>',
      '      </template>',
      '      <template #amount="{ row }"><span class="text-number">{{ row.amount.toLocaleString() }}</span></template>',
      '    </t-table>',
      '    <template #foot><span class="text-sm">口径：报告得分 = 六维平均（考核客户经理）；审查评价 = 负责人对审批人员审查工作的评分，单列统计；优良占比 = 得分 ≥ 90 的笔数占比</span></template>',
      '  </app-card>',
      '</div>'
    ].join('')
  };
})(window);
