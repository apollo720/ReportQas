/**
 * 视图层（四）：机构管理 / 员工（用户）管理 / 角色与权限 / 工作流管理
 * 全部走后端 CRUD；权限矩阵保存后立即对服务端校验和前端菜单生效。
 */
(function (global) {
  'use strict';

  var Vue = global.Vue;
  var D = global.LRDICT;
  var api = global.LRAPI;
  var V = global.LRViews;

  /* ================================================================== *
   * 机构管理
   * ================================================================== */
  V['sys-org'] = {
    name: 'ViewSysOrg',
    setup: function () {
      var filter = Vue.reactive({ keyword: '', status: '' });
      var rows = Vue.ref([]);
      var loading = Vue.ref(false);

      async function load() {
        loading.value = true;
        try { rows.value = (await api.orgs.list()).items; }
        catch (e) { global.LRUI.handle(e, '机构加载失败'); }
        loading.value = false;
      }
      Vue.onMounted(load);

      var filtered = Vue.computed(function () {
        var kw = filter.keyword.trim();
        return rows.value.filter(function (o) {
          if (filter.status && o.status !== filter.status) return false;
          if (kw && o.name.indexOf(kw) < 0 && o.code.indexOf(kw) < 0) return false;
          return true;
        });
      });

      var columns = [
        { colKey: 'name', title: '机构名称', width: 180 },
        { colKey: 'code', title: '机构代码', width: 110 },
        { colKey: 'parent', title: '上级机构', width: 220 },
        { colKey: 'employeeCount', title: '系统员工数', width: 110, align: 'right' },
        { colKey: 'status', title: '状态', width: 90, align: 'center' },
        { colKey: 'op', title: '操作', width: 100, align: 'center' }
      ];

      var dlgVisible = Vue.ref(false);
      var dlgMode = Vue.ref('create');
      var form = Vue.reactive({ id: '', code: '', name: '', parent: '九江银行股份有限公司', status: '启用' });
      var saving = Vue.ref(false);

      function openCreate() {
        dlgMode.value = 'create';
        Object.assign(form, { id: '', code: '', name: '', parent: '九江银行股份有限公司', status: '启用' });
        dlgVisible.value = true;
      }
      function openEdit(row) {
        dlgMode.value = 'edit';
        Object.assign(form, {
          id: row.id, code: row.code, name: row.name, parent: row.parent || '',
          status: row.status
        });
        dlgVisible.value = true;
      }
      async function save() {
        if (!form.code.trim() || !form.name.trim()) {
          global.LRUI.toast('warning', '请填写完整', '机构编码与名称必填');
          return;
        }
        saving.value = true;
        try {
          if (dlgMode.value === 'create') await api.orgs.create(form);
          else await api.orgs.update(form.id, form);
          global.LRUI.toast('success', '已保存', form.name);
          dlgVisible.value = false;
          await global.LRUI.loadMeta(true);
          load();
        } catch (e) { global.LRUI.handle(e, '保存失败'); }
        saving.value = false;
      }

      function deleteOrg(row) {
        var dlg = global.TDesign.DialogPlugin.confirm({
          header: '删除确认',
          body: '确定删除机构「' + row.name + '」吗？该操作不可恢复；若机构下仍有员工或已关联评价台账，将无法删除。',
          confirmBtn: { theme: 'danger', content: '删除' },
          cancelBtn: '取消',
          onConfirm: async function () {
            try {
              await api.orgs.remove(row.id);
              global.LRUI.toast('success', '已删除', row.name);
              load();
            } catch (e) { global.LRUI.handle(e, '删除失败'); }
            dlg.hide();
          }
        });
      }

      /* 批量导入 */
      var impVisible = Vue.ref(false);
      var impFile = Vue.ref(null);
      var importing = Vue.ref(false);
      var impResult = Vue.ref(null);
      function pickImpFile(e) { impFile.value = e.target.files && e.target.files[0]; }
      async function doImport() {
        if (!impFile.value) { global.LRUI.toast('warning', '请选择文件', '先选择要导入的 .xlsx / XML 机构文件'); return; }
        importing.value = true;
        impResult.value = null;
        try {
          impResult.value = await api.excel.importOrgs(impFile.value);
          load();
        } catch (e) { global.LRUI.handle(e, '导入失败'); }
        importing.value = false;
      }
      function downloadTemplate() { global.window.open(api.excel.orgTemplateUrl); }

      return {
        filter: filter, filtered: filtered, loading: loading, columns: columns,
        dlgVisible: dlgVisible, dlgMode: dlgMode, form: form, saving: saving,
        openCreate: openCreate, openEdit: openEdit, save: save, deleteOrg: deleteOrg,
        impVisible: impVisible, impFile: impFile, importing: importing, impResult: impResult,
        pickImpFile: pickImpFile, doImport: doImport, downloadTemplate: downloadTemplate,
        statusOptions: [{ value: '启用', label: '启用' }, { value: '停用', label: '停用' }]
      };
    },
    template: [
      '<div>',
      '  <page-header title="机构管理">',
      '    <t-button variant="outline" @click="impVisible = true"><template #icon><t-icon name="upload" /></template>批量导入</t-button>',
      '    <t-button theme="primary" @click="openCreate"><template #icon><t-icon name="add" /></template>新增机构</t-button>',
      '  </page-header>',
      '  <app-card>',
      '    <div class="row row--wrap gap-6" style="align-items:flex-end">',
      '      <div>',
      '        <div class="form-field__label">关键词</div>',
      '        <t-input v-model="filter.keyword" clearable placeholder="机构名称 / 机构代码" style="width:220px">',
      '          <template #prefix-icon><t-icon name="search" /></template>',
      '        </t-input>',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">状态</div>',
      '        <t-select v-model="filter.status" :options="statusOptions" clearable placeholder="全部" style="width:140px" />',
      '      </div>',
      '    </div>',
      '  </app-card>',
      '  <app-card flush>',
      '    <t-table :data="filtered" :columns="columns" row-key="id" size="small" hover bordered :loading="loading">',
      '      <template #name="{ row }"><span class="cell-strong">{{ row.name }}</span></template>',
      '      <template #status="{ row }">',
      '        <t-tag :theme="row.status === \'启用\' ? \'success\' : \'default\'" variant="light">{{ row.status }}</t-tag>',
      '      </template>',
      '      <template #op="{ row }"><t-space size="small">',
      '        <t-link theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>',
      '        <t-link theme="danger" hover="color" @click="deleteOrg(row)">删除</t-link>',
      '      </t-space></template>',
      '    </t-table>',
      '    <template #foot><span class="text-sm">共 {{ filtered.length }} 个机构</span></template>',
      '  </app-card>',
      '',
      '  <t-dialog v-model:visible="dlgVisible" :header="dlgMode === \'create\' ? \'新增机构\' : \'编辑机构\'"',
      '    :confirm-btn="{ content: \'保存\', loading: saving, theme: \'primary\' }" :close-on-overlay-click="false" @confirm="save">',
      '    <div class="form-grid">',
      '      <div class="form-field"><label class="form-field__label">机构编码（必填）</label><t-input v-model="form.code" /></div>',
      '      <div class="form-field"><label class="form-field__label">机构名称（必填）</label><t-input v-model="form.name" /></div>',
      '      <div class="form-field"><label class="form-field__label">上级机构</label><t-input v-model="form.parent" /></div>',
      '      <div class="form-field"><label class="form-field__label">状态</label><t-select v-model="form.status" :options="statusOptions" /></div>',
      '    </div>',
      '  </t-dialog>',
      '',
      '  <t-dialog v-model:visible="impVisible" header="批量导入机构（Excel）" :footer="false" :close-on-overlay-click="false">',
      '    <div class="notice notice--brand" style="margin-bottom:12px">',
      '      <t-icon name="info-circle-filled" class="notice__icon" />',
      '      <span class="text-sm">支持 .xlsx 或 Excel「另存为 → XML 表格 2003」格式；列名：机构编码 / 机构名称 / 上级机构 / 状态；编码不可与系统重复，重复的行跳过。</span>',
      '    </div>',
      '    <div class="form-field"><label class="form-field__label">选择 .xlsx / .xml 文件</label>',
      '      <input type="file" accept=".xlsx,.xml" @change="pickImpFile" /></div>',
      '    <div class="row gap-4" style="margin-top:12px">',
      '      <t-button theme="primary" :loading="importing" @click="doImport"><template #icon><t-icon name="upload" /></template>开始导入</t-button>',
      '      <t-button variant="outline" @click="downloadTemplate"><template #icon><t-icon name="download" /></template>下载导入模板</t-button>',
      '    </div>',
      '    <div v-if="impResult" style="margin-top:12px">',
      '      <t-tag theme="success" variant="light">成功导入 {{ impResult.imported }} 个机构</t-tag>',
      '      <t-tag v-if="impResult.skipped.length" theme="danger" variant="light" style="margin-left:8px">跳过 {{ impResult.skipped.length }} 行</t-tag>',
      '      <div v-for="(s, i) in impResult.skipped" :key="i" class="text-sm" style="margin-top:6px;color:var(--td-error-color)">',
      '        第 {{ s.row }} 行（{{ s.name }}）：{{ s.reason }}',
      '      </div>',
      '    </div>',
      '  </t-dialog>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 员工（用户）管理
   * ================================================================== */
  V['sys-employee'] = {
    name: 'ViewSysEmployee',
    setup: function () {
      var store = global.LRStore;
      var filter = Vue.reactive({ org: '', role: '', status: '', keyword: '' });
      var pagination = Vue.reactive({ current: 1, pageSize: 10, total: 0, showJumper: true, pageSizeOptions: [10, 20, 50] });
      var rows = Vue.ref([]);
      var roles = Vue.ref([]);
      var loading = Vue.ref(false);

      async function load() {
        loading.value = true;
        try {
          rows.value = (await api.employees.list()).items;
          roles.value = (await api.roles.list()).items;
        } catch (e) { global.LRUI.handle(e, '员工加载失败'); }
        loading.value = false;
      }
      Vue.onMounted(async function () { await global.LRUI.loadMeta(); load(); });

      var orgOptions = Vue.computed(function () {
        return ((store.meta && store.meta.orgs) || []).map(function (o) { return { value: o.id, label: o.name }; });
      });
      var roleOptions = Vue.computed(function () {
        return roles.value.map(function (r) { return { value: r.key, label: r.name }; });
      });

      var filtered = Vue.computed(function () {
        var kw = filter.keyword.trim();
        return rows.value.filter(function (e) {
          if (filter.org && e.org_id !== filter.org) return false;
          if (filter.role && (e.roleKeys || []).indexOf(filter.role) < 0) return false;
          if (filter.status && e.status !== filter.status) return false;
          if (kw && e.name.indexOf(kw) < 0 && e.no.indexOf(kw) < 0) return false;
          return true;
        });
      });
      Vue.watch(filtered, function (l) { pagination.total = l.length; }, { immediate: true });
      var pageData = Vue.computed(function () {
        var start = (pagination.current - 1) * pagination.pageSize;
        return filtered.value.slice(start, start + pagination.pageSize);
      });

      var columns = [
        { colKey: 'no', title: '工号', width: 100 },
        { colKey: 'name', title: '姓名', width: 100 },
        { colKey: 'org', title: '所属机构', width: 130 },
        { colKey: 'post', title: '岗位', width: 170 },
        { colKey: 'roles', title: '角色', width: 170 },
        { colKey: 'canLogin', title: '登录权限', width: 90, align: 'center' },
        { colKey: 'status', title: '状态', width: 90, align: 'center' },
        { colKey: 'op', title: '操作', width: 160, align: 'center' }
      ];

      var dlgVisible = Vue.ref(false);
      var dlgMode = Vue.ref('create');
      var form = Vue.reactive({ id: '', no: '', name: '', orgId: '', post: '', roleKeys: [], canLogin: true, status: '在职' });
      var saving = Vue.ref(false);

      function openCreate() {
        dlgMode.value = 'create';
        Object.assign(form, { id: '', no: '', name: '', orgId: '', post: '', roleKeys: [], canLogin: true, status: '在职' });
        dlgVisible.value = true;
      }
      function openEdit(row) {
        dlgMode.value = 'edit';
        Object.assign(form, {
          id: row.id, no: row.no, name: row.name, orgId: row.org_id || '', post: row.post || '',
          roleKeys: (row.roleKeys || []).slice(), canLogin: !!row.can_login, status: row.status
        });
        dlgVisible.value = true;
      }
      async function save() {
        if (!form.no.trim() || !form.name.trim()) {
          global.LRUI.toast('warning', '请填写完整', '工号与姓名必填');
          return;
        }
        if (!form.roleKeys.length) {
          global.LRUI.toast('warning', '请分配角色', '至少分配一个角色');
          return;
        }
        saving.value = true;
        try {
          if (dlgMode.value === 'create') {
            await api.employees.create(form);
            global.LRUI.toast('success', '已新增员工', form.name + '（初始密码 123456，请告知其登录后修改）');
          } else {
            await api.employees.update(form.id, form);
            global.LRUI.toast('success', '已保存', form.name);
          }
          dlgVisible.value = false;
          await global.LRUI.loadMeta(true);
          load();
        } catch (e) { global.LRUI.handle(e, '保存失败'); }
        saving.value = false;
      }

      function resetPwd(row) {
        var dlg = global.TDesign.DialogPlugin.confirm({
          header: '重置密码',
          body: '确定将 ' + row.name + '（' + row.no + '）的登录密码重置为 123456 吗？',
          confirmBtn: { theme: 'primary', content: '重置' },
          cancelBtn: '取消',
          onConfirm: async function () {
            try {
              await api.employees.resetPassword(row.id, '123456');
              global.LRUI.toast('success', '密码已重置', row.name + ' 的新密码为 123456');
            } catch (e) { global.LRUI.handle(e, '重置失败'); }
            dlg.hide();
          }
        });
      }

      function deleteEmp(row) {
        var dlg = global.TDesign.DialogPlugin.confirm({
          header: '删除确认',
          body: '确定删除员工 ' + row.name + '（' + row.no + '）吗？该操作不可恢复；若该员工已关联评价台账，将无法删除。',
          confirmBtn: { theme: 'danger', content: '删除' },
          cancelBtn: '取消',
          onConfirm: async function () {
            try {
              await api.employees.remove(row.id);
              global.LRUI.toast('success', '已删除', row.name);
              load();
            } catch (e) { global.LRUI.handle(e, '删除失败'); }
            dlg.hide();
          }
        });
      }

      /* 批量导入 */
      var impVisible = Vue.ref(false);
      var impFile = Vue.ref(null);
      var importing = Vue.ref(false);
      var impResult = Vue.ref(null);
      function pickImpFile(e) { impFile.value = e.target.files && e.target.files[0]; }
      async function doImport() {
        if (!impFile.value) { global.LRUI.toast('warning', '请选择文件', '先选择要导入的 .xlsx / XML 员工文件'); return; }
        importing.value = true;
        impResult.value = null;
        try {
          impResult.value = await api.excel.importEmployees(impFile.value);
          load();
        } catch (e) { global.LRUI.handle(e, '导入失败'); }
        importing.value = false;
      }
      function downloadTemplate() { global.window.open(api.excel.employeeTemplateUrl); }

      return {
        filter: filter, orgOptions: orgOptions, roleOptions: roleOptions,
        pagination: pagination, filtered: filtered, pageData: pageData, columns: columns, loading: loading,
        dlgVisible: dlgVisible, dlgMode: dlgMode, form: form, saving: saving,
        openCreate: openCreate, openEdit: openEdit, save: save, resetPwd: resetPwd, deleteEmp: deleteEmp,
        impVisible: impVisible, impFile: impFile, importing: importing, impResult: impResult,
        pickImpFile: pickImpFile, doImport: doImport, downloadTemplate: downloadTemplate,
        reset: function () { filter.org = ''; filter.role = ''; filter.status = ''; filter.keyword = ''; }
      };
    },
    template: [
      '<div>',
      '  <page-header title="员工（用户）管理">',
      '    <t-button variant="outline" @click="impVisible = true"><template #icon><t-icon name="upload" /></template>批量导入</t-button>',
      '    <t-button theme="primary" @click="openCreate"><template #icon><t-icon name="add" /></template>新增员工</t-button>',
      '  </page-header>',
      '  <app-card>',
      '    <div class="row row--wrap gap-6" style="align-items:flex-end">',
      '      <div>',
      '        <div class="form-field__label">所属机构</div>',
      '        <t-select v-model="filter.org" :options="orgOptions" clearable placeholder="全部机构" style="width:170px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">角色</div>',
      '        <t-select v-model="filter.role" :options="roleOptions" clearable placeholder="全部角色" style="width:150px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">状态</div>',
      '        <t-select v-model="filter.status" :options="[\'在职\',\'离职\'].map(s => ({ value: s, label: s }))" clearable placeholder="全部" style="width:120px" />',
      '      </div>',
      '      <div>',
      '        <div class="form-field__label">关键词</div>',
      '        <t-input v-model="filter.keyword" clearable placeholder="姓名 / 工号" style="width:200px">',
      '          <template #prefix-icon><t-icon name="search" /></template>',
      '        </t-input>',
      '      </div>',
      '      <t-button variant="outline" @click="reset"><template #icon><t-icon name="refresh" /></template>重置</t-button>',
      '    </div>',
      '  </app-card>',
      '  <app-card flush>',
      '    <t-table :data="pageData" :columns="columns" row-key="id" size="small" hover bordered :loading="loading"',
      '      :pagination="pagination" @page-change="(p) => { pagination.current = p.current; pagination.pageSize = p.pageSize; }">',
      '      <template #name="{ row }"><span class="cell-strong">{{ row.name }}</span></template>',
      '      <template #org="{ row }">{{ row.orgName || row.org_id }}</template>',
      '      <template #roles="{ row }">',
      '        <span v-for="r in (row.roleNames || \'\').split(\'、\')" :key="r" class="role-chip">{{ r }}</span>',
      '      </template>',
      '      <template #canLogin="{ row }">',
      '        <t-tag :theme="row.can_login ? \'success\' : \'default\'" variant="light">{{ row.can_login ? \'已开通\' : \'未开通\' }}</t-tag>',
      '      </template>',
      '      <template #status="{ row }">',
      '        <t-tag :theme="row.status === \'在职\' ? \'success\' : \'default\'" variant="light">{{ row.status }}</t-tag>',
      '      </template>',
      '      <template #op="{ row }">',
      '        <t-space size="small">',
      '          <template v-if="row.no === \'admin\'"><t-tag theme="warning" variant="light">内置</t-tag></template>',
      '          <template v-else>',
      '            <t-link theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>',
      '            <t-link theme="primary" hover="color" @click="resetPwd(row)">重置密码</t-link>',
      '            <t-link theme="danger" hover="color" @click="deleteEmp(row)">删除</t-link>',
      '          </template>',
      '        </t-space>',
      '      </template>',
      '    </t-table>',
      '    <template #foot><span class="text-sm">共 {{ filtered.length }} 名员工</span></template>',
      '  </app-card>',
      '',
      '  <t-dialog v-model:visible="dlgVisible" :header="dlgMode === \'create\' ? \'新增员工\' : \'编辑员工\'" width="560px"',
      '    :confirm-btn="{ content: \'保存\', loading: saving, theme: \'primary\' }" :close-on-overlay-click="false" @confirm="save">',
      '    <div class="form-grid">',
      '      <div class="form-field"><label class="form-field__label">工号（必填）</label>',
      '        <t-input v-model="form.no" :disabled="dlgMode === \'edit\'" /></div>',
      '      <div class="form-field"><label class="form-field__label">姓名（必填）</label><t-input v-model="form.name" /></div>',
      '      <div class="form-field"><label class="form-field__label">所属机构</label><t-select v-model="form.orgId" :options="orgOptions" clearable /></div>',
      '      <div class="form-field"><label class="form-field__label">岗位</label><t-input v-model="form.post" /></div>',
      '      <div class="form-field"><label class="form-field__label">角色（多选）</label>',
      '        <t-select v-model="form.roleKeys" :options="roleOptions" multiple :min-collapsed-num="3" clearable /></div>',
      '      <div class="form-field"><label class="form-field__label">登录权限</label>',
      '        <t-switch v-model="form.canLogin" :label="[\'开通\', \'停用\']" /></div>',
      '      <div class="form-field"><label class="form-field__label">在职状态</label>',
      '        <t-select v-model="form.status" :options="[\'在职\',\'离职\'].map(s => ({ value: s, label: s }))" /></div>',
      '    </div>',
      '    <div v-if="dlgMode === \'create\'" class="notice notice--brand" style="margin-top:8px">',
      '      <t-icon name="tips" class="notice__icon" />',
      '      <span class="text-sm">新员工初始密码为 123456，请通知其登录后修改。</span>',
      '    </div>',
      '  </t-dialog>',
      '',
      '  <t-dialog v-model:visible="impVisible" header="批量导入员工（Excel）" :footer="false" :close-on-overlay-click="false">',
      '    <div class="notice notice--brand" style="margin-bottom:12px">',
      '      <t-icon name="info-circle-filled" class="notice__icon" />',
      '      <span class="text-sm">支持 .xlsx 或 Excel「另存为 → XML 表格 2003」格式；列名：工号 / 姓名 / 所属机构 / 岗位 / 角色 / 登录权限；机构按名称匹配系统主数据，工号重复的行跳过；初始密码统一为 123456。</span>',
      '    </div>',
      '    <div class="form-field"><label class="form-field__label">选择 .xlsx / .xml 文件</label>',
      '      <input type="file" accept=".xlsx,.xml" @change="pickImpFile" /></div>',
      '    <div class="row gap-4" style="margin-top:12px">',
      '      <t-button theme="primary" :loading="importing" @click="doImport"><template #icon><t-icon name="upload" /></template>开始导入</t-button>',
      '      <t-button variant="outline" @click="downloadTemplate"><template #icon><t-icon name="download" /></template>下载导入模板</t-button>',
      '    </div>',
      '    <div v-if="impResult" style="margin-top:12px">',
      '      <t-tag theme="success" variant="light">成功导入 {{ impResult.imported }} 名员工</t-tag>',
      '      <t-tag v-if="impResult.skipped.length" theme="danger" variant="light" style="margin-left:8px">跳过 {{ impResult.skipped.length }} 行</t-tag>',
      '      <div v-for="(s, i) in impResult.skipped" :key="i" class="text-sm" style="margin-top:6px;color:var(--td-error-color)">',
      '        第 {{ s.row }} 行（{{ s.name }}）：{{ s.reason }}',
      '      </div>',
      '    </div>',
      '  </t-dialog>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 角色与权限
   * ================================================================== */
  V['sys-role'] = {
    name: 'ViewSysRole',
    setup: function () {
      var roles = Vue.ref([]);
      var permGroups = Vue.ref([]);
      var activeRole = Vue.ref('');
      var saving = Vue.ref(false);

      var currentRole = Vue.computed(function () {
        return roles.value.filter(function (r) { return r.key === activeRole.value; })[0] || null;
      });
      var isAdminRole = Vue.computed(function () { return !!currentRole.value && currentRole.value.key === 'admin'; });
      var checked = Vue.computed(function () {
        return currentRole.value ? currentRole.value.perms : [];
      });

      function togglePerm(key, val) {
        if (!currentRole.value || isAdminRole.value) return;
        var set = new Set(currentRole.value.perms);
        if (val) {
          set.add(key);
          /* 台账查看（全部 / 仅本人经办）、统计查看（全部 / 仅本人相关）互斥 */
          if (key === 'report:read') set.delete('report:read:self');
          if (key === 'report:read:self') set.delete('report:read');
          if (key === 'stats:read') set.delete('stats:read:self');
          if (key === 'stats:read:self') set.delete('stats:read');
        } else {
          set.delete(key);
        }
        currentRole.value.perms = [...set];
      }

      async function load() {
        try {
          roles.value = (await api.roles.list()).items;
          if (!activeRole.value && roles.value.length) activeRole.value = roles.value[0].key;
          permGroups.value = (await api.meta()).permCatalog;
        } catch (e) { global.LRUI.handle(e, '角色加载失败'); }
      }
      Vue.onMounted(load);

      async function save() {
        if (!currentRole.value) return;
        saving.value = true;
        try {
          await api.roles.updatePerms(currentRole.value.key, currentRole.value.perms);
          global.LRUI.toast('success', '权限已保存', '角色「' + currentRole.value.name + '」的权限已生效（相关用户重新登录或刷新后菜单更新）');
        } catch (e) { global.LRUI.handle(e, '保存失败'); }
        saving.value = false;
      }

      var totalPerms = Vue.computed(function () {
        return permGroups.value.reduce(function (s, g) { return s + g.items.length; }, 0);
      });

      return {
        roles: roles, permGroups: permGroups, activeRole: activeRole,
        currentRole: currentRole, isAdminRole: isAdminRole, checked: checked, togglePerm: togglePerm,
        saving: saving, save: save, totalPerms: totalPerms
      };
    },
    template: [
      '<div>',
      '  <page-header title="角色与权限">',
      '    <t-button v-if="!isAdminRole" theme="primary" :loading="saving" @click="save"><template #icon><t-icon name="secured" /></template>保存当前角色权限</t-button>',
      '    <t-tag v-else theme="warning" variant="light">超级管理员固定拥有全部权限，不可修改</t-tag>',
      '  </page-header>',
      '',
      '  <div class="kpi-grid">',
      '    <div v-for="r in roles" :key="r.key" class="kpi" style="cursor:pointer;flex-direction:column;align-items:stretch"',
      '      :style="activeRole === r.key ? \'border-color:var(--td-brand-color);box-shadow:0 0 0 2px rgba(0,82,217,.12)\' : \'\'"',
      '      @click="activeRole = r.key">',
      '      <div class="row row--between">',
      '        <div class="row gap-4">',
      '          <div class="kpi__icon" :class="activeRole === r.key ? \'kpi__icon--brand\' : \'\'" :style="activeRole !== r.key ? \'background:var(--td-bg-color-secondarycontainer);color:var(--td-text-color-secondary)\' : \'\'">',
      '            <t-icon :name="r.key === \'admin\' ? \'setting\' : (r.key === \'chief\' ? \'secured\' : (r.key === \'reviewer\' ? \'file-paste\' : \'user\'))" />',
      '          </div>',
      '          <div>',
      '            <div style="font-size:15px;font-weight:600">{{ r.name }}</div>',
      '            <div class="text-sm text-placeholder">{{ r.userCount }} 名用户 · {{ r.perms.length }} 项权限</div>',
      '          </div>',
      '        </div>',
      '        <t-icon v-if="activeRole === r.key" name="check-circle-filled" size="20" style="color:var(--td-brand-color)" />',
      '      </div>',
      '      <p class="text-sm text-secondary" style="margin:12px 0 0;line-height:20px">{{ r.descr }}</p>',
      '    </div>',
      '  </div>',
      '',
      '  <app-card :title="\'权限矩阵 · \' + (currentRole ? currentRole.name : \'\')" :desc="isAdminRole ? \'超级管理员固定拥有全部权限，不可修改\' : \'勾选即授权；菜单权限控制左侧导航可见性，动作权限由服务端接口校验\'" flush>',
      '    <div style="overflow-x:auto;padding:8px 16px">',
      '      <table class="perm-matrix">',
      '        <thead>',
      '          <tr><th style="width:240px">功能权限</th><th style="width:140px;text-align:center">授权</th></tr>',
      '        </thead>',
      '        <tbody>',
      '          <template v-for="g in permGroups" :key="g.group">',
      '            <tr><th colspan="2" style="background:var(--td-bg-color-page);font-weight:600">{{ g.group }}</th></tr>',
      '            <tr v-for="p in g.items" :key="p.key">',
      '              <td>{{ p.label }}<span class="text-sm text-placeholder" style="margin-left:8px">{{ p.key }}</span></td>',
      '              <td style="text-align:center">',
      '                <t-checkbox :checked="checked.indexOf(p.key) >= 0" :disabled="isAdminRole" @change="(v) => togglePerm(p.key, v)" />',
      '              </td>',
      '            </tr>',
      '          </template>',
      '        </tbody>',
      '      </table>',
      '    </div>',
      '    <template #foot><span class="text-sm">共 {{ totalPerms }} 项功能权限 · {{ roles.length }} 个角色 · 当前已授权 {{ checked.length }} 项</span></template>',
      '  </app-card>',
      '</div>'
    ].join('')
  };

  /* ================================================================== *
   * 工作流管理
   * ================================================================== */
  V['sys-workflow'] = {
    name: 'ViewSysWorkflow',
    setup: function () {
      var data = Vue.ref(null);
      var loading = Vue.ref(false);

      async function load() {
        loading.value = true;
        try { data.value = await api.workflow(); }
        catch (e) { global.LRUI.handle(e, '工作流加载失败'); }
        loading.value = false;
      }
      Vue.onMounted(load);

      var columns = [
        { colKey: 'id', title: '报告编号', width: 130 },
        { colKey: 'customerName', title: '客户名称', width: 230, ellipsis: true },
        { colKey: 'node', title: '当前节点', width: 180 },
        { colKey: 'reviewerName', title: '审批人', width: 100 },
        { colKey: 'report_date', title: '上报日期', width: 110 },
        { colKey: 'dwellDays', title: '节点停留（天）', width: 120, align: 'right' },
        { colKey: 'status', title: '状态', width: 120 }
      ];

      var running = Vue.computed(function () {
        if (!data.value) return [];
        var d = data.value;
        var list = [];
        d.instances.pending.forEach(function (r) {
          list.push(Object.assign({}, r, { node: '② 负责人审查评价', dwellDays: r.dwellDays }));
        });
        d.instances.returned.forEach(function (r) {
          list.push(Object.assign({}, r, { node: '① 评价录入（已退回）', dwellDays: '—' }));
        });
        return list.sort(function (a, b) { return (b.dwellDays || 0) - (a.dwellDays || 0); });
      });

      var overdue = Vue.computed(function () {
        return running.value.filter(function (r) { return r.dwellDays !== '—' && r.dwellDays >= 3; }).length;
      });

      return {
        data: data, loading: loading, columns: columns, running: running, overdue: overdue,
        reload: load
      };
    },
    template: [
      '<div v-if="data">',
      '  <page-header :title="\'工作流管理 · \' + data.definition.name" />',
      '',
      '  <app-card title="流程节点" desc="固定两步审批流；提交后评价内容锁定，需退回才能修改">',
      '    <div class="flow-steps">',
      '      <template v-for="(n, i) in data.definition.nodes" :key="n.key">',
      '        <div v-if="i > 0" class="flow-step__line flow-step__line--done"></div>',
      '        <div class="flow-step">',
      '          <div class="flow-step__dot flow-step__dot--done"><t-icon v-if="i < 2" name="check" size="16" /><span v-else>{{ i + 1 }}</span></div>',
      '          <div>',
      '            <div class="flow-step__name">{{ i + 1 }}. {{ n.name }}</div>',
      '            <div class="flow-step__meta">{{ n.handler }} · {{ n.desc }}</div>',
      '            <div class="flow-step__meta" style="color:var(--td-brand-color)">{{ n.autoAction }}</div>',
      '          </div>',
      '        </div>',
      '      </template>',
      '    </div>',
      '  </app-card>',
      '',
      '  <div class="kpi-grid">',
      '    <app-kpi icon="edit" theme="brand" label="节点① 评价录入" :value="data.stats.draft + data.stats.returned" unit="笔" :extra="\'含已退回 \' + data.stats.returned + \' 笔\'" />',
      '    <app-kpi icon="secured" theme="warning" label="节点② 待负责人审查" :value="data.stats.pending_review" unit="笔" extra="审查对象：审批人员的审查工作" />',
      '    <app-kpi icon="check-circle-filled" theme="success" label="节点③ 已归档" :value="data.stats.archived" unit="笔" extra="已进入统计台账" />',
      '    <app-kpi icon="time-filled" theme="danger" label="节点② 超时未处理" :value="overdue" unit="笔" extra="停留 ≥ 3 天" />',
      '  </div>',
      '',
      '  <app-card title="在途流程实例" desc="按节点停留时长降序；超过 3 天的实例建议优先处理" flush>',
      '    <t-table :data="running" :columns="columns" row-key="id" size="small" hover bordered>',
      '      <template #customerName="{ row }"><span class="cell-strong">{{ row.customerName }}</span></template>',
      '      <template #dwellDays="{ row }">',
      '        <span :style="row.dwellDays !== \'—\' && row.dwellDays >= 3 ? \'color:var(--td-error-color);font-weight:600\' : \'\'" class="text-number">{{ row.dwellDays }}</span>',
      '      </template>',
      '      <template #status="{ row }">',
      '        <t-tag :theme="STATUS_MAP[row.status].theme" variant="light">{{ STATUS_MAP[row.status].label }}</t-tag>',
      '      </template>',
      '    </t-table>',
      '    <template #foot><span class="text-sm">共 {{ running.length }} 笔在途</span></template>',
      '  </app-card>',
      '</div>',
      '<div v-else><app-card><div style="text-align:center;padding:40px" class="text-secondary">加载中…</div></app-card></div>'
    ].join('')
  };
})(window);
