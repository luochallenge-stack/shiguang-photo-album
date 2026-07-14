const api = require("../../utils/api");

Page({
  data: {
    mode: "video",
    media: {},
    photos: [],
    index: 0,
    imageUrl: "",
    videoUrl: "",
    loading: true,
    waiting: false,
    error: "",
  },

  onLoad(options = {}) {
    if (options.mode === "image") {
      const photos = wx.getStorageSync("albumViewerPhotos") || [];
      const index = Number(wx.getStorageSync("albumViewerIndex")) || 0;
      if (!photos.length) {
        wx.navigateBack();
        return;
      }
      this.setData({ mode: "image", photos, index: Math.max(0, Math.min(index, photos.length - 1)), media: photos[index] || photos[0] });
      this.loadImage();
      return;
    }
    const media = wx.getStorageSync("albumCurrentMedia");
    if (!media || !media.id) {
      wx.navigateBack();
      return;
    }
    this.setData({ media });
    wx.setNavigationBarTitle({ title: media.name || "视频" });
    this.loadVideo();
  },

  loadImage() {
    const media = this.data.photos[this.data.index];
    if (!media) {
      wx.navigateBack();
      return;
    }
    this.setData({ media, imageUrl: "", loading: true, waiting: false, error: "" });
    wx.setNavigationBarTitle({ title: media.name || "图片" });
    api.request(`/api/photos/url?id=${encodeURIComponent(media.id)}`)
      .then((result) => {
        const url = encodeURI(result.displayUrl || result.url || media.previewUrl || media.url || "");
        if (!url) throw new Error("服务器没有返回图片链接");
        this.setData({ imageUrl: url, loading: false });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        this.setData({ loading: false, error: error.message || "图片加载失败" });
      });
  },

  switchImage(event) {
    const direction = Number(event.currentTarget.dataset.direction) || 1;
    const total = this.data.photos.length;
    if (!total) return;
    const index = (this.data.index + direction + total) % total;
    this.setData({ index }, () => this.loadImage());
  },

  closeImage() {
    if (this.data.mode === "image") wx.navigateBack();
  },

  loadVideo() {
    const media = this.data.media;
    this.setData({ loading: true, waiting: false, error: "" });
    api.request(`/api/photos/url?id=${encodeURIComponent(media.id)}`)
      .then(({ url }) => {
        if (!url) throw new Error("服务器没有返回视频链接");
        this.setData({ videoUrl: encodeURI(url), loading: false });
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        this.setData({ loading: false, error: error.message || "视频加载失败" });
      });
  },

  handleLoaded() {
    this.setData({ loading: false, waiting: false, error: "" });
  },

  handlePlay() {
    this.setData({ loading: false, waiting: false, error: "" });
  },

  handleWaiting() {
    this.setData({ waiting: true });
  },

  handleVideoError(event) {
    const detail = event.detail || {};
    const message = detail.errMsg || (this.data.mode === "image" ? "图片暂时无法打开，请重新加载" : "视频暂时无法播放，请重新加载");
    this.setData({ loading: false, waiting: false, error: message });
  },

  retry() {
    if (this.data.mode === "image") {
      this.setData({ imageUrl: "" }, () => this.loadImage());
      return;
    }
    this.setData({ videoUrl: "" }, () => this.loadVideo());
  },
});
