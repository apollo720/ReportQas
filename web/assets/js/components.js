/**
 * 公共组件层 —— 业务语义组件（评分器 / 等级标签 / KPI / 卡片 / 页头）
 * 全部使用 TDesign Token，遵循「有色实心底 → 文字反色」规范。
 */
(function (global) {
  'use strict';

  var Vue = global.Vue;
  var D = global.LRDICT;

  /* ------------------------------------------------------------------ *
   * 等级标签
   * ------------------------------------------------------------------ */
  var GradePill = {
    name: 'GradePill',
    props: {
      grade: { type: String, default: '' },
      showScore: { type: Boolean, default: false }
    },
    setup: function (props) {
      var theme = Vue.computed(function () {
        var g = D.GRADE_MAP[props.grade];
        return g ? g.theme : 'empty';
      });
      var text = Vue.computed(function () {
        var g = D.GRADE_MAP[props.grade];
        if (!g) return '未评';
        return props.showScore ? (g.key + ' ' + g.score) : g.key;
      });
      return { theme: theme, text: text };
    },
    template:
      '<span class="grade-pill" :class="\'grade-pill--\' + theme">{{ text }}</span>'
  };

  /* ------------------------------------------------------------------ *
   * 评分选择器：优(100) / 良(90) / 中(80) / 差(70)
   * ------------------------------------------------------------------ */
  var GradePicker = {
    name: 'GradePicker',
    props: {
      modelValue: { type: String, default: '' },
      disabled: { type: Boolean, default: false },
      scoreMap: { type: Object, default: null } /* 覆盖各等级显示分值（如审查评价） */
    },
    emits: ['update:modelValue', 'change'],
    setup: function (props, ctx) {
      function pick(g) {
        if (props.disabled) return;
        ctx.emit('update:modelValue', g.key);
        ctx.emit('change', g.key);
      }
      function scoreOf(g) {
        return (props.scoreMap && props.scoreMap[g.key] != null) ? props.scoreMap[g.key] : g.score;
      }
      return { grades: D.GRADES, pick: pick, scoreOf: scoreOf };
    },
    template: [
      '<div class="grade-picker">',
      '  <button v-for="g in grades" :key="g.key" type="button"',
      '    class="grade-picker__opt"',
      '    :class="modelValue === g.key ? \'grade-picker__opt--\' + g.theme : \'\'"',
      '    :disabled="disabled"',
      '    @click="pick(g)">',
      '    <span>{{ g.key }}</span>',
      '    <span class="grade-picker__score">{{ scoreOf(g) }}</span>',
      '  </button>',
      '</div>'
    ].join('')
  };

  /* ------------------------------------------------------------------ *
   * KPI 指标卡
   * ------------------------------------------------------------------ */
  var AppKpi = {
    name: 'AppKpi',
    props: {
      icon: { type: String, default: 'chart-bubble' },
      theme: { type: String, default: 'brand' },
      label: { type: String, default: '' },
      value: { type: [String, Number], default: '' },
      unit: { type: String, default: '' },
      extra: { type: String, default: '' },
      trend: { type: String, default: '' }
    },
    template: [
      '<div class="kpi">',
      '  <div class="kpi__icon" :class="\'kpi__icon--\' + theme">',
      '    <t-icon :name="icon" />',
      '  </div>',
      '  <div style="min-width:0">',
      '    <div class="kpi__label">{{ label }}</div>',
      '    <div class="kpi__value text-number">{{ value }}<span v-if="unit" style="font-size:13px;font-weight:400;color:var(--td-text-color-placeholder);margin-left:2px">{{ unit }}</span></div>',
      '    <div v-if="extra" class="kpi__extra">',
      '      <span v-if="trend" :class="trend === \'up\' ? \'kpi__trend--up\' : \'kpi__trend--down\'">{{ trend === \'up\' ? \'↑\' : \'↓\' }}</span>{{ extra }}',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('')
  };

  /* ------------------------------------------------------------------ *
   * 卡片
   * ------------------------------------------------------------------ */
  var AppCard = {
    name: 'AppCard',
    props: {
      title: { type: String, default: '' },
      desc: { type: String, default: '' },
      flush: { type: Boolean, default: false },
      foot: { type: String, default: '' }
    },
    template: [
      '<section class="card">',
      '  <div v-if="title || $slots.extra" class="card__head">',
      '    <div>',
      '      <div class="card__title">{{ title }}</div>',
      '      <div v-if="desc" class="card__desc">{{ desc }}</div>',
      '    </div>',
      '    <div class="row gap-4"><slot name="extra" /></div>',
      '  </div>',
      '  <div class="card__body" :class="flush ? \'card__body--flush\' : \'\'"><slot /></div>',
      '  <div v-if="foot || $slots.foot" class="card__foot">',
      '    <span>{{ foot }}</span>',
      '    <slot name="foot" />',
      '  </div>',
      '</section>'
    ].join('')
  };

  /* ------------------------------------------------------------------ *
   * 页头
   * ------------------------------------------------------------------ */
  var PageHeader = {
    name: 'PageHeader',
    props: {
      title: { type: String, default: '' },
      desc: { type: String, default: '' }
    },
    template: [
      '<div class="page-header">',
      '  <div>',
      '    <slot name="title">',
      '      <h1 class="page-header__title">{{ title }}</h1>',
      '      <p v-if="desc" class="page-header__desc">{{ desc }}</p>',
      '    </slot>',
      '  </div>',
      '  <div class="page-header__actions"><slot /></div>',
      '</div>'
    ].join('')
  };

  /* ------------------------------------------------------------------ *
   * 表单字段（详情只读态）
   * ------------------------------------------------------------------ */
  var FormField = {
    name: 'FormField',
    props: {
      label: { type: String, default: '' },
      value: { type: [String, Number], default: '' },
      muted: { type: Boolean, default: false }
    },
    template: [
      '<div class="form-field">',
      '  <label class="form-field__label">{{ label }}</label>',
      '  <div class="form-field__value" :class="muted ? \'form-field__value--muted\' : \'\'">{{ value || "—" }}<slot /></div>',
      '</div>'
    ].join('')
  };

  /* ------------------------------------------------------------------ *
   * 工作流步骤条
   * ------------------------------------------------------------------ */
  var FlowSteps = {
    name: 'FlowSteps',
    props: {
      /** 当前处于第几个节点（1 起） */
      current: { type: Number, default: 1 },
      nodes: { type: Array, default: function () { return []; } }
    },
    setup: function (props) {
      function state(i) {
        if (i + 1 < props.current) return 'done';
        if (i + 1 === props.current) return 'current';
        return 'todo';
      }
      return { state: state };
    },
    template: [
      '<div class="flow-steps">',
      '  <template v-for="(n, i) in nodes" :key="n.key">',
      '    <div v-if="i > 0" class="flow-step__line" :class="state(i) !== \'todo\' ? \'flow-step__line--done\' : \'\'"></div>',
      '    <div class="flow-step">',
      '      <div class="flow-step__dot" :class="\'flow-step__dot--\' + state(i)">',
      '        <t-icon v-if="state(i) === \'done\'" name="check" size="16" />',
      '        <span v-else>{{ i + 1 }}</span>',
      '      </div>',
      '      <div style="min-width:0">',
      '        <div class="flow-step__name" :class="state(i) === \'todo\' ? \'flow-step__name--muted\' : \'\'">{{ n.name }}</div>',
      '        <div class="flow-step__meta">{{ n.handler }}<span v-if="n.meta"> · {{ n.meta }}</span></div>',
      '      </div>',
      '    </div>',
      '  </template>',
      '</div>'
    ].join('')
  };

  global.LRComponents = {
    GradePill: GradePill,
    GradePicker: GradePicker,
    AppKpi: AppKpi,
    AppCard: AppCard,
    PageHeader: PageHeader,
    FormField: FormField,
    FlowSteps: FlowSteps
  };
})(window);
