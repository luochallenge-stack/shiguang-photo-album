const api = require("../../utils/api");

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

Page({
  data: {
    user: {},
    folders: [],
    photos: [],
    selectedFolder: "",
    selectedFolderName: "全部影像",
    loading: true,
    error: "",
    unlockOpen: false,
    unlockPassword: "",
    pendingFolder: null,
    unlocking: false,
  },

  onLoad(options) {
    if (!api.getSessionToken()) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    this.setData({ user: api.currentUser() });
    this.loadLibrary(options.folder || "");
  },

  onPullDownRefresh() {
    this.loadLibrary(this.data.selectedFolder, true);
  },

  loadLibrary(folderSlug = "", refreshing = false) {
    const folderTokens = wx.getStorageSync(api.FOLDER_TOKENS_KEY) || {};
    this.setData({ loading: !refreshing, error: "" });
    api.request(`/api/library${folderSlug ? `?folder=${encodeURIComponent(folderSlug)}` : ""}`, {
      folderToken: folderTokens[folderSlug] || "",
    })
      .then((payload) => {
        const selected = payload.folders.find((folder) => folder.slug === folderSlug);
        if (payload.folderLocked && selected) {
          delete folderTokens[folderSlug];
          wx.setStorageSync(api.FOLDER_TOKENS_KEY, folderTokens);
          this.openUnlock(selected);
          return;
        }
        const photos = payload.photos.map((photo) => ({
          ...photo,
          video: String(photo.mimeType || "").startsWith("video/"),
          sizeLabel: formatSize(photo.size || 0),
          dateLabel: formatDate(photo.createdAt),
        }));
        this.setData({
          folders: payload.folders,
          photos,
          selectedFolder: folderSlug,
          selectedFolderName: selected ? selected.name : "全部影像",
          loading: false,
          unlockOpen: false,
          unlockPassword: "",
          pendingFolder: null,
        });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        this.setData({ loading: false, error: error.message || "读取相册失败" });
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

  openMedia(event) {
    const item = this.data.photos.find((photo) => photo.id === event.currentTarget.dataset.id);
    if (!item) return;
    if (item.video) {
      wx.setStorageSync("albumCurrentMedia", item);
      wx.navigateTo({ url: "/pages/viewer/viewer" });
      return;
    }
    const imageUrls = this.data.photos.filter((photo) => !photo.video).map((photo) => photo.url);
    wx.previewImage({ current: item.url, urls: imageUrls });
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
