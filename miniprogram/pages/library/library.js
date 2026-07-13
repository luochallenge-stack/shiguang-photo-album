const api = require("../../utils/api");

const PAGE_SIZE = 24;
const COMPRESS_THRESHOLD = 8 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 50;
const PICKER_BATCH_SIZE = 9;
const MAX_BATCH_ACTION_COUNT = 100;
let libraryRequestId = 0;
let pendingUploadFiles = [];

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

function uploadName(path, index) {
  const extensionMatch = String(path || "").match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "jpg";
  const date = new Date();
  const pad = (part) => String(part).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `照片-${stamp}-${index + 1}.${extension}`;
}

function compressIfNeeded(file) {
  if (!file || !file.tempFilePath || file.size <= COMPRESS_THRESHOLD) {
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
    unlockOpen: false,
    unlockPassword: "",
    pendingFolder: null,
    unlocking: false,
    uploading: false,
    uploadProgress: 0,
    uploadLabel: "",
    selectionOpen: false,
    selectingImages: false,
    selectedCount: 0,
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
  },

  onLoad(options) {
    if (!api.getSessionToken()) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    this.setData({ user: api.currentUser() || {} });
    this.loadLibrary(options.folder || "");
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
    const folderTokens = wx.getStorageSync(api.FOLDER_TOKENS_KEY) || {};
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
    api.request(`/api/library?${query.join("&")}`, {
      folderToken: folderTokens[folderSlug] || "",
    })
      .then((payload) => {
        if (requestId !== libraryRequestId) return;
        const selected = payload.folders.find((folder) => folder.slug === folderSlug);
        if (payload.folderLocked && selected) {
          delete folderTokens[folderSlug];
          wx.setStorageSync(api.FOLDER_TOKENS_KEY, folderTokens);
          this.openUnlock(selected);
          return;
        }
        const photos = payload.photos.map((photo) => ({
          ...photo,
          url: mediaUrl(photo.url),
          thumbnailUrl: mediaUrl(photo.thumbnailUrl || photo.url),
          video: String(photo.mimeType || "").startsWith("video/"),
          sizeLabel: formatSize(photo.size || 0),
          dateLabel: formatDate(photo.createdAt),
          operatorLabel: operationLabel(photo),
          operatorDateLabel: photo.lastActionAt ? formatDate(photo.lastActionAt) : "",
          purgeDateLabel: photo.purgeAt ? formatDate(photo.purgeAt) : "",
          selected: false,
        }));
        this.setData({
          folders: payload.folders,
          photos: append ? this.data.photos.concat(photos) : photos,
          total: Number(payload.total) || 0,
          selectedFolder: folderSlug,
          selectedFolderName: recycleMode ? "回收站" : selected ? selected.name : "全部影像",
          loading: false,
          loadingMore: false,
          hasMore: Boolean(payload.hasMore),
          nextOffset: Number(payload.nextOffset) || 0,
          unlockOpen: false,
          unlockPassword: "",
          pendingFolder: null,
          editMode: append ? this.data.editMode : false,
          batchSelectedCount: append ? this.data.batchSelectedCount : 0,
          allLoadedSelected: false,
          batchMoveOpen: false,
          recycleMode,
          recycleCount: Number(payload.recycleCount) || 0,
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

  chooseFolder(event) {
    const slug = event.currentTarget.dataset.slug || "";
    this.exitEditMode();
    if (!slug) {
      this.loadLibrary("", false, false, false);
      return;
    }
    const folder = this.data.folders.find((item) => item.slug === slug);
    const tokens = wx.getStorageSync(api.FOLDER_TOKENS_KEY) || {};
    if (folder && folder.locked && this.data.user.role !== "admin" && !tokens[slug]) {
      this.openUnlock(folder);
      return;
    }
    this.loadLibrary(slug, false, false, false);
  },

  chooseRecycleBin() {
    if (this.data.user.role !== "admin") return;
    this.exitEditMode();
    this.loadLibrary("", false, false, true);
  },

  openUnlock(folder) {
    this.setData({ unlockOpen: true, pendingFolder: folder, unlockPassword: "", loading: false, error: "" });
  },

  closeUnlock() {
    if (this.data.unlocking) return;
    this.setData({ unlockOpen: false, pendingFolder: null, unlockPassword: "" });
  },

  noop() {},

  updateUnlockPassword(event) {
    this.setData({ unlockPassword: event.detail.value });
  },

  unlockFolder() {
    const folder = this.data.pendingFolder;
    const password = this.data.unlockPassword;
    if (!folder || !password || this.data.unlocking) return;
    this.setData({ unlocking: true });
    api.request("/api/folders/unlock", {
      method: "POST",
      data: { folderSlug: folder.slug, password },
    })
      .then(({ accessToken }) => {
        if (!accessToken) throw new Error("服务器没有返回文件夹凭证");
        const tokens = wx.getStorageSync(api.FOLDER_TOKENS_KEY) || {};
        tokens[folder.slug] = accessToken;
        wx.setStorageSync(api.FOLDER_TOKENS_KEY, tokens);
        this.loadLibrary(folder.slug);
      })
      .catch((error) => wx.showToast({ title: error.message || "解锁失败", icon: "none" }))
      .finally(() => this.setData({ unlocking: false }));
  },

  thumbnailError(event) {
    const id = event.currentTarget.dataset.id;
    const photos = this.data.photos.map((photo) => photo.id === id
      ? { ...photo, thumbnailUrl: photo.url }
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
    if (item.video) {
      wx.setStorageSync("albumCurrentMedia", item);
      wx.navigateTo({ url: "/pages/viewer/viewer" });
      return;
    }
    const tokens = wx.getStorageSync(api.FOLDER_TOKENS_KEY) || {};
    wx.showLoading({ title: "正在打开" });
    api.request(`/api/photos/url?id=${encodeURIComponent(item.id)}`, {
      folderToken: tokens[item.folderSlug] || "",
    })
      .then(({ url }) => {
        const current = mediaUrl(url || item.url);
        const urls = this.data.photos
          .filter((photo) => !photo.video)
          .map((photo) => photo.id === item.id ? current : photo.url);
        wx.previewImage({ current, urls });
      })
      .catch((error) => wx.showToast({ title: error.message || "打开图片失败", icon: "none" }))
      .finally(() => wx.hideLoading());
  },

  toggleEditMode() {
    if (this.data.user.role !== "admin" || this.data.uploading || this.data.batchSaving) return;
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
    if (this.data.recycleMode || !this.data.batchSelectedCount || this.data.batchSaving) return;
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
      moveFolderNames: moveFolders.map((folder) => `${folder.name}${folder.locked ? "（已加密）" : ""}`),
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
    if (!this.data.batchSelectedCount || this.data.batchSaving) return;
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
    if (!this.data.batchSelectedCount || this.data.batchSaving) return;
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

  chooseImages() {
    if (this.data.user.role !== "admin") return;
    if (!this.data.selectedFolder) {
      wx.showToast({ title: "请先选择目标文件夹", icon: "none" });
      return;
    }
    if (this.data.uploading) return;
    pendingUploadFiles = [];
    this.setData({ selectionOpen: true, selectedCount: 0 }, () => this.addMoreImages());
  },

  addMoreImages() {
    if (this.data.uploading || this.data.selectingImages) return;
    const remaining = MAX_UPLOAD_COUNT - pendingUploadFiles.length;
    if (remaining <= 0) {
      wx.showToast({ title: "本次已选满 50 张", icon: "none" });
      return;
    }
    this.setData({ selectingImages: true });
    wx.chooseMedia({
      count: Math.min(PICKER_BATCH_SIZE, remaining),
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: ({ tempFiles }) => {
        const selected = (tempFiles || []).slice(0, remaining);
        pendingUploadFiles = pendingUploadFiles.concat(selected);
        this.setData({ selectedCount: pendingUploadFiles.length });
      },
      complete: () => this.setData({ selectingImages: false }),
    });
  },

  cancelImageSelection() {
    if (this.data.selectingImages) return;
    pendingUploadFiles = [];
    this.setData({ selectionOpen: false, selectedCount: 0 });
  },

  uploadSelectedImages() {
    if (!pendingUploadFiles.length || this.data.selectingImages) return;
    const files = pendingUploadFiles.slice(0, MAX_UPLOAD_COUNT);
    pendingUploadFiles = [];
    this.setData({ selectionOpen: false, selectedCount: 0 }, () => this.uploadImages(files));
  },

  async uploadImages(files) {
    if (!files.length || this.data.uploading) return;
    this.setData({ uploading: true, uploadProgress: 0, uploadLabel: `准备上传 1/${files.length}` });
    let completed = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        this.setData({ uploadLabel: `正在上传 ${index + 1}/${files.length}` });
        const filePath = await compressIfNeeded(file);
        await api.uploadImage(filePath, {
          folderSlug: this.data.selectedFolder,
          name: uploadName(filePath, index),
          width: String(file.width || ""),
          height: String(file.height || ""),
        }, ({ progress }) => {
          const overall = Math.round(((index * 100) + progress) / files.length);
          this.setData({ uploadProgress: overall });
        });
        completed += 1;
      }
      wx.showToast({ title: `已上传 ${completed} 张`, icon: "success" });
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
