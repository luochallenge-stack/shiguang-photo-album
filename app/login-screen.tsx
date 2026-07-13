"use client";

import { KeyRound, LoaderCircle, LockKeyhole, LogIn, UserPlus } from "lucide-react";
import Image from "next/image";
import { FormEvent, useState } from "react";

type AuthMode = "login" | "register";

async function responseJson(response: Response): Promise<{ error?: string }> {
  return response.json() as Promise<{ error?: string }>;
}

export default function LoginScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setPassword("");
    setConfirmPassword("");
  };

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, displayName }),
      });
      const payload = await responseJson(response);
      if (!response.ok) throw new Error(payload.error || (mode === "login" ? "登录失败" : "注册失败"));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (mode === "login" ? "登录失败" : "注册失败"));
    } finally {
      setLoading(false);
    }
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
        <span className="login-brand-mark"><Image src="/logo.png" alt="" width={58} height={58} priority /></span>
        <div>
          <h1>伞兵训练营的时光集</h1>
          <p>五个人，从初中到现在。照片和视频留在这里，故事继续往前走。</p>
        </div>
        <div className="login-security-note">
          <LockKeyhole size={18} />
          <span>所有成员需要登录，普通账号默认只有浏览权限。</span>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-heading">
          <span>成员入口</span>
          <h2 id="login-title">{mode === "login" ? "登录相册" : "创建账号"}</h2>
          <p>{mode === "login" ? "使用相册账号继续浏览共同的时光。" : "注册成功后即可浏览，管理权限由管理员单独授权。"}</p>
        </div>

        <div className="auth-mode-switch" role="tablist" aria-label="账号操作">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")} role="tab">
            <LogIn size={16} /> 登录
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")} role="tab">
            <UserPlus size={16} /> 注册
          </button>
        </div>

        <form className="credential-form" onSubmit={submitCredentials}>
          {mode === "register" && (
            <label>
              <span>昵称</span>
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={20}
                required
              />
            </label>
          )}
          <label>
            <span>用户名</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={24}
              pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,23}"
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              maxLength={72}
              required
            />
          </label>
          {mode === "register" && (
            <label>
              <span>确认密码</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
              />
            </label>
          )}
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="credential-submit" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={17} /> : mode === "login" ? <LogIn size={17} /> : <UserPlus size={17} />}
            {mode === "login" ? "登录" : "注册并进入"}
          </button>
        </form>

        <button className="admin-login-toggle" onClick={() => setAdminOpen((value) => !value)}>
          <KeyRound size={16} /> 管理员口令入口
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
