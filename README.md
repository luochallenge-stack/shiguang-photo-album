# 拾光册

一个公开浏览、受控上传的在线相册：支持虚拟文件夹、批量图片上传、上传进度、网格/列表浏览、原图预览、复制文件夹链接和下载。

线上地址：<https://sanbing-4108035-1313194650.ap-shanghai.run.tcloudbase.com/>

CloudBase 环境：`paratrooper-battalion-d1b3b82e83`，云托管服务：`sanbing`。

## 腾讯云架构

- CloudBase 云存储保存图片原文件，并通过 CDN 链接在线查看和下载。
- CloudBase 文档数据库保存文件夹、图片索引和上传链接权限。
- CloudBase 服务端 API Key 只存在服务端环境变量中，不会发送到浏览器。
- 普通访问者只能浏览；管理口令可创建文件夹，每个文件夹可生成独立上传链接。
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
