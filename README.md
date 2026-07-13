# 伞兵训练营的时光集

一个公开浏览、受控管理的在线影像集：支持虚拟文件夹、文件夹密码、批量照片/视频上传、上传进度、网格/列表浏览、在线播放、重命名、删除、复制文件夹链接和下载。

照片支持 JPEG、PNG、WebP、GIF、HEIC、HEIF，单张最大 50 MB；视频支持 MP4、MOV、M4V、WebM、MPEG，单个最大 500 MB。浏览器使用服务端签发的单文件临时凭证直传 CloudBase 云存储，避免大文件经过云托管请求体。

线上地址：<https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com/>

旧的云托管域名会自动跳转到上述官方 Web 安全域名，并保留文件夹和上传链接参数。

CloudBase 环境：`paratrooper-battalion-d1b3b82e83`，云托管服务：`sanbing`。

## 腾讯云架构

- CloudBase 云存储保存照片与视频原文件，并通过临时 CDN 链接在线查看和下载。
- CloudBase 文档数据库保存文件夹、影像索引和上传链接权限。
- CloudBase 服务端 API Key 只存在服务端环境变量中，不会发送到浏览器。
- 普通访问者只能浏览；管理口令可创建文件夹、重命名或永久删除影像，每个文件夹可生成独立上传链接。
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
