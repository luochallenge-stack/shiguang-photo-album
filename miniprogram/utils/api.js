const API_BASE = "https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com";
const TOKEN_KEY = "albumSessionToken";
const USER_KEY = "albumCurrentUser";
const FOLDER_TOKENS_KEY = "albumFolderTokens";

function getSessionToken() {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function saveSession(sessionToken, user) {
  wx.setStorageSync(TOKEN_KEY, sessionToken);
  wx.setStorageSync(USER_KEY, user);
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  wx.removeStorageSync(FOLDER_TOKENS_KEY);
}

function currentUser() {
  return wx.getStorageSync(USER_KEY) || null;
}

function request(path, options = {}) {
  const token = getSessionToken();
  const header = {
    "content-type": "application/json",
    "x-album-client": "miniprogram",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.folderToken ? { "x-album-folder-token": options.folderToken } : {}),
  };

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}`,
      method: options.method || "GET",
      data: options.data,
      header,
      timeout: options.timeout || 20000,
      success(response) {
        const payload = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(payload);
          return;
        }
        const error = new Error(payload.error || `请求失败 (${response.statusCode})`);
        error.statusCode = response.statusCode;
        reject(error);
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络连接失败"));
      },
    });
  });
}

function uploadFile(path, filePath, formData, onProgress) {
  const token = getSessionToken();
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: `${API_BASE}${path}`,
      filePath,
      name: "file",
      formData,
      header: {
        "x-album-client": "miniprogram",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 600000,
      success(response) {
        let payload = {};
        try {
          payload = JSON.parse(response.data || "{}");
        } catch {
          payload = {};
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(payload);
          return;
        }
        const error = new Error(payload.error || `上传失败 (${response.statusCode})`);
        error.statusCode = response.statusCode;
        reject(error);
      },
      fail(error) {
        reject(new Error(error.errMsg || "上传连接失败"));
      },
    });
    if (typeof onProgress === "function") task.onProgressUpdate(onProgress);
  });
}

function uploadMedia(filePath, formData, onProgress) {
  return uploadFile("/api/photos", filePath, formData, onProgress);
}

function uploadVideoCover(filePath, formData) {
  return uploadFile("/api/photos/cover", filePath, formData);
}

function generateVideoCover(photoId) {
  return request("/api/photos/cover/generate", {
    method: "POST",
    data: { photoId },
    timeout: 120000,
  });
}

function authenticate(mode, data) {
  return request(`/api/auth/${mode}`, { method: "POST", data }).then((payload) => {
    if (!payload.sessionToken || !payload.user) throw new Error("服务器没有返回小程序登录凭证");
    saveSession(payload.sessionToken, payload.user);
    return payload.user;
  });
}

module.exports = {
  API_BASE,
  FOLDER_TOKENS_KEY,
  authenticate,
  clearSession,
  currentUser,
  generateVideoCover,
  getSessionToken,
  request,
  saveSession,
  uploadMedia,
  uploadVideoCover,
};
