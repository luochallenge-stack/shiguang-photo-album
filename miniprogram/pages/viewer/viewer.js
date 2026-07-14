const api = require("../../utils/api");

Page({
  data: {
    media: {},
    videoUrl: "",
    loading: true,
    waiting: false,
    error: "",
  },

  onLoad() {
    const media = wx.getStorageSync("albumCurrentMedia");
    if (!media || !media.id) {
      wx.navigateBack();
      return;
    }
    this.setData({ media });
    wx.setNavigationBarTitle({ title: media.name || "视频" });
    this.loadVideo();
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
    const message = detail.errMsg || "视频暂时无法播放，请重新加载";
    this.setData({ loading: false, waiting: false, error: message });
  },

  retry() {
    this.setData({ videoUrl: "" }, () => this.loadVideo());
  },
});
