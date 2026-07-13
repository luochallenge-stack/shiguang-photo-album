"use client";

import { CircleUserRound, Images, KeyRound, LoaderCircle, LockKeyhole, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  providers: { wechat: boolean; qq: boolean };
};

async function responseJson(response: Response): Promise<{ error?: string }> {
  return response.json() as Promise<{ error?: string }>;
}

export default function LoginScreen({ providers }: Props) {
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const message = new URLSearchParams(window.location.search).get("loginError");
      if (message) setError(message === "cancelled" ? "登录已取消" : message);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const socialLogin = (provider: "wechat" | "qq") => {
    const returnTo = `${window.location.pathname}${window.location.search.replace(/([?&])loginError=[^&]*/g, "$1").replace(/[?&]$/, "")}`;
    window.location.assign(`/api/auth/login/${provider}?returnTo=${encodeURIComponent(returnTo || "/")}`);
  };

  const adminLogin = async () => {
    if (!adminKey.trim()) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: adminKey }),
      });
      const payload = await responseJson(response);
      if (!response.ok) throw new Error(payload.error || "管理员登录失败");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand">
        <span className="login-brand-mark"><Images size={30} /></span>
        <div>
          <h1>伞兵训练营的时光集</h1>
          <p>登录后查看、上传和管理共同的照片与视频。</p>
        </div>
        <div className="login-security-note">
          <LockKeyhole size={18} />
          <span>每次访问与修改都会记录，受保护文件夹仍需单独密码。</span>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-heading">
          <span>成员入口</span>
          <h2 id="login-title">登录相册</h2>
          <p>使用已有社交账号，昵称会作为相册中的用户名称。</p>
        </div>

        <div className="social-login-list">
          <button className="social-login wechat" disabled={!providers.wechat} onClick={() => socialLogin("wechat")}>
            <MessageCircle size={21} />
            <span><strong>微信登录</strong><small>{providers.wechat ? "使用微信开放平台账号" : "等待配置微信开放平台"}</small></span>
          </button>
          <button className="social-login qq" disabled={!providers.qq} onClick={() => socialLogin("qq")}>
            <CircleUserRound size={21} />
            <span><strong>QQ 登录</strong><small>{providers.qq ? "使用 QQ 互联账号" : "等待配置 QQ 互联"}</small></span>
          </button>
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        <button className="admin-login-toggle" onClick={() => setAdminOpen((value) => !value)}>
          <KeyRound size={16} /> 管理员入口
        </button>
        {adminOpen && (
          <form className="admin-login-form" onSubmit={(event) => { event.preventDefault(); void adminLogin(); }}>
            <label htmlFor="bootstrap-admin-key">管理口令</label>
            <div>
              <input
                id="bootstrap-admin-key"
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
              <button type="submit" disabled={loading || !adminKey.trim()}>
                {loading ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
                登录
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
