/**
 * 视图层（二）：调查报告评价详情 / 审查评价 / 新建评价
 * 同一页面承载工作流节点，按「当前用户权限 + 记录状态 + 记录归属」决定可编辑区域。
 *
 * 口径说明：报告得分 = 六维平均（考核客户经理报告质量）；
 * 审查评价 = 审批负责人对审批人员审查工作的评价，单列不并入。
 */
(function (global) {
  'use strict';

  var Vue = global.Vue;
  var D = global.LRDICT;
  var api = global.LRAPI;
  var V = global.LRViews;

  function blankRecord() {
    return {
      id: '', org_id: '', report_date: '', customer_id: '', approved: '否', amount: 0, exposure_amount: 0,
      main_investigator: '', assistant_investigator: '', first_responsible: '', reviewer: '',
      score_sys: '', score_credit: '', score_asset: '', score_operate: '',
      score_purpose: '', score_guarantee: '',
      return1: '', return2: '', return3: '', return4: '',
      review: '', review_comment: '', status: 'draft',
      return_note: '', submit_time: null, review_time: null, archive_time: null
    };
  }

  V['report-detail'] = {
    name: 'ViewReportDetail',
    setup: function () {
      var store = global.LRStore;
      var router = global.LRRouter;

      var isNew = Vue.computed(function () { return router.route.params.id === 'new'; });
      var record = Vue.ref(blankRecord());
      var customer = Vue.ref({});
      var timeline = Vue.ref([]);
      var loading = Vue.ref(true);

      var me = Vue.computed(function () { return store.user; });
      var canScorePerm = Vue.computed(function () { return global.LRUI.hasPerm('report:score'); });
      var canReview = Vue.computed(function () {
        return global.LRUI.hasPerm('report:review') && record.value.status === 'pending_review';
      });
      var canDelete = Vue.computed(function () { return global.LRUI.hasPerm('report:delete'); });
      var canEvaluate = Vue.computed(function () {
        if (!canScorePerm.value) return false;
        if (isNew.value) return true;
        return (record.value.status === 'draft' || record.value.status === 'returned')
          && (record.value.reviewer === me.value.id || record.value.created_by === me.value.id);
      });

      /* 下拉选项（来自主数据缓存） */
      var orgOptions = Vue.computed(function () {
        return ((store.meta && store.meta.orgs) || []).filter(function (o) { return o.status === '启用'; })
          .map(function (o) { return { value: o.id, label: o.name }; });
      });
      var customerOptions = Vue.computed(function () {
        return ((store.meta && store.meta.customers) || []).map(function (c) { return { value: c.id, label: c.name }; });
      });
      var investigatorOptions = Vue.computed(function () {
        return ((store.meta && store.meta.employees) || []).filter(function (e) {
          return e.status === '在职';
        }).map(function (e) { return { value: e.id, label: e.name + '（' + e.post + '）' }; });
      });

      var steps = Vue.computed(function () {
        var st = record.value.status;
        var cur = st === 'archived' ? 3 : (st === 'pending_review' ? 2 : 1);
        var nodes = (store.meta && store.meta.workflow ? store.meta.workflow.nodes : []).map(function (n) {
          return { key: n.key, name: n.name, handler: n.handler };
        });
        var metas = [];
        metas[0] = record.value.reviewerName || me.value.name;
        metas[1] = st === 'pending_review' ? '待负责人审查' : (st === 'archived' ? '已完成（审查评价 ' + (record.value.review || '—') + '）' : '未开始');
        metas[2] = st === 'archived' ? (record.value.archive_time ? D.fmtDateTime(record.value.archive_time) : '已完成') : '未开始';
        return { current: cur, nodes: nodes.map(function (n, i) { return { key: n.key, name: n.name, handler: n.handler, meta: metas[i] || '' }; }) };
      });

      var scoreEvaluate = Vue.computed(function () { return D.calcReportScore(record.value); });
      var scoreGrade = Vue.computed(function () { return D.scoreToGrade(scoreEvaluate.value); });

      var saving = Vue.ref(false);
      var submitting = Vue.ref(false);

      function payload() {
        return {
          orgId: record.value.org_id, reportDate: record.value.report_date,
          customerId: record.value.customer_id, approved: record.value.approved,
          amount: record.value.amount, exposureAmount: record.value.exposure_amount,
          mainInvestigator: record.value.main_investigator,
          assistantInvestigator: record.value.assistant_investigator,
          firstResponsible: record.value.first_responsible,
          sys: record.value.score_sys, credit: record.value.score_credit,
          asset: record.value.score_asset, operate: record.value.score_operate,
          purpose: record.value.score_purpose, guarantee: record.value.score_guarantee,
          return1: record.value.return1, return2: record.value.return2,
          return3: record.value.return3, return4: record.value.return4
        };
      }

      function validateForSubmit() {
        if (!record.value.org_id || !record.value.customer_id || !record.value.report_date) return '经办机构、上报日期、客户名称必填';
        if (!record.value.main_investigator) return '主调查人必填';
        return '';
      }

      async function load() {
        loading.value = true;
        try {
          await global.LRUI.loadMeta();
          if (isNew.value) {
            record.value = blankRecord();
            record.value.reviewer = me.value.id;
            record.value.reviewerName = me.value.name;
            customer.value = {};
            timeline.value = [];
            attachments.value = [];
          } else {
            var data = await api.reports.get(router.route.params.id);
            record.value = data.item;
            customer.value = data.customer || {};
            timeline.value = data.timeline || [];
            attachments.value = (await api.reports.attachments(router.route.params.id)).items;
          }
        } catch (e) {
          global.LRUI.handle(e, '加载失败');
        }
        loading.value = false;
      }
      Vue.onMounted(load);

      async function saveDraft(silent) {
        saving.value = true;
        try {
          if (isNew.value) {
            var err = validateForSubmit();
            if (err) { global.LRUI.toast('warning', '无法保存', err); saving.value = false; return; }
            var res = await api.reports.create(payload());
            router.route.params.id = res.id;
            await load();
            if (!silent) global.LRUI.toast('success', '已保存草稿', '评价记录 ' + res.id + ' 已创建，可在待办中继续处理');
          } else {
            await api.reports.update(record.value.id, payload());
            await load();
            if (!silent) global.LRUI.toast('success', '已保存草稿', '评价内容已保存');
          }
        } catch (e) { global.LRUI.handle(e, '保存失败'); }
        saving.value = false;
      }

      async function submitToChief() {
        var empty = D.DIMENSIONS.filter(function (d) { return !record.value['score_' + d.key]; });
        if (empty.length) {
          global.LRUI.toast('warning', '无法提交', '还有 ' + empty.length + ' 个质量维度未评分：' + empty.map(function (d) { return d.label; }).join('、'));
          return;
        }
        submitting.value = true;
        try {
          if (isNew.value) {
            var err = validateForSubmit();
            if (err) { global.LRUI.toast('warning', '无法提交', err); submitting.value = false; return; }
            var res = await api.reports.create(payload());
            router.route.params.id = res.id;
            await api.reports.submit(res.id);
          } else {
            await api.reports.update(record.value.id, payload());
            await api.reports.submit(record.value.id);
          }
          await load();
          global.LRUI.refreshCounts();
          global.LRUI.toast('success', '已提交审查', '记录已流转至审批负责人审查评价，评价内容已锁定');
        } catch (e) { global.LRUI.handle(e, '提交失败'); }
        submitting.value = false;
      }

      /* 审查评价（负责人）：审查并归档 */
      var reviewForm = Vue.reactive({ grade: '', comment: '' });
      Vue.watch(canReview, function (v) {
        if (v) { reviewForm.grade = record.value.review || ''; reviewForm.comment = record.value.review_comment || ''; }
      }, { immediate: true });

      async function doReview() {
        if (!reviewForm.grade) {
          global.LRUI.toast('warning', '请先完成审查评价', '请选择审查评价等级后再归档');
          return;
        }
        if (!reviewForm.comment.trim()) {
          global.LRUI.toast('warning', '请填写审查意见', '审查意见必填，将作为审查工作评价的依据');
          return;
        }
        submitting.value = true;
        try {
          await api.reports.review(record.value.id, reviewForm.grade, reviewForm.comment);
          await load();
          global.LRUI.refreshCounts();
          global.LRUI.toast('success', '已归档', '报告 ' + record.value.id + ' 审查完成，数据已进入统计台账');
        } catch (e) { global.LRUI.handle(e, '审查失败'); }
        submitting.value = false;
      }

      /* 退回对话框 */
      var returnVisible = Vue.ref(false);
      var returnNote = Vue.ref('');
      function openReturn() { returnNote.value = ''; returnVisible.value = true; }
      async function doReturn() {
        if (!returnNote.value.trim()) {
          global.LRUI.toast('warning', '请填写退回原因', '说明需要修改的内容');
          return;
        }
        try {
          await api.reports.sendBack(record.value.id, returnNote.value.trim());
          returnVisible.value = false;
          await load();
          global.LRUI.refreshCounts();
          global.LRUI.toast('warning', '已退回修改', '记录已退回审批人员修改，修改后将重新进入待审查');
        } catch (e) { global.LRUI.handle(e, '退回失败'); }
      }

      function goBack() { router.go('report-list'); }

      /* 附件（审批人员上传，多个） */
      var attachments = Vue.ref([]);
      var attUploading = Vue.ref(false);
      function fmtSize(n) {
        if (!n && n !== 0) return '—';
        return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB'
          : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
      }
      async function uploadAttachments(e) {
        var files = e.target.files;
        if (!files || !files.length) return;
        attUploading.value = true;
        var ok = 0, fail = 0, failMsg = '';
        try {
          for (var i = 0; i < files.length; i++) {
            try { await api.reports.uploadAttachment(record.value.id, files[i]); ok += 1; }
            catch (err) {
              fail += 1;
              if (!failMsg) failMsg = files[i].name + '：' + (err && err.message ? err.message : '未知错误');
            }
          }
          if (fail) global.LRUI.toast('warning', '部分附件上传失败', ok + ' 个成功，' + fail + ' 个失败。' + failMsg);
          else global.LRUI.toast('success', '附件已上传', '共 ' + ok + ' 个文件');
          attachments.value = (await api.reports.attachments(record.value.id)).items;
        } catch (e2) { global.LRUI.handle(e2, '上传失败'); }
        e.target.value = '';
        attUploading.value = false;
      }
      function downloadAttachment(a) { global.window.open(api.reports.attachmentUrl(record.value.id, a.id)); }
      function deleteAttachment(a) {
        var dlg = global.TDesign.DialogPlugin.confirm({
          header: '删除确认',
          body: '确定删除附件「' + a.filename + '」吗？该操作不可恢复。',
          confirmBtn: { theme: 'danger', content: '删除' },
          cancelBtn: '取消',
          onConfirm: async function () {
            try {
              await api.reports.removeAttachment(record.value.id, a.id);
              attachments.value = (await api.reports.attachments(record.value.id)).items;
            } catch (e) { global.LRUI.handle(e, '删除失败'); }
            dlg.hide();
          }
        });
      }
      function canDeleteAttachment(a) { return a.uploaded_by === me.value.id || global.LRUI.hasPerm('report:delete'); }

      function confirmDelete() {
        var dlg = global.TDesign.DialogPlugin.confirm({
          header: '删除确认',
          body: '确定删除草稿记录 ' + record.value.id + '（' + (record.value.customerName || '—') + '）吗？该操作不可恢复。',
          confirmBtn: { theme: 'danger', content: '删除' },
          cancelBtn: '取消',
          onConfirm: async function () {
            try {
              await api.reports.remove(record.value.id);
              global.LRUI.toast('success', '已删除', record.value.id);
              goBack();
            } catch (e) { global.LRUI.handle(e, '删除失败'); }
            dlg.hide();
          }
        });
      }
      function refreshMeta() { return global.LRUI.loadMeta(true); }

      return {
        store: store, isNew: isNew, record: record, customer: customer, timeline: timeline, loading: loading,
        canEvaluate: canEvaluate, canReview: canReview, canDelete: canDelete,
        orgOptions: orgOptions, customerOptions: customerOptions, investigatorOptions: investigatorOptions,
        steps: steps, scoreEvaluate: scoreEvaluate, scoreGrade: scoreGrade,
        saving: saving, submitting: submitting,
        saveDraft: saveDraft, submitToChief: submitToChief,
        reviewForm: reviewForm, doReview: doReview,
        returnVisible: returnVisible, returnNote: returnNote, openReturn: openReturn, doReturn: doReturn,
        goBack: goBack, confirmDelete: confirmDelete, refreshMeta: refreshMeta,
        attachments: attachments, attUploading: attUploading,
        uploadAttachments: uploadAttachments, downloadAttachment: downloadAttachment,
        deleteAttachment: deleteAttachment, fmtSize: fmtSize, canDeleteAttachment: canDeleteAttachment,
        canScorePerm: canScorePerm,
        REVIEW_SCORES: D.REVIEW_SCORES,
        GRADE_MAP: D.GRADE_MAP, scoreToGrade: D.scoreToGrade, fmtAmount: D.fmtAmount, fmtDateTime: D.fmtDateTime
      };
    },
    template: [
      '<div v-if="loading">',
      '  <app-card><div style="text-align:center;padding:40px" class="text-secondary">加载中…</div></app-card>',
      '</div>',
      '<div v-else>',
      '  <page-header>',
      '    <template #title>',
      '      <div class="row gap-4" style="flex-wrap:wrap">',
      '        <span class="page-header__title">{{ isNew ? \'新建评价\' : (record.customerName || \'—\') }}</span>',
      '        <t-tag v-if="!isNew" :theme="STATUS_MAP[record.status].theme" variant="light">{{ STATUS_MAP[record.status].label }}</t-tag>',
      '      </div>',
      '      <p v-if="!isNew" class="page-header__desc">{{ record.id }} · {{ record.orgName }} · 上报日期 {{ record.report_date }} · 授信金额 {{ fmtAmount(record.amount) }} 万元 · 审批人 {{ record.reviewerName || \'—\' }}</p>',
      '    </template>',
      '    <t-button variant="outline" @click="goBack">',
      '      <template #icon><t-icon name="rollback" /></template>返回台账',
      '    </t-button>',
      '    <t-button v-if="canEvaluate" variant="outline" :loading="saving" @click="saveDraft()">保存</t-button>',
      '    <t-button v-if="canEvaluate" theme="primary" :loading="submitting" @click="submitToChief">',
      '      <template #icon><t-icon name="send" /></template>提交负责人审查',
      '    </t-button>',
      '    <t-button v-if="canDelete && !isNew && record.status === \'draft\'" variant="outline" theme="danger" @click="confirmDelete">',
      '      <template #icon><t-icon name="delete" /></template>删除',
      '    </t-button>',
      '  </page-header>',
      '',
      '  <app-card v-if="!isNew" title="工作流进度">',
      '    <flow-steps :current="steps.current" :nodes="steps.nodes" />',
      '    <div v-if="record.return_note" class="notice notice--warning mt-6">',
      '      <t-icon name="error-circle-filled" class="notice__icon" />',
      '      <span>负责人退回说明：{{ record.return_note }}</span>',
      '    </div>',
      '    <div v-if="canEvaluate" class="notice notice--brand mt-6">',
      '      <t-icon name="info-circle-filled" class="notice__icon" />',
      '      <span>提交后评价内容将锁定，如需修改请联系审批负责人退回；退回原因支持最多 4 次记录，计入客户经理考核。</span>',
      '    </div>',
      '  </app-card>',
      '',
      '  <app-card title="业务基本信息">',
      '    <div class="form-grid">',
      '      <div class="form-field">',
      '        <label class="form-field__label">经办机构</label>',
      '        <t-select v-if="canEvaluate" v-model="record.org_id" :options="orgOptions" size="small" />',
      '        <div v-else class="form-field__value">{{ record.orgName || record.org_id || \'—\' }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">上报日期</label>',
      '        <t-date-picker v-if="canEvaluate" v-model="record.report_date" valueType="YYYY-MM-DD" size="small" style="width:100%" />',
      '        <div v-else class="form-field__value">{{ record.report_date || \'—\' }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">客户名称</label>',
      '        <t-select v-if="canEvaluate" v-model="record.customer_id" :options="customerOptions" filterable size="small" placeholder=\'请选择客户，如无请到"客户信息"录入\' />',
      '        <div v-else class="form-field__value">{{ record.customerName || record.customer_id || \'—\' }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">是否核额</label>',
      '        <t-radio-group v-if="canEvaluate" v-model="record.approved" size="small">',
      '          <t-radio value="是">已核额</t-radio>',
      '          <t-radio value="否">未核额</t-radio>',
      '        </t-radio-group>',
      '        <div v-else class="form-field__value">{{ record.approved }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">授信金额（万元）</label>',
      '        <t-input-number v-if="canEvaluate" v-model="record.amount" :min="0" :step="10" size="small" style="width:100%" />',
      '        <div v-else class="form-field__value text-number">{{ fmtAmount(record.amount) }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">敞口金额（万元）</label>',
      '        <t-input-number v-if="canEvaluate" v-model="record.exposure_amount" :min="0" :step="10" size="small" style="width:100%" />',
      '        <div v-else class="form-field__value text-number">{{ fmtAmount(record.exposure_amount) }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">审批人</label>',
      '        <div class="form-field__value">{{ record.reviewerName || \'—\' }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">主调查人</label>',
      '        <t-select v-if="canEvaluate" v-model="record.main_investigator" :options="investigatorOptions" filterable size="small" />',
      '        <div v-else class="form-field__value">{{ record.mainInvestigatorName || \'—\' }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">辅助调查人</label>',
      '        <t-select v-if="canEvaluate" v-model="record.assistant_investigator" :options="investigatorOptions" filterable clearable size="small" placeholder="无" />',
      '        <div v-else class="form-field__value" :class="record.assistantInvestigatorName ? \'\' : \'form-field__value--muted\'">{{ record.assistantInvestigatorName || \'无\' }}</div>',
      '      </div>',
      '      <div class="form-field">',
      '        <label class="form-field__label">第一责任人</label>',
      '        <t-select v-if="canEvaluate" v-model="record.first_responsible" :options="investigatorOptions" filterable size="small" />',
      '        <div v-else class="form-field__value">{{ record.firstResponsibleName || \'—\' }}</div>',
      '      </div>',
      '    </div>',
      '    <div v-if="customer && customer.industry" class="notice notice--brand mt-6">',
      '      <t-icon name="creditcard" class="notice__icon" />',
      '      <span>客户档案：{{ customer.industry }} · {{ customer.scale }}</span>',
      '    </div>',
      '  </app-card>',
      '',
      '  <div class="grid-2-1">',
      '    <app-card title="分析质量评分">',
      '      <div v-for="d in DIMENSIONS" :key="d.key" class="dim-row">',
      '        <div style="min-width:0">',
      '          <div class="dim-row__label">{{ d.label }}</div>',
      '          <div class="dim-row__tip">{{ d.tip }}</div>',
      '        </div>',
      '        <div class="dim-row__value">',
      '          <grade-picker v-model="record[\'score_\' + d.key]" :disabled="!canEvaluate" />',
      '          <span class="dim-row__score text-number">{{ GRADE_MAP[record[\'score_\' + d.key]] ? GRADE_MAP[record[\'score_\' + d.key]].score + \' 分\' : \'—\' }}</span>',
      '        </div>',
      '      </div>',
      '      <div class="row row--between mt-6" style="padding-top:16px;border-top:1px solid var(--td-border-level-1-color)">',
      '        <div>',
      '          <div class="text-secondary text-sm">报告得分（六维平均，考核客户经理）</div>',
      '          <div class="row gap-4" style="align-items:baseline">',
      '            <span style="font-size:28px;font-weight:600;line-height:36px" class="text-number">{{ scoreEvaluate != null ? scoreEvaluate : \'—\' }}</span>',
      '            <span class="text-sm text-placeholder">分</span>',
      '            <grade-pill v-if="scoreEvaluate != null" :grade="scoreGrade" />',
      '          </div>',
      '        </div>',
      '        <div style="text-align:right">',
      '          <div class="text-secondary text-sm">审查评价（负责人单列打分）</div>',
      '          <div class="row gap-4" style="align-items:baseline;justify-content:flex-end">',
      '            <span style="font-size:28px;font-weight:600;line-height:36px" class="text-number">{{ record.review ? REVIEW_SCORES[record.review] : \'—\' }}</span>',
      '            <grade-pill v-if="record.review" :grade="record.review" />',
      '          </div>',
      '        </div>',
      '      </div>',
      '    </app-card>',
      '',
      '    <app-card title="得分构成">',
      '      <div v-for="d in DIMENSIONS" :key="d.key" style="margin-bottom:14px">',
      '        <div class="row row--between text-sm" style="margin-bottom:4px">',
      '          <span class="text-secondary">{{ d.label.replace(\'质量\',\'\') }}</span>',
      '          <span class="text-number">{{ GRADE_MAP[record[\'score_\' + d.key]] ? GRADE_MAP[record[\'score_\' + d.key]].score : \'—\' }}</span>',
      '        </div>',
      '        <div class="stat-bar">',
      '          <div class="stat-bar__fill"',
      '            :class="GRADE_MAP[record[\'score_\' + d.key]] && GRADE_MAP[record[\'score_\' + d.key]].score < 85 ? \'stat-bar__fill--warning\' : \'\'"',
      '            :style="{ width: (GRADE_MAP[record[\'score_\' + d.key]] ? GRADE_MAP[record[\'score_\' + d.key]].score : 0) + \'%\' }"></div>',
      '        </div>',
      '      </div>',
      '      <div class="notice notice--brand">',
      '        <t-icon name="tips" class="notice__icon" />',
      '        <span class="text-sm">短板维度自动进入「统计分析 → 六维短板分析」排名，作为培训选题依据。</span>',
      '      </div>',
      '    </app-card>',
      '  </div>',
      '',
      '  <app-card title="退回原因登记">',
      '    <div v-for="i in 4" :key="i" style="margin-bottom:16px">',
      '      <label class="form-field__label">第 {{ i }} 次退回原因',
      '        <span v-if="!record[\'return\' + i]" class="text-placeholder" style="font-weight:400">（未登记）</span>',
      '      </label>',
      '      <t-textarea v-if="canEvaluate" v-model="record[\'return\' + i]" :autosize="{ minRows: 2, maxRows: 5 }"',
      '        :placeholder="\'请填写第 \' + i + \' 次退回的具体原因，将计入客户经理考核\'" />',
      '      <div v-else-if="record[\'return\' + i]" style="padding:10px 12px;background:var(--td-bg-color-secondarycontainer);border-radius:var(--td-radius-default);font-size:13px;line-height:22px">{{ record[\'return\' + i] }}</div>',
      '      <div v-else class="form-field__value form-field__value--muted">—</div>',
      '    </div>',
      '  </app-card>',
      '',
      '  <app-card v-if="!isNew" title="附件">',
      '    <div class="row gap-4" style="margin-bottom:12px" v-if="canScorePerm">',
      '      <label class="t-button t-button--variant-outline t-button--theme-default" style="cursor:pointer;position:relative;overflow:hidden"',
      '        :class="attUploading ? \'t-is-loading\' : \'\'">',
      '        <input type="file" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer" @change="uploadAttachments" />',
      '        {{ attUploading ? \'上传中…\' : \'上传附件（可多选）\' }}',
      '      </label>',
      '      <span class="text-sm text-placeholder">由审批人员上传，支持多选；单个文件不超过 50MB。</span>',
      '    </div>',
      '    <div v-if="!attachments.length" class="form-field__value form-field__value--muted">暂无附件</div>',
      '    <div v-else>',
      '      <div v-for="a in attachments" :key="a.id" class="row row--between" style="padding:8px 0;border-bottom:1px solid var(--td-border-level-1-color)">',
      '        <div class="row gap-4" style="min-width:0">',
      '          <t-icon name="attach" />',
      '          <t-link theme="primary" hover="color" @click="downloadAttachment(a)">{{ a.filename }}</t-link>',
      '          <span class="text-sm text-placeholder">{{ fmtSize(a.size) }} · {{ a.uploaderName || \'—\' }} · {{ fmtDateTime(a.created_at) }}</span>',
      '        </div>',
      '        <t-link v-if="canDeleteAttachment(a)" theme="danger" hover="color" @click="deleteAttachment(a)">删除</t-link>',
      '      </div>',
      '    </div>',
      '  </app-card>',
      '',
      '  <app-card title="审查评价" :desc="canReview ? \'评价对象：审批人（\' + (record.reviewerName || \'—\') + \'）的审查工作 —— 请对其评分的客观性、退回登记的规范性进行评价\' : \'由审批负责人对审批人员的审查工作进行评价打分并填写意见\'">',
      '    <div class="row row--between" style="align-items:flex-start;gap:24px;flex-wrap:wrap">',
      '      <div>',
      '        <label class="form-field__label">审查评价等级（优90 / 良80 / 中70 / 差50）</label>',
      '        <grade-picker v-model="reviewForm.grade" :score-map="REVIEW_SCORES" :disabled="!canReview" />',
      '      </div>',
      '      <div style="text-align:right">',
      '        <div class="text-secondary text-sm">审查人</div>',
      '        <div style="font-size:14px">{{ record.reviewByName ? record.reviewByName + \'（审批负责人）\' : \'待负责人审查\' }}</div>',
      '      </div>',
      '    </div>',
      '    <div class="mt-6">',
      '      <label class="form-field__label">审查意见</label>',
      '      <t-textarea v-if="canReview" v-model="reviewForm.comment" :autosize="{ minRows: 3, maxRows: 6 }"',
      '        placeholder="请填写审查意见，例如：六维评分客观、与报告质量匹配，退回原因登记规范，审查工作质量良好。" />',
      '      <div v-else-if="record.review_comment" style="padding:10px 12px;background:var(--td-bg-color-secondarycontainer);border-radius:var(--td-radius-default);font-size:13px;line-height:22px">',
      '        {{ record.review_comment }}',
      '      </div>',
      '      <div v-else class="form-field__value form-field__value--muted">',
      '        {{ canReview ? \'请填写审查意见\' : \'审批负责人尚未填写审查意见\' }}',
      '      </div>',
      '    </div>',
      '    <div v-if="canReview" class="row gap-4 mt-6" style="justify-content:flex-end">',
      '      <t-button variant="outline" theme="warning" @click="openReturn">',
      '        <template #icon><t-icon name="rollback" /></template>退回评价修改',
      '      </t-button>',
      '      <t-button theme="primary" :loading="submitting" @click="doReview">',
      '        <template #icon><t-icon name="check-circle-filled" /></template>完成审查并归档',
      '      </t-button>',
      '    </div>',
      '  </app-card>',
      '',
      '  <app-card v-if="!isNew && timeline.length" title="流转记录" desc="工作流关键动作留痕" flush>',
      '    <t-table :data="timeline" row-key="created_at" size="small" hover',
      '      :columns="[{ colKey: \'created_at\', title: \'时间\', width: 170 }, { colKey: \'employee_name\', title: \'操作人\', width: 120 }, { colKey: \'action\', title: \'动作\', width: 100 }, { colKey: \'detail\', title: \'说明\' }]">',
      '      <template #created_at="{ row }"><span class="text-secondary">{{ fmtDateTime(row.created_at) }}</span></template>',
      '      <template #action="{ row }">',
      '        <t-tag theme="primary" variant="light">{{ { create: \'登记\', update: \'修改\', revise: \'修改(退回后)\', submit: \'提交\', review: \'审查评价\', return: \'退回\', import: \'导入\' }[row.action] || row.action }}</t-tag>',
      '      </template>',
      '    </t-table>',
      '  </app-card>',
      '',
      '  <t-dialog v-model:visible="returnVisible" header="退回评价修改" :close-on-overlay-click="false"',
      '    :confirm-btn="{ content: \'确认退回\', theme: \'warning\' }" @confirm="doReturn">',
      '    <div class="notice notice--warning" style="margin-bottom:12px">',
      '      <t-icon name="error-circle-filled" class="notice__icon" />',
      '      <span class="text-sm">退回后记录将重新进入审批人员的待办，修改并重新提交后再次进入您的待审查列表。</span>',
      '    </div>',
      '    <div class="form-field"><label class="form-field__label">退回说明（必填）</label>',
      '      <t-textarea v-model="returnNote" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="例如：用途维度评分依据不足，请复核后重新提交" /></div>',
      '  </t-dialog>',
      '</div>'
    ].join('')
  };
})(window);
