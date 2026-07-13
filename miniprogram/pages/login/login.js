const api = require("../../utils/api");

Page({
  data: {
    mode: "login",
    username: "",
    displayName: "",
    password: "",
    confirmPassword: "",
    loading: false,
    error: "",
  },

  onLoad() {
    if (!api.getSessionToken()) return;
    api.request("/api/auth/session")
      .then(({ user }) => {
        api.saveSession(api.getSessionToken(), user);
        wx.reLaunch({ url: "/pages/library/library" });
      })
      .catch(() => api.clearSession());
  },

  switchMode(event) {
    this.setData({
      mode: event.currentTarget.dataset.mode,
      password: "",
      confirmPassword: "",
      error: "",
    });
  },

  updateField(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: "" });
  },

  submit() {
    if (this.data.loading) return;
    const username = this.data.username.trim();
    const displayName = this.data.displayName.trim();
    const { mode, password, confirmPassword } = this.data;
    if (!username || !password || (mode === "register" && !displayName)) {
      this.setData({ error: "请完整填写账号信息" });
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      this.setData({ error: "两次输入的密码不一致" });
      return;
    }

    this.setData({ loading: true, error: "" });
    api.authenticate(mode, { username, password, displayName })
      .then(() => wx.reLaunch({ url: "/pages/library/library" }))
      .catch((error) => this.setData({ error: error.message || "操作失败" }))
      .finally(() => this.setData({ loading: false }));
  },
});
