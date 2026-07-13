const api = require("../../utils/api");

const PAGE_SIZE = 24;
const COMPRESS_THRESHOLD = 8 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 50;
const PICKER_BATCH_SIZE = 9;
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
    this.loadLibrary(this.data.selectedFolder, true);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.loadLibrary(this.data.selectedFolder, false, true);
    }
  },

  onUnload() {
    pendingUploadFiles = [];
  },

  loadLibrary(folderSlug = "", refreshing = false, append = false) {
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
    if (folderSlug) query.push(`folder=${encodeURIComponent(folderSlug)}`);
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
        }));
        this.setData({
          folders: payload.folders,
          photos: append ? this.data.photos.concat(photos) : photos,
          total: Number(payload.total) || 0,
          selectedFolder: folderSlug,
          selectedFolderName: selected ? selected.name : "全部影像",
          loading: false,
          loadingMore: false,
          hasMore: Boolean(payload.hasMore),
          nextOffset: Number(payload.nextOffset) || 0,
          unlockOpen: false,
          unlockPassword: "",
          pendingFolder: null,
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
    if (!slug) {
      this.loadLibrary("");
      return;
    }
    const folder = this.data.folders.find((item) => item.slug === slug);
    const tokens = wx.getStorageSync(api.FOLDER_TOKENS_KEY) || {};
    if (folder && folder.locked && this.data.user.role !== "admin" && !tokens[slug]) {
      this.openUnlock(folder);
      return;
    }
    this.loadLibrary(slug);
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
    const item = this.data.photos.find((photo) => photo.id === event.currentTarget.dataset.id);
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
    this.loadLibrary(this.data.selectedFolder);
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
