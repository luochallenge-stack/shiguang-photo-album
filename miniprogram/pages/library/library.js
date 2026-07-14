const api = require("../../utils/api");

const PAGE_SIZE = 24;
const COMPRESS_THRESHOLD = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 50;
const PICKER_BATCH_SIZE = 9;
const MAX_BATCH_ACTION_COUNT = 100;
const DOCUMENT_FOLDER_SLUG = "documents";
const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx"];
const PERMISSION_OPTIONS = [
  { key: "read", label: "访问" },
  { key: "upload", label: "上传" },
  { key: "edit", label: "编辑" },
  { key: "delete", label: "删除" },
  { key: "manageFolders", label: "文件夹" },
  { key: "assignTitles", label: "赋予称号" },
];
let libraryRequestId = 0;
let pendingUploadFiles = [];
const generatingCoverIds = new Set();

function formatSize(value) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value) {
  const date = new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function mediaUrl(value) {
  return value ? encodeURI(value) : "";
}

function operationLabel(photo) {
  const labels = {
    upload: "上传",
    rename: "重命名",
    move: "移动",
    recycle: "移入回收站",
    restore: "恢复",
  };
  if (!photo.lastActionBy) return "历史影像";
  return `${photo.lastActionBy} ${labels[photo.lastAction] || "操作"}`;
}

function visibilityLabel(type) {
  if (type === "admins") return "管理者";
  if (type === "specific") return "指定用户";
  return "所有人";
}

function effectivePermissions(user) {
  const current = user || {};
  if (current.accountLabel === "alishan-tea") {
    return { read: true, upload: true, edit: true, delete: true, manageFolders: true, assignTitles: true };
  }
  const roleDefaults = current.role === "admin"
    ? { read: true, upload: true, edit: true, delete: true, manageFolders: true, assignTitles: false }
    : current.role === "uploader"
      ? { read: true, upload: true, edit: false, delete: false, manageFolders: false, assignTitles: false }
      : { read: true, upload: false, edit: false, delete: false, manageFolders: false, assignTitles: false };
  return { ...roleDefaults, ...(current.permissions || {}) };
}

function permissionLabel(permissions) {
  if (permissions.manageFolders) return "文件夹管理者";
  if (permissions.upload) return "可上传用户";
  if (permissions.read) return "访问用户";
  return "暂无访问权限";
}

function decorateUser(user) {
  const current = user || {};
  const permissions = effectivePermissions(current);
  const superAdmin = current.accountLabel === "alishan-tea";
  const defaultTitle = current.accountLabel === "alishan-tea" ? "伞兵指挥官" : "";
  return {
    ...current,
    title: String(current.title || defaultTitle),
    permissions,
    permissionLabel: permissionLabel(permissions),
    canUpload: permissions.upload,
    canEdit: permissions.edit,
    canDelete: permissions.delete,
    canManageFolders: permissions.manageFolders,
    canAssignTitles: permissions.assignTitles,
    canManagePermissions: superAdmin,
    canOpenPeople: superAdmin || permissions.assignTitles,
  };
}

function decorateManagedUser(user) {
  const decorated = decorateUser(user);
  return {
    ...decorated,
    permissionItems: PERMISSION_OPTIONS.map((permission) => ({
      ...permission,
      enabled: Boolean(decorated.permissions[permission.key]),
    })),
    statusLabel: decorated.status === "active" ? "已启用" : "已停用",
  };
}

function isVideoFile(file) {
  if (file && file.fileType === "video") return true;
  return /\.(mp4|mov|m4v|webm|mpeg|mpg)(?:\?|$)/i.test(String(file && file.tempFilePath || ""));
}

function isDocumentName(name) {
  return /\.(pdf|doc|docx)$/i.test(String(name || ""));
}

function isDocumentMime(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  return value === "application/pdf"
    || value === "application/msword"
    || value === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function uploadName(file, index) {
  const path = file && file.tempFilePath;
  const extensionMatch = String(path || "").match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
  const video = isVideoFile(file);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : video ? "mp4" : "jpg";
  const date = new Date();
  const pad = (part) => String(part).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${video ? "视频" : "照片"}-${stamp}-${index + 1}.${extension}`;
}

function compressIfNeeded(file) {
  if (!file || !file.tempFilePath || isVideoFile(file) || file.size <= COMPRESS_THRESHOLD) {
    return Promise.resolve(file.tempFilePath);
  }
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: file.tempFilePath,
      quality: 86,
      success: ({ tempFilePath }) => resolve(tempFilePath),
      fail: (error) => reject(new Error(error.errMsg || "压缩图片失败")),
    });
  });
}

function uploadSizeError(file) {
  const size = Number(file && file.size) || 0;
  if (!size) return "";
  if (isDocumentName(file.name || file.tempFilePath)) return size > MAX_DOCUMENT_BYTES ? "文档不能超过 500 MB" : "";
  if (isVideoFile(file) && size > MAX_VIDEO_BYTES) return "视频不能超过 500 MB";
  if (!isVideoFile(file) && size > MAX_IMAGE_BYTES) return "图片不能超过 50 MB";
  return "";
}

function selectionCounts(files) {
  const videoCount = files.filter(isVideoFile).length;
  return {
    selectedCount: files.length,
    selectedImageCount: files.length - videoCount,
    selectedVideoCount: videoCount,
  };
}

Page({
  data: {
    user: {},
    folders: [],
    photos: [],
    skeletons: [1, 2, 3, 4, 5, 6],
    total: 0,
    selectedFolder: "",
    selectedFolderName: "全部影像",
    loading: true,
    loadingMore: false,
    hasMore: false,
    nextOffset: 0,
    error: "",
    uploading: false,
    uploadProgress: 0,
    uploadLabel: "",
    selectionOpen: false,
    selectingMedia: false,
    selectedCount: 0,
    selectedImageCount: 0,
    selectedVideoCount: 0,
    createFolderOpen: false,
    newFolderName: "",
    newFolderVisibility: "admins",
    newFolderVisibleUserIds: [],
    creatingFolder: false,
    folderMenuOpen: false,
    reorderingFolders: false,
    renameOpen: false,
    renameKind: "",
    renameValue: "",
    renameTarget: null,
    renameMaxLength: 80,
    renaming: false,
    folderVisibilityOpen: false,
    folderVisibility: "admins",
    folderVisibleUserIds: [],
    visibilityUsers: [],
    managedFolder: null,
    folderVisibilitySaving: false,
    editMode: false,
    batchSelectedCount: 0,
    allLoadedSelected: false,
    batchMoveOpen: false,
    moveFolders: [],
    moveFolderNames: [],
    moveFolderIndex: 0,
    batchSaving: false,
    recycleMode: false,
    recycleCount: 0,
    userManagementOpen: false,
    managedUsers: [],
    managedUsersLoading: false,
    userSavingId: "",
  },

  onLoad(options) {
    if (!api.getSessionToken()) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    this.setData({ user: decorateUser(api.currentUser()) });
    api.request("/api/auth/session")
      .then(({ user }) => {
        const current = decorateUser(user);
        api.saveSession(api.getSessionToken(), current);
        this.setData({ user: current });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
        }
      })
      .finally(() => this.loadLibrary(options.folder || ""));
  },

  onPullDownRefresh() {
    this.loadLibrary(this.data.selectedFolder, true, false, this.data.recycleMode);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.loadLibrary(this.data.selectedFolder, false, true, this.data.recycleMode);
    }
  },

  onUnload() {
    pendingUploadFiles = [];
  },

  loadLibrary(folderSlug = "", refreshing = false, append = false, recycleMode = false) {
    if (append && (!this.data.hasMore || this.data.loadingMore)) return;
    const offset = append ? this.data.nextOffset : 0;
    const requestId = ++libraryRequestId;
    this.setData({
      loading: append ? false : !refreshing,
      loadingMore: append,
      error: "",
    });
    const query = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (recycleMode) query.push("recycle=1");
    else if (folderSlug) query.push(`folder=${encodeURIComponent(folderSlug)}`);
    api.request(`/api/library?${query.join("&")}`)
      .then((payload) => {
        if (requestId !== libraryRequestId) return;
        const folders = payload.folders.map((folder) => ({
          ...folder,
          visibilityLabel: visibilityLabel(folder.visibilityType),
        }));
        const selected = folders.find((folder) => folder.slug === folderSlug);
        const photos = payload.photos.map((photo) => {
          const video = String(photo.mimeType || "").startsWith("video/");
          const document = isDocumentMime(photo.mimeType);
          return {
            ...photo,
            url: mediaUrl(photo.url),
            previewUrl: mediaUrl(photo.previewUrl || photo.url),
            thumbnailUrl: mediaUrl(photo.thumbnailUrl || (video || document ? "" : photo.previewUrl || photo.url)),
            video,
            document,
            documentType: String(photo.mimeType || "").includes("pdf") ? "PDF" : "Word",
            sizeLabel: formatSize(photo.size || 0),
            dateLabel: formatDate(photo.createdAt),
            operatorLabel: operationLabel(photo),
            operatorDateLabel: photo.lastActionAt ? formatDate(photo.lastActionAt) : "",
            purgeDateLabel: photo.purgeAt ? formatDate(photo.purgeAt) : "",
            selected: false,
          };
        });
        const nextPhotos = append ? this.data.photos.concat(photos) : photos;
        this.setData({
          folders,
          photos: nextPhotos,
          total: Number(payload.total) || 0,
          selectedFolder: folderSlug,
          selectedFolderName: recycleMode ? "回收站" : selected ? selected.name : "全部影像",
          loading: false,
          loadingMore: false,
          hasMore: Boolean(payload.hasMore),
          nextOffset: Number(payload.nextOffset) || 0,
          editMode: append ? this.data.editMode : false,
          batchSelectedCount: append ? this.data.batchSelectedCount : 0,
          allLoadedSelected: false,
          batchMoveOpen: false,
          recycleMode,
          recycleCount: Number(payload.recycleCount) || 0,
        }, () => {
          if (this.data.user.canUpload && !recycleMode) {
            this.generateMissingVideoCovers(nextPhotos);
          }
        });
      })
      .catch((error) => {
        if (requestId !== libraryRequestId) return;
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        this.setData({ loading: false, loadingMore: false, error: error.message || "读取相册失败" });
      })
      .finally(() => wx.stopPullDownRefresh());
  },

  async generateMissingVideoCovers(photos) {
    const missing = photos
      .filter((photo) => photo.video && !photo.thumbnailUrl && !generatingCoverIds.has(photo.id));
    missing.forEach((photo) => generatingCoverIds.add(photo.id));
    for (const photo of missing) {
      try {
        const result = await api.generateVideoCover(photo.id);
        const thumbnailUrl = mediaUrl(result.coverUrl);
        if (thumbnailUrl) {
          this.setData({
            photos: this.data.photos.map((item) => item.id === photo.id ? { ...item, thumbnailUrl } : item),
          });
        }
      } catch (error) {
        console.error("生成历史视频封面失败", photo.id, error);
      } finally {
        generatingCoverIds.delete(photo.id);
      }
    }
  },

  chooseFolder(event) {
    const slug = event.currentTarget.dataset.slug || "";
    this.setData({ folderMenuOpen: false });
    this.exitEditMode();
    if (!slug) {
      this.loadLibrary("", false, false, false);
      return;
    }
    this.loadLibrary(slug, false, false, false);
  },

  chooseRecycleBin() {
    if (!this.data.user.canDelete) return;
    this.setData({ folderMenuOpen: false });
    this.exitEditMode();
    this.loadLibrary("", false, false, true);
  },

  toggleFolderMenu() {
    this.setData({ folderMenuOpen: !this.data.folderMenuOpen });
  },

  closeFolderMenu() {
    this.setData({ folderMenuOpen: false });
  },

  openUserManagement() {
    if (!this.data.user.canOpenPeople) return;
    if (this.data.user.canManagePermissions) {
      this.openPermissionsPage();
      return;
    }
    this.setData({ folderMenuOpen: false, userManagementOpen: true, managedUsersLoading: true });
    api.request("/api/admin/users")
      .then(({ users }) => this.setData({ managedUsers: (users || []).map(decorateManagedUser) }))
      .catch((error) => wx.showToast({ title: error.message || "读取人员失败", icon: "none" }))
      .finally(() => this.setData({ managedUsersLoading: false }));
  },

  openPermissionsPage() {
    if (!this.data.user.canManagePermissions) return;
    this.setData({ folderMenuOpen: false });
    wx.navigateTo({ url: "/pages/permissions/permissions" });
  },

  closeUserManagement() {
    if (this.data.userSavingId) return;
    this.setData({ userManagementOpen: false });
  },

  updateManagedTitle(event) {
    const userId = event.currentTarget.dataset.id;
    const title = event.detail.value;
    this.setData({
      managedUsers: this.data.managedUsers.map((user) => user.id === userId ? { ...user, title } : user),
    });
  },

  saveManagedTitle(event) {
    const target = this.data.managedUsers.find((user) => user.id === event.currentTarget.dataset.id);
    if (target) this.updateManagedUser(target, { title: String(target.title || "").trim() });
  },

  toggleManagedPermission(event) {
    if (!this.data.user.canManagePermissions) return;
    const target = this.data.managedUsers.find((user) => user.id === event.currentTarget.dataset.id);
    const key = event.currentTarget.dataset.key;
    if (!target || !target.permissions || target.accountLabel === "alishan-tea" || !Object.prototype.hasOwnProperty.call(target.permissions, key)) return;
    this.updateManagedUser(target, { permissions: { ...target.permissions, [key]: Boolean(event.detail.value) } });
  },

  toggleManagedStatus(event) {
    const target = this.data.managedUsers.find((user) => user.id === event.currentTarget.dataset.id);
    if (!this.data.user.canManagePermissions || !target || target.accountLabel === "alishan-tea") return;
    this.updateManagedUser(target, { status: target.status === "active" ? "disabled" : "active" });
  },

  updateManagedUser(target, changes) {
    if (!target || this.data.userSavingId) return;
    this.setData({ userSavingId: target.id });
    api.request("/api/admin/users", { method: "PATCH", data: { userId: target.id, ...changes } })
      .then(({ user }) => {
        const updated = decorateManagedUser(user);
        this.setData({
          managedUsers: this.data.managedUsers.map((item) => item.id === updated.id ? updated : item),
        });
        if (updated.id === this.data.user.id) {
          const current = decorateUser({ ...updated, permissions: updated.permissions || this.data.user.permissions });
          api.saveSession(api.getSessionToken(), current);
          this.setData({ user: current });
        }
        wx.showToast({ title: "人员信息已更新", icon: "success" });
      })
      .catch((error) => wx.showToast({ title: error.message || "更新人员失败", icon: "none" }))
      .finally(() => this.setData({ userSavingId: "" }));
  },

  async moveFolderOrder(event) {
    if (!this.data.user.canManageFolders || this.data.reorderingFolders) return;
    const index = Number(event.currentTarget.dataset.index);
    const direction = Number(event.currentTarget.dataset.direction);
    const targetIndex = index + direction;
    if (!Number.isInteger(index) || ![-1, 1].includes(direction) || targetIndex < 0 || targetIndex >= this.data.folders.length) return;

    const previousFolders = this.data.folders.slice();
    const folders = previousFolders.slice();
    [folders[index], folders[targetIndex]] = [folders[targetIndex], folders[index]];
    this.setData({ folders, reorderingFolders: true });
    try {
      await api.request("/api/folders/order", {
        method: "PATCH",
        data: { folderSlugs: folders.map((folder) => folder.slug) },
      });
    } catch (error) {
      this.setData({ folders: previousFolders });
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "保存目录顺序失败", icon: "none" });
    } finally {
      this.setData({ reorderingFolders: false });
    }
  },

  openCreateFolder() {
    if (!this.data.user.canManageFolders || this.data.creatingFolder) return;
    this.exitEditMode();
    const userId = this.data.user.id || "";
    this.setData({
      folderMenuOpen: false,
      createFolderOpen: true,
      newFolderName: "",
      newFolderVisibility: "admins",
      newFolderVisibleUserIds: userId ? [userId] : [],
    });
    this.loadVisibilityUsers();
  },

  closeCreateFolder() {
    if (this.data.creatingFolder) return;
    this.setData({ createFolderOpen: false, newFolderName: "" });
  },

  updateNewFolderName(event) {
    this.setData({ newFolderName: event.detail.value });
  },

  async createFolder() {
    const name = String(this.data.newFolderName || "").trim();
    if (!name || this.data.creatingFolder) return;
    this.setData({ creatingFolder: true });
    try {
      const result = await api.request("/api/folders", {
        method: "POST",
        data: {
          name,
          visibilityType: this.data.newFolderVisibility,
          visibleUserIds: this.data.newFolderVisibleUserIds,
        },
      });
      if (!result.folder || !result.folder.slug) throw new Error("服务器没有返回新文件夹");
      this.setData({ createFolderOpen: false, newFolderName: "", creatingFolder: false });
      wx.showToast({ title: "文件夹已创建", icon: "success" });
      this.loadLibrary(result.folder.slug, true, false, false);
    } catch (error) {
      this.setData({ creatingFolder: false });
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "创建文件夹失败", icon: "none" });
    }
  },

  openFolderActions(event) {
    const slug = event.currentTarget.dataset.slug;
    const folder = this.data.folders.find((item) => item.slug === slug);
    if (!folder) return;
    const actions = [];
    const handlers = [];
    if (this.data.user.canManageFolders) {
      actions.push("重命名");
      handlers.push(() => this.openRename("folder", folder));
    }
    if (folder.canManageVisibility) {
      actions.push("修改可见范围");
      handlers.push(() => this.openFolderVisibility(folder));
    }
    if (this.data.user.canManageFolders) {
      actions.push("删除文件夹");
      handlers.push(() => this.confirmDeleteFolder(folder));
    }
    if (!actions.length) return;
    wx.showActionSheet({
      itemList: actions,
      success: ({ tapIndex }) => {
        if (handlers[tapIndex]) handlers[tapIndex]();
      },
    });
  },

  confirmDeleteFolder(folder) {
    if (!folder || !this.data.user.canManageFolders) return;
    const photoCount = Number(folder.photoCount) || 0;
    wx.showModal({
      title: "删除文件夹",
      content: photoCount > 0
        ? `“${folder.name}”中还有 ${photoCount} 项正常影像，继续后需要再次确认。`
        : `确定删除文件夹“${folder.name}”吗？回收站中的影像仍保留 7 天，恢复影像时会一并恢复文件夹。`,
      confirmText: photoCount > 0 ? "继续" : "删除",
      confirmColor: "#b33a34",
      success: ({ confirm }) => {
        if (!confirm) return;
        if (photoCount > 0) {
          wx.showModal({
            title: "再次确认删除",
            content: `确认将 ${photoCount} 项影像全部移入回收站并删除“${folder.name}”吗？影像保留 7 天。`,
            confirmText: "确认删除",
            confirmColor: "#b33a34",
            success: ({ confirm: confirmedAgain }) => {
              if (confirmedAgain) this.deleteFolder(folder, true);
            },
          });
          return;
        }
        this.deleteFolder(folder, false);
      },
    });
  },

  async deleteFolder(folder, confirmed) {
    wx.showLoading({ title: "正在删除", mask: true });
    try {
      const suffix = confirmed ? "&confirm=1" : "";
      await api.request(`/api/folders?folder=${encodeURIComponent(folder.slug)}${suffix}`, { method: "DELETE" });
      const nextFolder = this.data.selectedFolder === folder.slug ? "" : this.data.selectedFolder;
      this.setData({ folderMenuOpen: false });
      wx.showToast({ title: "文件夹已删除", icon: "success" });
      this.loadLibrary(nextFolder, true, false, false);
    } catch (error) {
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "删除文件夹失败", icon: "none", duration: 3000 });
    } finally {
      wx.hideLoading();
    }
  },

  openRename(kind, target) {
    if (!target || (kind === "folder" ? !this.data.user.canManageFolders : !this.data.user.canEdit)) return;
    this.setData({
      folderMenuOpen: false,
      renameOpen: true,
      renameKind: kind,
      renameValue: target.name || "",
      renameTarget: target,
      renameMaxLength: kind === "folder" ? 80 : 180,
    });
  },

  updateRenameValue(event) {
    this.setData({ renameValue: event.detail.value });
  },

  closeRename() {
    if (this.data.renaming) return;
    this.setData({ renameOpen: false, renameKind: "", renameValue: "", renameTarget: null });
  },

  async saveRename() {
    const target = this.data.renameTarget;
    const name = String(this.data.renameValue || "").trim();
    if (!target || !name || this.data.renaming) return;
    this.setData({ renaming: true });
    try {
      if (this.data.renameKind === "folder") {
        await api.request("/api/folders/name", {
          method: "PATCH",
          data: { folderSlug: target.slug, name },
        });
        this.setData({
          folders: this.data.folders.map((folder) => folder.slug === target.slug ? { ...folder, name } : folder),
          selectedFolderName: this.data.selectedFolder === target.slug ? name : this.data.selectedFolderName,
        });
        wx.showToast({ title: "文件夹已重命名", icon: "success" });
      } else {
        await api.request("/api/photos", {
          method: "PATCH",
          data: { id: target.id, name },
        });
        wx.showToast({ title: "文件已重命名", icon: "success" });
      }
      const mediaRenamed = this.data.renameKind === "media";
      this.setData({ renaming: false, renameOpen: false, renameKind: "", renameValue: "", renameTarget: null });
      if (mediaRenamed) this.loadLibrary(this.data.selectedFolder, true, false, this.data.recycleMode);
    } catch (error) {
      this.setData({ renaming: false });
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "重命名失败", icon: "none" });
    }
  },

  syncVisibilityUsers() {
    const newIds = this.data.newFolderVisibleUserIds || [];
    const folderIds = this.data.folderVisibleUserIds || [];
    this.setData({
      visibilityUsers: this.data.visibilityUsers.map((user) => ({
        ...user,
        newSelected: newIds.includes(user.id),
        folderSelected: folderIds.includes(user.id),
      })),
    });
  },

  loadVisibilityUsers(folderSlug = "") {
    if (this.data.visibilityUsers.length) {
      this.syncVisibilityUsers();
      return Promise.resolve(this.data.visibilityUsers);
    }
    const query = folderSlug ? `?folder=${encodeURIComponent(folderSlug)}` : "";
    return api.request(`/api/users/options${query}`)
      .then(({ users }) => {
        this.setData({ visibilityUsers: (users || []).map(decorateManagedUser) }, () => this.syncVisibilityUsers());
        return users || [];
      })
      .catch((error) => {
        wx.showToast({ title: error.message || "读取用户列表失败", icon: "none" });
        return [];
      });
  },

  setNewFolderVisibility(event) {
    const visibilityType = event.currentTarget.dataset.type;
    const userId = this.data.user.id || "";
    const ids = visibilityType === "specific" && userId && !this.data.newFolderVisibleUserIds.includes(userId)
      ? this.data.newFolderVisibleUserIds.concat(userId)
      : this.data.newFolderVisibleUserIds;
    this.setData({ newFolderVisibility: visibilityType, newFolderVisibleUserIds: ids }, () => this.syncVisibilityUsers());
  },

  updateNewVisibleUsers(event) {
    const userId = this.data.user.id || "";
    const ids = event.detail.value || [];
    if (userId && !ids.includes(userId)) ids.push(userId);
    this.setData({ newFolderVisibleUserIds: ids }, () => this.syncVisibilityUsers());
  },

  openFolderVisibility(folder) {
    if (!folder || !folder.canManageVisibility) return;
    this.setData({
      folderMenuOpen: false,
      folderVisibilityOpen: true,
      folderVisibility: folder.visibilityType || "all",
      folderVisibleUserIds: folder.visibleUserIds || [],
      managedFolder: folder,
    }, () => {
      this.syncVisibilityUsers();
      this.loadVisibilityUsers(folder.slug);
    });
  },

  closeFolderVisibility() {
    if (this.data.folderVisibilitySaving) return;
    this.setData({ folderVisibilityOpen: false, managedFolder: null });
  },

  setFolderVisibility(event) {
    const visibilityType = event.currentTarget.dataset.type;
    const creatorUserId = this.data.managedFolder && this.data.managedFolder.creatorUserId || "";
    const ids = visibilityType === "specific" && creatorUserId && !this.data.folderVisibleUserIds.includes(creatorUserId)
      ? this.data.folderVisibleUserIds.concat(creatorUserId)
      : this.data.folderVisibleUserIds;
    this.setData({ folderVisibility: visibilityType, folderVisibleUserIds: ids }, () => this.syncVisibilityUsers());
  },

  updateFolderVisibleUsers(event) {
    const creatorUserId = this.data.managedFolder && this.data.managedFolder.creatorUserId || "";
    const ids = event.detail.value || [];
    if (creatorUserId && !ids.includes(creatorUserId)) ids.push(creatorUserId);
    this.setData({ folderVisibleUserIds: ids }, () => this.syncVisibilityUsers());
  },

  async saveFolderVisibility() {
    const folder = this.data.managedFolder;
    if (!folder || !folder.canManageVisibility || this.data.folderVisibilitySaving) return;
    this.setData({ folderVisibilitySaving: true });
    try {
      await api.request("/api/folders", {
        method: "PATCH",
        data: {
          folderSlug: folder.slug,
          visibilityType: this.data.folderVisibility,
          visibleUserIds: this.data.folderVisibleUserIds,
        },
      });
      this.setData({ folderVisibilitySaving: false, folderVisibilityOpen: false, managedFolder: null });
      wx.showToast({ title: "可见范围已更新", icon: "success" });
      this.loadLibrary(this.data.selectedFolder, true, false, this.data.recycleMode);
    } catch (error) {
      this.setData({ folderVisibilitySaving: false });
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "设置可见范围失败", icon: "none" });
    }
  },

  noop() {},

  thumbnailError(event) {
    const id = event.currentTarget.dataset.id;
    const photos = this.data.photos.map((photo) => photo.id === id
      ? { ...photo, thumbnailUrl: photo.video ? "" : photo.previewUrl || photo.url }
      : photo);
    this.setData({ photos });
  },

  openMedia(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.editMode) {
      this.toggleMediaSelection(id);
      return;
    }
    const item = this.data.photos.find((photo) => photo.id === id);
    if (!item) return;
    if (item.document) {
      this.openDocument(item);
      return;
    }
    if (item.video) {
      wx.setStorageSync("albumCurrentMedia", item);
      wx.navigateTo({ url: "/pages/viewer/viewer" });
      return;
    }
    const imagePhotos = this.data.photos.filter((photo) => !photo.video && !photo.document);
    const index = imagePhotos.findIndex((photo) => photo.id === item.id);
    wx.setStorageSync("albumViewerPhotos", imagePhotos);
    wx.setStorageSync("albumViewerIndex", Math.max(0, index));
    wx.navigateTo({ url: "/pages/viewer/viewer?mode=image" });
  },

  openDocument(item) {
    wx.showLoading({ title: "正在打开" });
    api.request(`/api/photos/url?id=${encodeURIComponent(item.id)}`)
      .then((result) => {
        const url = mediaUrl(result.url || item.url);
        if (!url) throw new Error("服务器没有返回文档链接");
        return new Promise((resolve, reject) => {
          wx.downloadFile({
            url,
            timeout: 120000,
            success: (response) => {
              if (response.statusCode >= 200 && response.statusCode < 300 && response.tempFilePath) {
                wx.openDocument({ filePath: response.tempFilePath, showMenu: true, success: resolve, fail: reject });
                return;
              }
              reject(new Error(`下载文档失败 (${response.statusCode})`));
            },
            fail: (error) => reject(new Error(error.errMsg || "下载文档失败")),
          });
        });
      })
      .catch((error) => wx.showToast({ title: error.message || "打开文档失败", icon: "none" }))
      .finally(() => wx.hideLoading());
  },

  openMediaActions(event) {
    if (this.data.editMode) return;
    const id = event.currentTarget.dataset.id;
    const item = this.data.photos.find((photo) => photo.id === id);
    if (!item) return;
    const actions = [];
    const handlers = [];
    if (!item.video && !item.document) {
      actions.push("复制24小时查看链接");
      handlers.push(() => this.createMediaShareLink(item));
    }
    if (this.data.user.canEdit) {
      actions.push("重命名");
      handlers.push(() => this.openRename("media", item));
    }
    if (!actions.length) return;
    wx.showActionSheet({
      itemList: actions,
      success: ({ tapIndex }) => {
        if (handlers[tapIndex]) handlers[tapIndex]();
      },
    });
  },

  async createMediaShareLink(item) {
    if (!item || item.video) return;
    wx.showLoading({ title: "正在生成链接", mask: true });
    try {
      const result = await api.request("/api/photos/share", {
        method: "POST",
        data: { photoId: item.id },
      });
      if (!result.url) throw new Error("服务器没有返回分享链接");
      await new Promise((resolve, reject) => {
        wx.setClipboardData({ data: result.url, success: resolve, fail: reject });
      });
      wx.showModal({
        title: "链接已复制",
        content: "粘贴到个人或群聊即可打开。链接 24 小时内有效，对方无需登录，可查看并下载原图。",
        showCancel: false,
        confirmText: "知道了",
      });
    } catch (error) {
      wx.showToast({ title: error.message || "生成分享链接失败", icon: "none", duration: 3000 });
    } finally {
      wx.hideLoading();
    }
  },

  toggleEditMode() {
    if ((!this.data.user.canEdit && !this.data.user.canDelete) || this.data.uploading || this.data.batchSaving) return;
    if (this.data.editMode) {
      this.exitEditMode();
      return;
    }
    this.setData({ editMode: true, batchSelectedCount: 0, allLoadedSelected: false });
  },

  exitEditMode() {
    if (this.data.batchSaving) return;
    this.setData({
      editMode: false,
      photos: this.data.photos.map((photo) => ({ ...photo, selected: false })),
      batchSelectedCount: 0,
      allLoadedSelected: false,
      batchMoveOpen: false,
      moveFolders: [],
      moveFolderNames: [],
      moveFolderIndex: 0,
    });
  },

  toggleMediaSelection(id) {
    const current = this.data.photos.find((photo) => photo.id === id);
    if (!current) return;
    if (!current.selected && this.data.batchSelectedCount >= MAX_BATCH_ACTION_COUNT) {
      wx.showToast({ title: "单次最多选择 100 项", icon: "none" });
      return;
    }
    const photos = this.data.photos.map((photo) => photo.id === id
      ? { ...photo, selected: !photo.selected }
      : photo);
    const batchSelectedCount = photos.filter((photo) => photo.selected).length;
    this.setData({
      photos,
      batchSelectedCount,
      allLoadedSelected: photos.length > 0
        && photos.slice(0, MAX_BATCH_ACTION_COUNT).every((photo) => photo.selected),
    });
  },

  toggleAllLoaded() {
    const shouldSelect = !this.data.allLoadedSelected;
    let selectedCount = 0;
    const photos = this.data.photos.map((photo) => {
      const selected = shouldSelect && selectedCount < MAX_BATCH_ACTION_COUNT;
      if (selected) selectedCount += 1;
      return { ...photo, selected };
    });
    if (shouldSelect && this.data.photos.length > MAX_BATCH_ACTION_COUNT) {
      wx.showToast({ title: "已选择前 100 项", icon: "none" });
    }
    this.setData({
      photos,
      batchSelectedCount: selectedCount,
      allLoadedSelected: shouldSelect && selectedCount === Math.min(photos.length, MAX_BATCH_ACTION_COUNT),
    });
  },

  selectedBatchIds() {
    return this.data.photos.filter((photo) => photo.selected).map((photo) => photo.id);
  },

  openBatchMove() {
    if (!this.data.user.canEdit || this.data.recycleMode || !this.data.batchSelectedCount || this.data.batchSaving) return;
    const moveFolders = this.data.selectedFolder
      ? this.data.folders.filter((folder) => folder.slug !== this.data.selectedFolder)
      : this.data.folders;
    if (!moveFolders.length) {
      wx.showToast({ title: "没有可移动到的其他文件夹", icon: "none" });
      return;
    }
    this.setData({
      batchMoveOpen: true,
      moveFolders,
      moveFolderNames: moveFolders.map((folder) => `${folder.name}（${folder.visibilityLabel}可见）`),
      moveFolderIndex: 0,
    });
  },

  updateMoveFolder(event) {
    this.setData({ moveFolderIndex: Number(event.detail.value) || 0 });
  },

  closeBatchMove() {
    if (this.data.batchSaving) return;
    this.setData({ batchMoveOpen: false });
  },

  async moveSelectedMedia() {
    const ids = this.selectedBatchIds();
    const target = this.data.moveFolders[this.data.moveFolderIndex];
    if (!ids.length || !target || this.data.batchSaving) return;
    this.setData({ batchSaving: true });
    try {
      const result = await api.request("/api/photos/batch", {
        method: "PATCH",
        data: { ids, targetFolderSlug: target.slug },
      });
      wx.showToast({ title: result.movedCount ? `已移动 ${result.movedCount} 项` : "影像已在目标文件夹", icon: "none" });
      this.setData({ batchSaving: false, batchMoveOpen: false });
      this.loadLibrary(this.data.selectedFolder, true, false, this.data.recycleMode);
    } catch (error) {
      this.setData({ batchSaving: false });
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "批量移动失败", icon: "none" });
    }
  },

  confirmBatchDelete() {
    if (!this.data.user.canDelete || !this.data.batchSelectedCount || this.data.batchSaving) return;
    wx.showModal({
      title: "移入回收站",
      content: `确定将已选择的 ${this.data.batchSelectedCount} 项影像移入回收站吗？影像会保留 7 天。`,
      confirmText: "移入",
      confirmColor: "#b85246",
      success: ({ confirm }) => {
        if (confirm) this.deleteSelectedMedia();
      },
    });
  },

  async deleteSelectedMedia() {
    const ids = this.selectedBatchIds();
    if (!ids.length || this.data.batchSaving) return;
    this.setData({ batchSaving: true });
    try {
      const result = await api.request("/api/photos/batch", { method: "DELETE", data: { ids } });
      wx.showToast({ title: `已移入回收站 ${result.recycledCount || ids.length} 项`, icon: "success" });
      this.setData({ batchSaving: false });
      this.loadLibrary(this.data.selectedFolder, true, false, false);
    } catch (error) {
      this.setData({ batchSaving: false });
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "移入回收站失败", icon: "none" });
    }
  },

  async restoreSelectedMedia() {
    if (!this.data.user.canDelete) return;
    const ids = this.selectedBatchIds();
    if (!ids.length || this.data.batchSaving) return;
    this.setData({ batchSaving: true });
    try {
      const result = await api.request("/api/photos/recycle", { method: "PATCH", data: { ids } });
      wx.showToast({ title: `已恢复 ${result.restoredCount || ids.length} 项`, icon: "success" });
      this.setData({ batchSaving: false });
      this.loadLibrary("", true, false, true);
    } catch (error) {
      this.setData({ batchSaving: false });
      wx.showToast({ title: error.message || "批量恢复失败", icon: "none" });
    }
  },

  confirmPermanentDelete() {
    if (!this.data.user.canDelete || !this.data.batchSelectedCount || this.data.batchSaving) return;
    wx.showModal({
      title: "永久删除影像",
      content: `确定永久删除已选择的 ${this.data.batchSelectedCount} 项影像吗？云存储原文件也会被删除，无法恢复。`,
      confirmText: "永久删除",
      confirmColor: "#b85246",
      success: ({ confirm }) => {
        if (confirm) this.purgeSelectedMedia();
      },
    });
  },

  async purgeSelectedMedia() {
    const ids = this.selectedBatchIds();
    if (!ids.length || this.data.batchSaving) return;
    this.setData({ batchSaving: true });
    try {
      const result = await api.request("/api/photos/recycle", { method: "DELETE", data: { ids } });
      wx.showToast({ title: `已永久删除 ${result.purgedCount || ids.length} 项`, icon: "success" });
      this.setData({ batchSaving: false });
      this.loadLibrary("", true, false, true);
    } catch (error) {
      this.setData({ batchSaving: false });
      wx.showToast({ title: error.message || "永久删除失败", icon: "none" });
    }
  },

  chooseMedia() {
    if (!this.data.user.canUpload) return;
    if (!this.data.selectedFolder) {
      wx.showToast({ title: "请先选择目标文件夹", icon: "none" });
      return;
    }
    if (this.data.uploading) return;
    pendingUploadFiles = [];
    this.setData({
      selectionOpen: true,
      selectedCount: 0,
      selectedImageCount: 0,
      selectedVideoCount: 0,
    }, () => this.addMoreMedia());
  },

  chooseDocument() {
    if (!this.data.user.canUpload || this.data.uploading) return;
    const actions = ["从微信聊天文件选择"];
    const handlers = [() => this.chooseMessageDocument()];
    if (typeof wx.chooseFile === "function") {
      actions.unshift("从本机文件选择");
      handlers.unshift(() => this.chooseLocalDocument());
    }
    if (actions.length === 1) {
      wx.showToast({ title: "当前微信仅支持从聊天文件选择", icon: "none", duration: 2200 });
      handlers[0]();
      return;
    }
    wx.showActionSheet({
      itemList: actions,
      success: ({ tapIndex }) => {
        if (handlers[tapIndex]) handlers[tapIndex]();
      },
    });
  },

  chooseLocalDocument() {
    if (typeof wx.chooseFile !== "function") {
      wx.showToast({ title: "当前微信暂不支持本机文件选择", icon: "none", duration: 2600 });
      this.chooseMessageDocument();
      return;
    }
    wx.chooseFile({
      count: 20,
      type: "file",
      extension: DOCUMENT_EXTENSIONS,
      success: ({ tempFiles }) => this.handlePickedDocuments(tempFiles),
      fail: (error) => {
        if (!String(error && error.errMsg || "").includes("cancel")) {
          wx.showToast({ title: "选择文档失败", icon: "none" });
        }
      },
    });
  },

  chooseMessageDocument() {
    wx.chooseMessageFile({
      count: 20,
      type: "file",
      extension: DOCUMENT_EXTENSIONS,
      success: ({ tempFiles }) => this.handlePickedDocuments(tempFiles),
      fail: (error) => {
        if (!String(error && error.errMsg || "").includes("cancel")) {
          wx.showToast({ title: "选择文档失败", icon: "none" });
        }
      },
    });
  },

  handlePickedDocuments(tempFiles) {
    const files = (tempFiles || []).filter((file) => isDocumentName(file.name || file.path || file.tempFilePath));
    if (!files.length) {
      wx.showToast({ title: "请选择 PDF 或 Word 文档", icon: "none" });
      return;
    }
    this.uploadDocuments(files);
  },

  async uploadDocuments(files) {
    if (!files.length || this.data.uploading) return;
    this.setData({ uploading: true, uploadProgress: 0, uploadLabel: `准备上传文档 1/${files.length}` });
    let completed = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const sizeError = uploadSizeError(file);
        if (sizeError) throw new Error(sizeError);
        const filePath = file.path || file.tempFilePath;
        if (!filePath) throw new Error("文档路径无效");
        this.setData({ uploadLabel: `正在上传文档 ${index + 1}/${files.length}` });
        await api.uploadMedia(filePath, {
          folderSlug: DOCUMENT_FOLDER_SLUG,
          name: file.name || `文档-${index + 1}.pdf`,
          width: "",
          height: "",
        }, ({ progress }) => {
          const overall = Math.round(((index * 100) + progress) / files.length);
          this.setData({ uploadProgress: overall });
        });
        completed += 1;
      }
      wx.showToast({ title: `已上传 ${completed} 个文档`, icon: "success" });
      this.loadLibrary(DOCUMENT_FOLDER_SLUG, true);
    } catch (error) {
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "上传文档失败", icon: "none", duration: 3000 });
      if (completed) this.loadLibrary(DOCUMENT_FOLDER_SLUG, true);
    } finally {
      this.setData({ uploading: false, uploadProgress: 0, uploadLabel: "" });
    }
  },

  addMoreMedia() {
    if (this.data.uploading || this.data.selectingMedia) return;
    const remaining = MAX_UPLOAD_COUNT - pendingUploadFiles.length;
    if (remaining <= 0) {
      wx.showToast({ title: "本次已选满 50 项", icon: "none" });
      return;
    }
    this.setData({ selectingMedia: true });
    wx.chooseMedia({
      count: Math.min(PICKER_BATCH_SIZE, remaining),
      mediaType: ["image", "video"],
      sourceType: ["album", "camera"],
      success: ({ tempFiles }) => {
        const selected = (tempFiles || []).slice(0, remaining);
        const accepted = selected.filter((file) => !uploadSizeError(file));
        const rejected = selected.length - accepted.length;
        pendingUploadFiles = pendingUploadFiles.concat(accepted);
        this.setData(selectionCounts(pendingUploadFiles));
        if (rejected) wx.showToast({ title: `已跳过 ${rejected} 个超限文件`, icon: "none" });
      },
      complete: () => this.setData({ selectingMedia: false }),
    });
  },

  cancelMediaSelection() {
    if (this.data.selectingMedia) return;
    pendingUploadFiles = [];
    this.setData({
      selectionOpen: false,
      selectedCount: 0,
      selectedImageCount: 0,
      selectedVideoCount: 0,
    });
  },

  uploadSelectedMedia() {
    if (!pendingUploadFiles.length || this.data.selectingMedia) return;
    const files = pendingUploadFiles.slice(0, MAX_UPLOAD_COUNT);
    pendingUploadFiles = [];
    this.setData({
      selectionOpen: false,
      selectedCount: 0,
      selectedImageCount: 0,
      selectedVideoCount: 0,
    }, () => this.uploadMedia(files));
  },

  async uploadMedia(files) {
    if (!files.length || this.data.uploading) return;
    this.setData({ uploading: true, uploadProgress: 0, uploadLabel: `准备上传 1/${files.length}` });
    let completed = 0;
    let duplicateSkipped = 0;
    let coverFailures = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.setData({ uploadLabel: `正在上传${isVideoFile(file) ? "视频" : "照片"} ${index + 1}/${files.length}` });
        const filePath = await compressIfNeeded(file);
        const result = await api.uploadMedia(filePath, {
          folderSlug: this.data.selectedFolder,
          name: uploadName(file, index),
          width: String(file.width || ""),
          height: String(file.height || ""),
        }, ({ progress }) => {
          const overall = Math.round(((index * 100) + progress) / files.length);
          this.setData({ uploadProgress: overall });
        });
        if (result.duplicate) {
          duplicateSkipped += 1;
          completed += 1;
          continue;
        }
        if (isVideoFile(file) && !(result.photo && result.photo.coverFileId)) {
          const photoId = result.photo && result.photo.id;
          if (photoId && file.thumbTempFilePath) {
            this.setData({ uploadLabel: `正在保存视频封面 ${index + 1}/${files.length}` });
            try {
              await api.uploadVideoCover(file.thumbTempFilePath, {
                photoId,
                name: `视频封面-${photoId}.jpg`,
              });
            } catch (error) {
              console.error("保存视频封面失败", photoId, error);
              coverFailures += 1;
            }
          } else {
            coverFailures += 1;
          }
        }
        completed += 1;
      }
      wx.showToast({
        title: duplicateSkipped
          ? `已上传 ${completed - duplicateSkipped} 项，跳过重复 ${duplicateSkipped} 项`
          : coverFailures ? `已上传，${coverFailures} 个封面失败` : `已上传 ${completed} 项`,
        icon: coverFailures || duplicateSkipped ? "none" : "success",
        duration: coverFailures || duplicateSkipped ? 3000 : 1500,
      });
      this.loadLibrary(this.data.selectedFolder, true);
    } catch (error) {
      if (error.statusCode === 401) {
        api.clearSession();
        wx.reLaunch({ url: "/pages/login/login" });
        return;
      }
      wx.showToast({ title: error.message || "上传失败", icon: "none", duration: 3000 });
      if (completed) this.loadLibrary(this.data.selectedFolder, true);
    } finally {
      this.setData({ uploading: false, uploadProgress: 0, uploadLabel: "" });
    }
  },

  retry() {
    this.loadLibrary(this.data.selectedFolder, false, false, this.data.recycleMode);
  },

  logout() {
    api.request("/api/auth/session", { method: "DELETE" }).catch(() => {}).finally(() => {
      api.clearSession();
      wx.reLaunch({ url: "/pages/login/login" });
    });
  },

  onShareAppMessage() {
    return { title: "伞兵训练营的时光集", path: "/pages/login/login" };
  },
});
