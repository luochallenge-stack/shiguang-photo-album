const api = require("../../utils/api");

const imagePrefetching = new Set();
const imageRefreshing = new Set();
const imageFailedSources = new Set();

function warmImageCache(url) {
  if (!url || typeof wx.getImageInfo !== "function") return;
  wx.getImageInfo({ src: url, fail() {} });
}

function imageSource(photo) {
  return (photo && (photo.displayUrl || photo.viewerUrl || photo.previewUrl || photo.url)) || "";
}

function normalizeImagePhotos(photos) {
  return (photos || []).map((photo) => ({
    ...photo,
    displayUrl: imageSource(photo),
  }));
}

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
      const photos = normalizeImagePhotos(wx.getStorageSync("albumViewerPhotos") || []);
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
    const currentUrl = imageSource(media);
    const targetId = media.id;
    this.setData({ media, imageUrl: currentUrl, loading: !currentUrl, waiting: false, error: "" });
    wx.setNavigationBarTitle({ title: media.name || "图片" });
    if (currentUrl) {
      warmImageCache(currentUrl);
      this.prefetchAdjacentImages();
      return;
    }
    this.refreshImageUrl(targetId, true);
  },

  refreshImageUrl(photoId, showLoading) {
    if (!photoId || imageRefreshing.has(photoId)) return;
    imageRefreshing.add(photoId);
    if (showLoading) this.setData({ loading: true, error: "" });
    const original = this.data.photos.find((photo) => photo.id === photoId) || this.data.media || {};
    api.request(`/api/photos/url?id=${encodeURIComponent(photoId)}`)
      .then((result) => {
        const url = encodeURI(result.displayUrl || result.url || imageSource(original));
        if (!url) throw new Error("服务器没有返回图片链接");
        const photos = this.data.photos.map((photo) => photo.id === photoId
          ? { ...photo, viewerUrl: url, displayUrl: url }
          : photo);
        const currentMedia = this.data.media || {};
        if (currentMedia.id === photoId) {
          this.setData({ photos, media: { ...currentMedia, viewerUrl: url, displayUrl: url }, imageUrl: url, loading: false, error: "" }, () => {
            warmImageCache(url);
            this.prefetchAdjacentImages();
          });
          return;
        }
        this.setData({ photos }, () => warmImageCache(url));
      })
      .catch((error) => {
        if (error.statusCode === 401) {
          api.clearSession();
          wx.reLaunch({ url: "/pages/login/login" });
          return;
        }
        if (imageSource(this.data.media)) {
          this.setData({ loading: false });
          return;
        }
        this.setData({ loading: false, error: error.message || "图片加载失败" });
      })
      .finally(() => imageRefreshing.delete(photoId));
  },

  prefetchAdjacentImages() {
    const photos = this.data.photos || [];
    if (photos.length < 2) return;
    const previous = photos[(this.data.index - 1 + photos.length) % photos.length];
    const next = photos[(this.data.index + 1) % photos.length];
    this.prefetchImage(previous);
    this.prefetchImage(next);
  },

  prefetchImage(photo) {
    if (!photo || !photo.id || imagePrefetching.has(photo.id)) return;
    imagePrefetching.add(photo.id);
    warmImageCache(imageSource(photo));
    setTimeout(() => imagePrefetching.delete(photo.id), 0);
  },

  handleImageSwiperChange(event) {
    const index = Number(event.detail && event.detail.current) || 0;
    if (index === this.data.index) return;
    this.setData({ index }, () => this.loadImage());
  },

  closeImage() {
    if (this.data.mode === "image") wx.navigateBack();
  },

  loadVideo() {
    const media = this.data.media;
    this.setData({ loading: true, waiting: false, error: "" });
    api.request(`/api/photos/url?id=${encodeURIComponent(media.id)}`)
      .then(({ url, hlsUrl }) => {
        const playbackUrl = hlsUrl || url;
        if (!playbackUrl) throw new Error("服务器没有返回视频链接");
        this.setData({ videoUrl: encodeURI(playbackUrl), loading: false });
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

  handleImageError() {
    if (this.data.mode !== "image") return;
    const media = this.data.media || {};
    if (!media.id) return;
    const source = imageSource(media);
    const failedKey = `${media.id}:${source}`;
    if (imageFailedSources.has(failedKey)) {
      this.setData({ loading: false, waiting: false, error: "图片暂时无法打开，请重新加载" });
      return;
    }
    imageFailedSources.add(failedKey);
    this.refreshImageUrl(media.id, true);
  },

  handleVideoError(event) {
    const detail = event.detail || {};
    const message = detail.errMsg || (this.data.mode === "image" ? "图片暂时无法打开，请重新加载" : "视频暂时无法播放，请重新加载");
    this.setData({ loading: false, waiting: false, error: message });
  },

  retry() {
    if (this.data.mode === "image") {
      const media = this.data.media || {};
      imageFailedSources.clear();
      this.setData({ error: "" }, () => {
        if (media.id) this.refreshImageUrl(media.id, true);
        else this.loadImage();
      });
      return;
    }
    this.setData({ videoUrl: "" }, () => this.loadVideo());
  },
});
