const api = require("../../utils/api");

const PERMISSION_OPTIONS = [
  { key: "read", label: "访问", description: "查看有权访问的文件夹与影像" },
  { key: "upload", label: "上传", description: "上传照片和视频" },
  { key: "edit", label: "编辑", description: "重命名和批量移动影像" },
  { key: "delete", label: "删除", description: "移入回收站、恢复和永久删除" },
  { key: "manageFolders", label: "文件夹", description: "创建、重命名、排序和设置可见范围" },
  { key: "assignTitles", label: "赋予称号", description: "修改其他成员的称号" },
];

function allPermissions() {
  return {
    read: true,
    upload: true,
    edit: true,
    delete: true,
    manageFolders: true,
    assignTitles: true,
  };
}

function effectivePermissions(user) {
  const current = user || {};
  if (current.accountLabel === "alishan-tea") return allPermissions();
  const defaults = current.role === "admin"
    ? { ...allPermissions(), assignTitles: false }
    : current.role === "uploader"
      ? { read: true, upload: true, edit: false, delete: false, manageFolders: false, assignTitles: false }
      : { read: true, upload: false, edit: false, delete: false, manageFolders: false, assignTitles: false };
  return { ...defaults, ...(current.permissions || {}) };
}

function decorateUser(user) {
  const current = user || {};
  const permissions = effectivePermissions(current);
  return {
    ...current,
    title: String(current.title || (current.accountLabel === "alishan-tea" ? "伞兵指挥官" : "")),
    permissions,
    permissionItems: PERMISSION_OPTIONS.map((permission) => ({
      ...permission,
      enabled: Boolean(permissions[permission.key]),
    })),
    statusLabel: current.status === "active" ? "已启用" : "已停用",
    superAdmin: current.accountLabel === "alishan-tea",
  };
}

Page({
  data: {
    authorized: false,
    user: {},
    users: [],
    loading: true,
    error: "",
    savingUserId: "",
  },

  onLoad() {
    if (!api.getSessionToken()) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    const cachedUser = decorateUser(api.currentUser());
    if (!cachedUser.superAdmin) {
      this.leavePermissionsPage();
      return;
    }
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
  },

  refresh() {
    this.setData({ loading: true, error: "" });
    api.request("/api/auth/session")
      .then(({ user }) => {
        const current = decorateUser(user);
        if (!current.superAdmin) throw Object.assign(new Error("只有超级管理员可以管理用户权限"), { statusCode: 403 });
        api.saveSession(api.getSessionToken(), current);
        this.setData({ user: current, authorized: true });
        return api.request("/api/admin/users");
      })
      .then(({ users }) => this.setData({ users: (users || []).map(decorateUser), loading: false }))
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        if (error.statusCode === 403) {
          this.setData({ authorized: false });
          wx.showToast({ title: "仅超级管理员可访问", icon: "none" });
          this.leavePermissionsPage();
          return;
        }
        this.setData({ loading: false, error: error.message || "读取用户权限失败" });
      })
      .finally(() => wx.stopPullDownRefresh());
  },

  leavePermissionsPage() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: "/pages/library/library" });
  },

  openAlbum() {
    this.leavePermissionsPage();
  },

  updateTitle(event) {
    const userId = event.currentTarget.dataset.id;
    const title = event.detail.value;
    this.setData({ users: this.data.users.map((user) => user.id === userId ? { ...user, title } : user) });
  },

  saveTitle(event) {
    const target = this.data.users.find((user) => user.id === event.currentTarget.dataset.id);
    if (target) this.updateUser(target, { title: String(target.title || "").trim() });
  },

  togglePermission(event) {
    const target = this.data.users.find((user) => user.id === event.currentTarget.dataset.id);
    const key = event.currentTarget.dataset.key;
    if (!target || target.superAdmin || !Object.prototype.hasOwnProperty.call(target.permissions, key)) return;
    this.updateUser(target, { permissions: { ...target.permissions, [key]: Boolean(event.detail.value) } });
  },

  toggleStatus(event) {
    const target = this.data.users.find((user) => user.id === event.currentTarget.dataset.id);
    if (!target || target.superAdmin) return;
    this.updateUser(target, { status: target.status === "active" ? "disabled" : "active" });
  },

  updateUser(target, changes) {
    if (!target || this.data.savingUserId) return;
    this.setData({ savingUserId: target.id });
    api.request("/api/admin/users", {
      method: "PATCH",
      data: { userId: target.id, ...changes },
    })
      .then(({ user }) => {
        const updated = decorateUser(user);
        this.setData({ users: this.data.users.map((item) => item.id === updated.id ? updated : item) });
        wx.showToast({ title: "权限已更新", icon: "success" });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        if (error.statusCode === 403) {
          wx.showToast({ title: "没有权限执行此操作", icon: "none" });
          this.leavePermissionsPage();
          return;
        }
        wx.showToast({ title: error.message || "更新权限失败", icon: "none" });
      })
      .finally(() => this.setData({ savingUserId: "" }));
  },
});
