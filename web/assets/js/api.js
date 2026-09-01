/**
 * API 客户端层 —— 全部数据交互走后端 REST 接口（替代原型的内存 mock）。
 * 约定：后端返回 {error} 视为失败，抛出 Error(message) 由视图层 toast。
 */
(function (global) {
  'use strict';

  function buildQuery(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) {
        if (v.length === 2) { parts.push(encodeURIComponent(k + 'From') + '=' + encodeURIComponent(v[0])); parts.push(encodeURIComponent(k + 'To') + '=' + encodeURIComponent(v[1])); }
        return;
      }
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function call(method, path, body, raw) {
    var headers = {};
    if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
    var res = await fetch(path, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
      body: raw ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });
    var type = res.headers.get('content-type') || '';
    var data = type.indexOf('json') >= 0 ? await res.json() : await res.arrayBuffer();
    if (!res.ok) {
      var msg = (data && data.error) || ('请求失败（' + res.status + '）');
      var err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  var api = {
    call: call,

    /* ---- 公共 ---- */
    health: function () { return call('GET', '/api/health'); },

    /* ---- 认证 ---- */
    login: function (no, password) { return call('POST', '/api/auth/login', { no: no, password: password }); },
    logout: function () { return call('POST', '/api/auth/logout'); },
    me: function () { return call('GET', '/api/auth/me'); },
    changePassword: function (oldPassword, newPassword) {
      return call('POST', '/api/auth/password', { oldPassword: oldPassword, newPassword: newPassword });
    },

    /* ---- 元数据 ---- */
    meta: function () { return call('GET', '/api/meta'); },

    /* ---- 评价台账 ---- */
    reports: {
      list: function (params) { return call('GET', '/api/reports' + buildQuery(params)); },
      get: function (id) { return call('GET', '/api/reports/' + encodeURIComponent(id)); },
      create: function (payload) { return call('POST', '/api/reports', payload); },
      update: function (id, payload) { return call('PUT', '/api/reports/' + encodeURIComponent(id), payload); },
      submit: function (id) { return call('POST', '/api/reports/' + encodeURIComponent(id) + '/submit'); },
      review: function (id, grade, comment) {
        return call('POST', '/api/reports/' + encodeURIComponent(id) + '/review', { grade: grade, comment: comment });
      },
      sendBack: function (id, note) {
        return call('POST', '/api/reports/' + encodeURIComponent(id) + '/return', { note: note });
      },
      remove: function (id) { return call('DELETE', '/api/reports/' + encodeURIComponent(id)); },
      attachments: function (id) { return call('GET', '/api/reports/' + encodeURIComponent(id) + '/attachments'); },
      uploadAttachment: async function (id, file) {
        var buf = await file.arrayBuffer();
        return call('POST', '/api/reports/' + encodeURIComponent(id) + '/attachments' + buildQuery({ name: file.name }), buf, true);
      },
      removeAttachment: function (id, attId) {
        return call('DELETE', '/api/reports/' + encodeURIComponent(id) + '/attachments/' + attId);
      },
      attachmentUrl: function (id, attId) {
        return '/api/reports/' + encodeURIComponent(id) + '/attachments/' + attId;
      }
    },

    /* ---- 待办 / 已办 ---- */
    tasks: {
      list: function (box) { return call('GET', '/api/tasks?box=' + box); },
      counts: function () { return call('GET', '/api/tasks/counts'); }
    },

    /* ---- 统计 ---- */
    stats: {
      summary: function (params) { return call('GET', '/api/stats/summary' + buildQuery(params)); },
      trend: function (params) { return call('GET', '/api/stats/trend' + buildQuery(params)); },
      aggregate: function (params) { return call('GET', '/api/stats/aggregate' + buildQuery(params)); },
      dimAvg: function (params) { return call('GET', '/api/stats/dim-avg' + buildQuery(params)); }
    },

    /* ---- 主数据 ---- */
    orgs: {
      list: function () { return call('GET', '/api/orgs'); },
      create: function (payload) { return call('POST', '/api/orgs', payload); },
      update: function (id, payload) { return call('PUT', '/api/orgs/' + encodeURIComponent(id), payload); },
      remove: function (id) { return call('DELETE', '/api/orgs/' + encodeURIComponent(id)); }
    },
    employees: {
      list: function () { return call('GET', '/api/employees'); },
      create: function (payload) { return call('POST', '/api/employees', payload); },
      update: function (id, payload) { return call('PUT', '/api/employees/' + encodeURIComponent(id), payload); },
      remove: function (id) { return call('DELETE', '/api/employees/' + encodeURIComponent(id)); },
      resetPassword: function (id, password) {
        return call('POST', '/api/employees/' + encodeURIComponent(id) + '/reset-password', { password: password });
      }
    },
    roles: {
      list: function () { return call('GET', '/api/roles'); },
      updatePerms: function (key, perms) { return call('PUT', '/api/roles/' + encodeURIComponent(key) + '/perms', { perms: perms }); }
    },
    customers: {
      list: function (keyword) { return call('GET', '/api/customers' + buildQuery({ keyword: keyword })); },
      create: function (payload) { return call('POST', '/api/customers', payload); },
      update: function (id, payload) { return call('PUT', '/api/customers/' + encodeURIComponent(id), payload); },
      remove: function (id) { return call('DELETE', '/api/customers/' + encodeURIComponent(id)); }
    },

    /* ---- 工作流 ---- */
    workflow: function () { return call('GET', '/api/workflow'); },

    /* ---- Excel（下载走直链，导入走字节流上传） ---- */
    excel: {
      templateUrl: '/api/excel/template',
      employeeTemplateUrl: '/api/excel/employee-template',
      orgTemplateUrl: '/api/excel/org-template',
      exportReportsUrl: function (params) { return '/api/excel/export/reports' + buildQuery(params); },
      exportStatsUrl: function (params) { return '/api/excel/export/stats' + buildQuery(params); },
      import: async function (file, autoCreateCustomer) {
        var buf = await file.arrayBuffer();
        return call('POST', '/api/excel/import?autoCreateCustomer=' + (autoCreateCustomer ? '1' : '0'), buf, true);
      },
      importEmployees: async function (file) {
        var buf = await file.arrayBuffer();
        return call('POST', '/api/excel/import-employees', buf, true);
      },
      importOrgs: async function (file) {
        var buf = await file.arrayBuffer();
        return call('POST', '/api/excel/import-orgs', buf, true);
      }
    }
  };

  global.LRAPI = api;
})(window);
