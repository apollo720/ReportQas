/**
 * 应用主控 —— 会话管理 / 路由 / 权限菜单 / 根组件 / 启动
 * 登录态来自服务端会话（HttpOnly Cookie），菜单与权限由 /api/auth/me 下发。
 */
(function (global) {
  'use strict';

  var Vue = global.Vue;
  var TDesign = global.TDesign;
  var Icons = global.TDesignIconVueNext;
  var D = global.LRDICT;
  var api = global.LRAPI;

  /* ------------------------------------------------------------------ *
   * 图标注册
   * ------------------------------------------------------------------ */
  var ICON_NAMES = [
    'dashboard', 'file-paste', 'list', 'task', 'chart-bubble', 'chart-bar', 'chart-pie',
    'user-circle', 'usergroup', 'user', 'root-list', 'setting', 'secured', 'lock-on', 'swap',
    'add', 'search', 'download', 'upload', 'edit', 'delete', 'refresh', 'filter', 'more',
    'rollback', 'send', 'check', 'close', 'check-circle-filled', 'close-circle-filled',
    'info-circle-filled', 'error-circle-filled', 'time-filled', 'error-circle', 'help-circle',
    'notification', 'chevron-down', 'chevron-right', 'login', 'logout', 'tips', 'flag',
    'calendar', 'creditcard', 'wallet', 'shop', 'layers', 'arrow-up', 'arrow-down',
    'history', 'star', 'bulletpoint', 'link', 'building', 'folder-open', 'file-excel',
    'browse', 'user-add'
  ];

  function toPascal(name) {
    return name.split('-').map(function (p) {
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * 状态仓库
   * ------------------------------------------------------------------ */
  var store = Vue.reactive({
    user: null,          /* 服务端会话用户（含 perms / menus / roles） */
    counts: { evaluate: 0, returned: 0, review: 0, returnedByChief: 0 },
    meta: null,          /* 主数据/字典缓存（机构、员工、客户等） */
    version: '',         /* 服务版本号（/api/health 下发） */
    collapsed: false,
    booted: false
  });

  var router = {
    route: Vue.reactive({ name: 'dashboard', params: {} }),
    go: function (name, params) {
      router.route.name = name;
      router.route.params = params || {};
      var hash = '#/' + name + (params && params.id ? '/' + params.id : '');
      if (global.location.hash !== hash) global.location.hash = hash;
      var el = document.querySelector('.app-content');
      if (el) el.scrollTop = 0;
      refreshCounts();
    },
    parse: function () {
      var seg = (global.location.hash || '').replace(/^#\/?/, '').split('/');
      var name = seg[0] || 'dashboard';
      var params = seg[1] ? { id: decodeURIComponent(seg[1]) } : {};
      router.route.name = name;
      router.route.params = params;
    }
  };

  function refreshCounts() {
    if (!store.user) return;
    api.tasks.counts().then(function (c) { Object.assign(store.counts, c); }).catch(function () {});
  }

  function hasPerm(perm) {
    return !!(store.user && store.user.perms.indexOf(perm) >= 0);
  }

  /* ------------------------------------------------------------------ *
   * 全局交互
   * ------------------------------------------------------------------ */
  var LRUI = {
    toast: function (type, title, content) {
      var text = title ? title + '：' + (content || '') : (content || '');
      var fn = { success: 'success', warning: 'warning', error: 'error', info: 'info' }[type] || 'info';
      if (TDesign && TDesign.MessagePlugin && TDesign.MessagePlugin[fn]) {
        TDesign.MessagePlugin[fn](text);
      } else {
        global.alert(text);
      }
    },
    handle: function (e, fallback) {
      LRUI.toast('error', (fallback || '操作失败'), (e && e.message) || '未知错误');
    },
    login: async function (no, password) {
      var data = await api.login(no, password);
      store.user = data.user;
      Object.assign(store.counts, data.counts || {});
      router.go('dashboard');
      LRUI.toast('success', '登录成功', '当前身份：' + store.user.roles.map(function (r) { return r.name; }).join('、') + '（' + store.user.name + '）');
    },
    logout: async function () {
      try { await api.logout(); } catch (e) { /* 会话可能已过期 */ }
      store.user = null;
      router.go('dashboard');
    },
    refreshCounts: refreshCounts,
    hasPerm: hasPerm,
    loadMeta: async function (force) {
      if (store.meta && !force) return store.meta;
      store.meta = await api.meta();
      return store.meta;
    }
  };

  global.LRStore = store;
  global.LRRouter = router;
  global.LRUI = LRUI;
  global.LRComponents = global.LRComponents || {};

  /* ------------------------------------------------------------------ *
   * 根组件
   * ------------------------------------------------------------------ */
  var App = {
    name: 'App',
    setup: function () {
      var collapsed = Vue.computed(function () { return store.collapsed; });
      var menus = Vue.computed(function () { return store.user ? store.user.menus : []; });

      var activeMenu = Vue.computed({
        get: function () { return router.route.name; },
        set: function (v) { if (v && v !== router.route.name) router.go(v); }
      });

      var currentTitle = Vue.computed(function () {
        var name = router.route.name;
        var found = null;
        menus.value.forEach(function (m) {
          if (m.key === name) found = m;
          (m.children || []).forEach(function (c) { if (c.key === name) found = c; });
        });
        return found ? found.title : '工作台';
      });

      var currentView = Vue.computed(function () {
        return global.LRViews[router.route.name] || global.LRViews.dashboard;
      });

      /* 菜单角标：负责人 → 待审查数；审批人员 → 待评价数 */
      var badgeOf = Vue.computed(function () {
        if (!store.user) return { key: '', count: 0 };
        if (hasPerm('report:review')) return { key: 'todo', count: store.counts.review };
        if (hasPerm('report:submit')) return { key: 'todo', count: store.counts.evaluate };
        return { key: '', count: 0 };
      });

      function onLogout() {
        if (TDesign && TDesign.DialogPlugin && TDesign.DialogPlugin.confirm) {
          var dlg = TDesign.DialogPlugin.confirm({
            header: '退出登录',
            body: '确定要退出当前账号吗？',
            confirmBtn: { theme: 'primary', content: '退出' },
            cancelBtn: '取消',
            onConfirm: function () { LRUI.logout(); dlg.hide(); }
          });
        } else {
          LRUI.logout();
        }
      }

      /* 修改密码对话框 */
      var pwdVisible = Vue.ref(false);
      var pwdForm = Vue.reactive({ oldPassword: '', newPassword: '', confirm: '' });
      var pwdSaving = Vue.ref(false);
      async function savePassword() {
        if (!pwdForm.oldPassword || !pwdForm.newPassword) {
          LRUI.toast('warning', '请填写完整', '原密码与新密码均必填');
          return;
        }
        if (pwdForm.newPassword.length < 6) {
          LRUI.toast('warning', '密码过短', '新密码至少 6 位');
          return;
        }
        if (pwdForm.newPassword !== pwdForm.confirm) {
          LRUI.toast('warning', '两次输入不一致', '请重新确认新密码');
          return;
        }
        pwdSaving.value = true;
        try {
          await api.changePassword(pwdForm.oldPassword, pwdForm.newPassword);
          pwdVisible.value = false;
          pwdForm.oldPassword = ''; pwdForm.newPassword = ''; pwdForm.confirm = '';
          LRUI.toast('success', '密码已修改', '下次登录请使用新密码');
        } catch (e) { LRUI.handle(e, '修改密码失败'); }
        pwdSaving.value = false;
      }

      var todayText = Vue.computed(function () {
        var d = new Date();
        return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
      });

      Vue.onMounted(function () {
        global.addEventListener('hashchange', router.parse);
        global.addEventListener('resize', function () {
          if (global.LRChart) global.LRChart.resize();
        });
      });

      var routerKey = Vue.computed(function () {
        return router.route.name + (router.route.params.id ? ':' + router.route.params.id : '');
      });

      return {
        store: store, collapsed: collapsed, menus: menus, activeMenu: activeMenu,
        currentTitle: currentTitle, currentView: currentView, badgeOf: badgeOf,
        routerKey: routerKey, todayText: todayText,
        pwdVisible: pwdVisible, pwdForm: pwdForm, pwdSaving: pwdSaving, savePassword: savePassword,
        onLogout: onLogout,
        toggle: function () { store.collapsed = !store.collapsed; },
        goTodo: function () { router.go('dashboard'); }
      };
    },
    template: [
      '<div v-if="!store.booted" class="app-boot"><div class="app-boot__bar"><i></i></div><p>正在加载系统资源…</p></div>',
      '<login-view v-else-if="!store.user" />',
      '<div v-else class="app-shell">',
      '  <aside class="app-aside" :class="collapsed ? \'app-aside--collapsed\' : \'\'">',
      '    <div class="app-brand">',
      '      <div class="app-brand__mark"><t-icon name="creditcard" size="16" /></div>',
      '      <div class="app-brand__text" v-show="!collapsed">',
      '        <div class="app-brand__name">调查报告质量评价</div>',
      '        <div class="app-brand__sub">九江银行新余分行</div>',
      '      </div>',
      '    </div>',
      '    <div class="app-aside__menu">',
      '      <t-menu v-model="activeMenu" theme="light" :collapsed="collapsed">',
      '        <template v-for="m in menus" :key="m.key">',
      '          <t-menu-item v-if="!m.children" :value="m.key">',
      '            <template #icon><t-icon :name="m.icon" /></template>',
      '            {{ m.title }}',
      '            <t-badge v-if="badgeOf.key === m.key && badgeOf.count" :count="badgeOf.count" :offset="[0, 0]" style="margin-left:6px" />',
      '          </t-menu-item>',
      '          <t-submenu v-else :value="m.key" :title="m.title">',
      '            <template #icon><t-icon :name="m.icon" /></template>',
      '            <t-menu-item v-for="c in m.children" :key="c.key" :value="c.key">',
      '              <template #icon><t-icon :name="c.icon" /></template>',
      '              {{ c.title }}',
      '              <t-badge v-if="badgeOf.key === c.key && badgeOf.count" :count="badgeOf.count" style="margin-left:6px" />',
      '            </t-menu-item>',
      '          </t-submenu>',
      '        </template>',
      '      </t-menu>',
      '    </div>',
      '    <div class="app-aside__copyright" v-show="!collapsed">©2026 九江银行新余分行{{ store.version ? \' v\' + store.version : \'\' }}</div>',
      '  </aside>',
      '',
      '  <div class="app-main">',
      '    <t-layout>',
      '      <t-header class="app-header" :style="{ height: \'var(--td-comp-size-xxxl)\', minHeight: \'var(--td-comp-size-xxxl)\', flexShrink: 0 }">',
      '        <div class="app-header__left">',
      '          <t-button variant="text" shape="square" @click="toggle">',
      '            <t-icon :name="collapsed ? \'chevron-right\' : \'chevron-down\'" />',
      '          </t-button>',
      '          <t-breadcrumb>',
      '            <t-breadcrumb-item>九江银行新余分行</t-breadcrumb-item>',
      '            <t-breadcrumb-item>{{ currentTitle }}</t-breadcrumb-item>',
      '          </t-breadcrumb>',
      '        </div>',
      '        <div class="app-header__right">',
      '          <t-badge :count="badgeOf.count" :offset="[4, 2]">',
      '            <t-button variant="text" shape="square" @click="goTodo"><t-icon name="notification" /></t-button>',
      '          </t-badge>',
      '          <t-dropdown :options="[{ value: \'pwd\', content: \'修改密码\' }, { value: \'logout\', content: \'退出登录\' }]" @click="(item) => item.value === \'logout\' ? onLogout() : (pwdVisible = true)">',
      '            <div class="app-header__user">',
      '              <t-avatar size="small" style="background:var(--td-brand-color);color:var(--td-text-color-anti)">{{ store.user.name.slice(0, 1) }}</t-avatar>',
      '              <div>',
      '                <div class="app-header__user-name">{{ store.user.name }}</div>',
      '                <div class="app-header__user-role">{{ store.user.roles.map(r => r.name).join(\' / \') }}</div>',
      '              </div>',
      '              <t-icon name="chevron-down" size="14" />',
      '            </div>',
      '          </t-dropdown>',
      '        </div>',
      '      </t-header>',
      '      <t-content class="app-content">',
      '        <component :is="currentView" :key="routerKey" />',
      '      </t-content>',
      '    </t-layout>',
      '  </div>',
      '',
      '  <t-dialog v-model:visible="pwdVisible" header="修改登录密码" :confirm-btn="{ content: \'保存\', loading: pwdSaving, theme: \'primary\' }" @confirm="savePassword" :close-on-overlay-click="false">',
      '    <div class="form-field"><label class="form-field__label">原密码</label>',
      '      <t-input v-model="pwdForm.oldPassword" type="password" clearable /></div>',
      '    <div class="form-field"><label class="form-field__label">新密码（至少 6 位）</label>',
      '      <t-input v-model="pwdForm.newPassword" type="password" clearable /></div>',
      '    <div class="form-field"><label class="form-field__label">确认新密码</label>',
      '      <t-input v-model="pwdForm.confirm" type="password" clearable /></div>',
      '  </t-dialog>',
      '</div>'
    ].join('')
  };

  global.LRApp = App;

  /* ------------------------------------------------------------------ *
   * 启动：先恢复会话，再挂载
   * ------------------------------------------------------------------ */
  async function boot() {
    var app = Vue.createApp(App);

    if (TDesign) app.use(TDesign);
    else console.error('[boot] tdesign-vue-next 未加载');

    Object.keys(global.LRComponents).forEach(function (k) {
      app.component(global.LRComponents[k].name, global.LRComponents[k]);
    });

    var views = global.LRViews;
    app.component('login-view', views.login);
    Object.keys(views).forEach(function (k) {
      if (k !== 'login') app.component('view-' + k, views[k]);
    });

    if (Icons) {
      ICON_NAMES.forEach(function (n) {
        var comp = toPascal(n) + 'Icon';
        if (Icons[comp]) app.component(comp, Icons[comp]);
      });
    } else {
      console.error('[boot] tdesign-icons-vue-next 未加载');
    }

    var gp = app.config.globalProperties;
    Object.keys(D).forEach(function (k) { gp[k] = D[k]; });
    gp.LRStore = store;
    gp.LRRouter = router;
    gp.LRUI = LRUI;
    gp.LRAPI = api;

    router.parse();

    /* 版本号（页脚版权展示用，无鉴权） */
    api.health().then(function (h) { store.version = h.version || ''; }).catch(function () {});

    /* 会话恢复 */
    try {
      var data = await api.me();
      store.user = data.user;
      Object.assign(store.counts, data.counts || {});
      /* 深链到无权限页面时回落到工作台 */
      var allowed = [];
      store.user.menus.forEach(function (m) {
        if (m.children) m.children.forEach(function (c) { allowed.push(c.key); });
        else allowed.push(m.key);
      });
      if (allowed.indexOf(router.route.name) < 0) router.route.name = 'dashboard';
    } catch (e) {
      store.user = null;
    }
    store.booted = true;
    app.mount('#app');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
