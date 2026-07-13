Page({
  data: { media: null },

  onLoad() {
    const media = wx.getStorageSync("albumCurrentMedia");
    if (!media || !media.url) {
      wx.navigateBack();
      return;
    }
    this.setData({ media });
    wx.setNavigationBarTitle({ title: media.name || "视频" });
  },
});
