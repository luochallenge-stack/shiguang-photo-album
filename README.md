# 伞兵训练营的时光集

一个需要账号登录、受控管理的在线影像集：支持站内注册登录、用户角色、访问与修改日志、虚拟文件夹、文件夹密码、批量照片/视频上传、批量移动、7 天回收站、上传进度、网格/列表浏览、在线播放、重命名、复制文件夹链接和下载。

面向后续开发者和 AI 编码代理的架构、核心文件、权限边界与发布说明见 [`develop.md`](./develop.md)。

照片支持 JPEG、PNG、WebP、GIF、HEIC、HEIF，单张最大 50 MB；视频支持 MP4、MOV、M4V、WebM、MPEG，单个最大 500 MB。浏览器使用服务端签发的单文件临时凭证直传 CloudBase 云存储，避免大文件经过云托管请求体。

线上地址：<https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com/>

微信小程序原生客户端位于 [`miniprogram`](./miniprogram)，AppID 为 `wx5c6f75fd860fb659`。它与网页端共用账号、权限、日志、数据库和云存储；普通成员可浏览、解锁文件夹、预览图片并播放视频，管理员还可在小程序内新建文件夹，并向指定文件夹批量上传照片和视频。其余管理操作继续在网页端完成。

旧的云托管域名会自动跳转到上述官方 Web 安全域名，并保留文件夹和上传链接参数。

CloudBase 环境：`paratrooper-battalion-d1b3b82e83`，云托管服务：`sanbing`。

## 腾讯云架构

- CloudBase 云存储保存照片与视频原文件，并通过临时 CDN 链接在线查看和下载。
- CloudBase 文档数据库保存用户、审计日志、文件夹、影像索引和上传链接权限。
- CloudBase 服务端 API Key 只存在服务端环境变量中，不会发送到浏览器。
- 所有访问者必须先登录。注册成功后自动成为普通成员并可立即浏览；管理员可创建文件夹、上传、重命名、批量移动或将影像移入回收站，每个文件夹可生成独立上传链接。
- 管理员专属的“用户与日志”视图可以管理成员角色与状态，并查看访问、预览、下载和所有修改记录。客户端 IP 只保存带密钥的不可逆摘要。
- 管理员可以为任意文件夹设置、更换或移除密码。密码使用带随机盐的 PBKDF2-SHA256 保存，不存储明文。
- 加密文件夹中的照片和视频不会出现在“全部影像”中；进入该文件夹并正确输入密码后，浏览器获得 12 小时的 HttpOnly 访问凭证。
- CloudBase Run 承载完整 Next.js 服务，默认域名可在中国大陆直接访问。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

需要配置：

- `CLOUDBASE_ENV_ID`
- `CLOUDBASE_APIKEY`
- `ALBUM_ADMIN_KEY`
- `ALBUM_SESSION_SECRET`（建议使用独立的高强度随机值）
- `ALBUM_PUBLIC_ORIGIN`（线上相册域名）

注册用户的密码只保存为带随机盐的 PBKDF2-SHA256 摘要。普通成员默认只有浏览权限，管理员可在“用户与日志”中授权其他账号成为管理员或停用账号。`ALBUM_ADMIN_KEY` 是管理员应急入口。

## 腾讯云部署

```bash
tcb login
tcb cloudrun deploy --port 3000
```

## 验证

```bash
npm run build
npm test
```

小程序可以直接将 `miniprogram` 目录导入微信开发者工具。服务器合法域名和发布检查见 [`miniprogram/README.md`](./miniprogram/README.md)。
