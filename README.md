# 拾光册

一个面向个人使用的在线相册：支持虚拟文件夹、批量图片上传、上传进度、网格/列表浏览、原图预览、复制文件夹链接和下载。

## 存储结构

- 七牛 Kodo 保存图片原文件，浏览器使用一小时有效的单文件上传凭证直传。
- Cloudflare D1 保存文件夹和图片索引，不保存图片二进制。
- 七牛 AK/SK 仅存在服务端环境变量中，不会发送到浏览器。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

需要配置：

- `QINIU_ACCESS_KEY`
- `QINIU_SECRET_KEY`
- `QINIU_BUCKET`
- `QINIU_DOMAIN`
- `QINIU_UPLOAD_URL`（可选，默认 `https://upload.qiniup.com`）

## 验证

```bash
npm run build
npm test
```
