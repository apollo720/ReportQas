/**
 * 图表层 —— 基于 ECharts，配色严格对齐 TDesign 语义色
 * 若 CDN 未加载 echarts，自动降级为「数据概览」文字卡片，保证页面不白屏。
 */
(function (global) {
  'use strict';

  var C = {
    brand: '#0052D9',
    brandHover: '#366EF4',
    success: '#2BA471',
    warning: '#E37318',
    error: '#D54941',
    textPrimary: 'rgba(0,0,0,0.9)',
    textSecondary: 'rgba(0,0,0,0.6)',
    textPlaceholder: 'rgba(0,0,0,0.4)',
    stroke: '#E8E8E8',
    split: '#EEEEEE'
  };

  var BASE = {
    textStyle: { fontFamily: '"PingFang SC", "Microsoft YaHei", Arial, sans-serif', color: C.textSecondary },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: '#FFFFFF',
      borderColor: C.stroke,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: C.textPrimary, fontSize: 12 },
      extraCssText: 'box-shadow: 0 3px 14px rgba(0,0,0,0.08); border-radius: 6px;'
    }
  };

  function merge(target, source) {
    Object.keys(source || {}).forEach(function (k) { target[k] = source[k]; });
    return target;
  }

  function axisLine() {
    return { lineStyle: { color: C.stroke } };
  }
  function splitLine() {
    return { lineStyle: { color: C.split, type: 'dashed' } };
  }

  /** 折线图：得分趋势 */
  function lineOption(opts) {
    var series = opts.series.map(function (s, i) {
      return {
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: s.data,
        yAxisIndex: s.axis === 'right' ? 1 : 0,
        lineStyle: { width: 2, color: s.color || (i === 0 ? C.brand : C.success) },
        itemStyle: { color: s.color || (i === 0 ? C.brand : C.success) },
        areaStyle: s.area ? {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0,82,217,0.18)' },
              { offset: 1, color: 'rgba(0,82,217,0.01)' }
            ]
          }
        } : null
      };
    });
    return merge(merge({}, BASE), {
      legend: { data: opts.series.map(function (s) { return s.name; }), right: 0, top: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: C.textSecondary, fontSize: 12 } },
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: opts.labels, boundaryGap: false, axisLine: axisLine(), axisTick: { show: false }, axisLabel: { color: C.textPlaceholder, fontSize: 12 } },
      yAxis: [
        { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: splitLine(), axisLabel: { color: C.textPlaceholder, fontSize: 12 } },
        { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: C.textPlaceholder, fontSize: 12 } }
      ],
      series: series
    });
  }

  /** 柱状图：分组对比 */
  function barOption(opts) {
    return merge(merge({}, BASE), {
      legend: { show: opts.series.length > 1, data: opts.series.map(function (s) { return s.name; }), right: 0, top: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: C.textSecondary, fontSize: 12 } },
      grid: { left: 8, right: 16, top: opts.series.length > 1 ? 40 : 24, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: opts.labels, axisLine: axisLine(), axisTick: { show: false }, axisLabel: { color: C.textPlaceholder, fontSize: 12, interval: 0, rotate: opts.rotate || 0 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: splitLine(), axisLabel: { color: C.textPlaceholder, fontSize: 12 } },
      series: opts.series.map(function (s, i) {
        return {
          name: s.name,
          type: 'bar',
          barMaxWidth: 28,
          itemStyle: { color: s.color || (i === 0 ? C.brand : C.success), borderRadius: [3, 3, 0, 0] },
          data: s.data
        };
      })
    });
  }

  /** 环形图：等级分布 */
  function pieOption(opts) {
    return merge(merge({}, BASE), {
      tooltip: merge(merge({}, BASE.tooltip), { trigger: 'item', formatter: '{b}: {c} 笔 ({d}%)' }),
      legend: { orient: 'vertical', right: 8, top: 'middle', itemWidth: 10, itemHeight: 10, textStyle: { color: C.textSecondary, fontSize: 12 } },
      series: [{
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['38%', '52%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data: opts.data
      }]
    });
  }

  /** 雷达图：六维短板分析 */
  function radarOption(opts) {
    return merge(merge({}, BASE), {
      legend: { show: false },
      radar: {
        center: ['50%', '54%'],
        radius: '66%',
        indicator: opts.indicators,
        axisName: { color: C.textSecondary, fontSize: 12 },
        splitLine: { lineStyle: { color: C.split } },
        splitArea: { areaStyle: { color: ['#FFFFFF', '#FAFAFA'] } },
        axisLine: { lineStyle: { color: C.stroke } }
      },
      series: [{
        type: 'radar',
        symbolSize: 5,
        itemStyle: { color: C.brand },
        lineStyle: { color: C.brand, width: 2 },
        areaStyle: { color: 'rgba(0,82,217,0.16)' },
        data: opts.data
      }]
    });
  }

  /** 挂载图表；返回实例（或 null 表示降级） */
  function render(el, option) {
    if (!el) return null;
    if (!global.echarts) {
      el.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;'
        + 'color:var(--td-text-color-placeholder);font-size:12px;background:var(--td-bg-color-secondarycontainer);'
        + 'border-radius:var(--td-radius-medium);text-align:center;padding:0 16px">'
        + '图表组件未加载（离线环境），统计数据请以右侧明细表为准</div>';
      return null;
    }
    var chart = global.echarts.getInstanceByDom(el) || global.echarts.init(el);
    chart.setOption(option, true);
    return chart;
  }

  global.LRChart = {
    colors: C,
    lineOption: lineOption,
    barOption: barOption,
    pieOption: pieOption,
    radarOption: radarOption,
    render: render,
    resize: function () {
      if (!global.echarts) return;
      var els = document.querySelectorAll('.chart');
      for (var i = 0; i < els.length; i++) {
        var c = global.echarts.getInstanceByDom(els[i]);
        if (c) c.resize();
      }
    }
  };
})(window);
