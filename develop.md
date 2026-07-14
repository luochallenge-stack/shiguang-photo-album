# 开发与维护说明

本文档面向后续开发者和 AI 编码代理，描述“伞兵训练营的时光集”的当前架构、核心代码职责、权限边界、数据流、发布方式和改动约束。修改代码前应先阅读本文档，再以源码为最终依据。

## 1. 项目概览

项目由两个客户端和一套服务端组成：

- Web：Next.js 16 App Router + React 19，页面和 API 在同一服务中运行。
- 微信小程序：`miniprogram/` 下的原生 WXML、WXSS 和 JavaScript 客户端。
- 服务端：Next.js Route Handlers，负责认证、授权、审计、CloudBase 数据库和对象存储访问。
- 数据与文件：腾讯云 CloudBase 文档数据库和云存储。
- 生产运行：CloudBase Run，服务名 `sanbing`，监听端口 `3000`。

生产环境基线：

- CloudBase 环境：`paratrooper-battalion-d1b3b82e83`
- Web/API 地址：`https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com`
- 微信小程序 AppID：`wx5c6f75fd860fb659`

## 2. 目录和文件职责

```text
.
├── app/                         Next.js 页面、Web 客户端和 API
│   ├── api/                     服务端 Route Handlers
│   ├── album-client.tsx         登录后的 Web 相册主界面
│   ├── login-screen.tsx         Web 注册、登录和管理员应急入口
│   ├── page.tsx                 服务端读取会话并选择登录页或相册页
│   ├── layout.tsx               HTML 元信息和全局布局
│   └── globals.css              Web 全局样式
├── lib/                         服务端领域能力和 CloudBase 适配层
│   ├── access.ts                文件夹密码、访问令牌、上传令牌和上传票据
│   ├── audit.ts                 审计日志生成与 IP 摘要
│   ├── auth.ts                  用户密码、会话令牌和角色认证
│   ├── cloudbase.ts             数据模型、数据库查询和云存储操作
│   ├── media.ts                 媒体类型、扩展名和大小校验
│   └── validation.ts            文件夹名称和 slug 生成
├── miniprogram/                 原生微信小程序
│   ├── pages/login/             注册和登录
│   ├── pages/library/           文件夹、分页浏览、解锁、新建文件夹和管理员影像上传
│   ├── pages/viewer/            视频播放、缓冲和重试
│   ├── utils/api.js             API、Bearer 会话和 wx.uploadFile 封装
│   ├── app.json                 页面、导航栏和分包加载设置
│   └── project.config.json      AppID 和开发者工具配置
├── public/                      Web 静态资源和品牌 Logo
├── tests/rendered-html.test.mjs 构建产物与关键能力的回归断言
├── Dockerfile                   Next.js standalone 多阶段镜像
├── cloudbaserc.json             CloudBase 环境和服务名
├── next.config.ts               standalone 构建配置
├── .env.example                 环境变量模板
└── README.md                    使用、部署和产品范围说明
```

## 3. 核心数据模型

所有集合名集中定义在 `lib/cloudbase.ts`。

| 集合 | 类型 | 用途 |
| --- | --- | --- |
| `album_folders` | `AlbumFolder` | 文件夹名称、slug、目录顺序、创建时间和可选密码摘要 |
| `album_photos` | `AlbumPhoto` | 媒体元数据、CloudBase `fileId`、视频封面、所属文件夹、回收站时间和最近操作人 |
| `album_upload_tokens` | `UploadTokenRecord` | 每个文件夹当前有效的上传链接令牌摘要 |
| `album_users` | `AlbumUser` | 本地账号、角色、状态和密码摘要 |
| `album_audit_logs` | `AlbumAuditLog` | 登录、浏览和修改操作日志 |

关键字段约定：

- `folder.slug` 是 API、URL、对象路径和关联查询使用的稳定标识；显示名称变化不应直接改 slug。
- `folder.sortOrder` 是管理员保存的目录顺序；历史记录缺少该字段时按 `createdAt` 倒序回退。
- `photo.fileId` 是生成临时访问地址、查询文件和删除文件的权威标识。
- `photo.coverFileId` 是可选的视频封面文件标识；永久删除视频时必须与 `fileId` 一并删除。
- `photo.objectKey` 是云存储中的对象路径，格式为 `albums/{folderSlug}/{时间戳}-{随机值}-{文件名}`。
- `photo.url` 不是永久公开地址。读取列表和播放前应通过 `resolvePhotoUrls` 生成临时地址。
- `photo.deletedAt` 和 `photo.purgeAt` 表示回收站状态；正常列表必须排除 `deletedAt` 非空的记录。
- `photo.lastAction`、`lastActionBy`、`lastActionAt` 用于双端就近展示最近操作者；完整历史仍以 `album_audit_logs` 为准。
- `passwordHash` 和 `tokenHash` 只保存摘要，不保存文件夹密码或上传令牌明文。

影像列表已经使用数据库级分页：Web 每页 48 项，小程序每页 24 项；指定文件夹、全部影像和回收站分别查询。文件夹影像数量通过数据库聚合获得，不受单页数量影响。文件夹列表仍最多 100 个、用户最多 200 个、日志最多 300 条。

## 4. 认证和权限模型

### 4.1 用户身份

用户角色只有：

- `member`：默认注册角色，可浏览未加密内容；正确解锁后可浏览加密文件夹。
- `admin`：可浏览所有文件夹和回收站，并执行创建、上传、加密、重命名、批量移动、恢复、永久删除、用户授权和日志查看。

用户状态只有 `active` 和 `disabled`。`disabled` 用户即使持有未过期令牌也无法继续通过 `currentUser`。

### 4.2 Web 与小程序会话

- 会话由 `lib/auth.ts` 生成 HMAC 签名令牌，有效期 30 天。
- Web 使用 `album-session` HttpOnly Cookie。
- 小程序请求带 `x-album-client: miniprogram`，登录和注册接口额外返回 `sessionToken`。
- 小程序把令牌放在本地存储，并在请求中发送 `Authorization: Bearer {token}`。
- 服务端 `currentUser` 同时支持 Bearer 和 Cookie，所有受保护接口都必须通过它读取用户。

管理员应急入口 `POST /api/auth/admin` 使用 `ALBUM_ADMIN_KEY` 创建或恢复 bootstrap 管理员。小程序不暴露该入口；小程序管理员应先由 Web 管理员把普通账号角色提升为 `admin`。

### 4.3 密码和签名

- 用户密码：PBKDF2-SHA256，210,000 次迭代，随机盐。
- 文件夹密码：PBKDF2-SHA256，210,000 次迭代，随机盐。
- 会话签名：优先使用 `ALBUM_SESSION_SECRET`，未配置时回退到 `ALBUM_ADMIN_KEY`。
- 文件夹访问令牌和上传票据签名使用 `ALBUM_ADMIN_KEY`。
- 比较签名、密码摘要和管理员口令时使用常量时间比较。

修改 `ALBUM_SESSION_SECRET` 会使现有登录会话失效；修改 `ALBUM_ADMIN_KEY` 会使现有文件夹访问令牌、上传票据和管理员应急口令失效。

## 5. 文件夹加密规则

加密逻辑位于 `lib/access.ts` 和 `app/api/folders/*`。

- 管理员通过 `PATCH /api/folders` 设置或更换密码，通过 `DELETE /api/folders` 移除密码。
- 用户通过 `POST /api/folders/unlock` 校验密码。
- Web 解锁成功后获得 12 小时 HttpOnly Cookie。
- 小程序解锁成功后额外获得 `accessToken`，保存到 `albumFolderTokens`，以后放在 `x-album-folder-token` 请求头中。
- 更换文件夹密码会改变令牌版本，旧访问令牌立即失效。
- 解锁失败限制为同一 IP 和文件夹 15 分钟内 8 次。该计数当前保存在进程内存中，多实例扩容或重启会重置；若安全要求提高，应迁移到共享存储。

重要可见性约束：

- “全部影像”始终排除所有加密文件夹内容，包括管理员视图。
- 必须进入具体文件夹后才能查看其中内容。
- 加密文件夹在列表中不暴露真实影像数量，`photoCount` 返回 0。
- 新增任何“搜索、最近上传、推荐、统计”入口时，都必须重复应用该过滤规则，不能绕过 `canReadFolder`。

## 6. 媒体存储与上传

### 6.1 支持范围

`lib/media.ts` 是服务端最终校验来源：

- 图片：JPEG、PNG、WebP、GIF、HEIC、HEIF，最大 50 MB。
- 视频：MP4、MOV、M4V、WebM、MPEG，最大 500 MB。
- MIME 不可靠时会按扩展名推断，但不支持的 MIME 和扩展名仍会拒绝。

客户端校验只用于提前提示，不能替代服务端 `mediaInfo` 和 `mediaSizeError`。

### 6.2 Web 直传链路

Web 使用直传，避免大视频经过 CloudBase Run 请求体：

1. `POST /api/photos/upload` 校验身份、文件夹权限和媒体信息。
2. 服务端调用 `createDirectUpload` 获取 CloudBase 单文件上传地址和请求头。
3. 服务端创建有效期 2 小时的签名上传票据。
4. 浏览器使用 `XMLHttpRequest PUT` 直接上传到云存储并展示进度。
5. 浏览器调用 `PATCH /api/photos/upload` 提交票据。
6. 服务端校验云端文件大小，写入 `album_photos` 并记录审计日志。

不得把 CloudBase API Key、长期凭证或数据库写权限发送给浏览器。保留“服务端签发一次性上传信息、客户端只拿单文件权限”的边界。

### 6.3 小程序上传链路

小程序开放管理员照片和视频上传：

1. 单个上传任务最多累计 50 项影像，选择器每轮最多添加 9 项。
2. 用户可以连续选择多轮，确认后统一进入顺序上传队列并显示整体进度。
3. 客户端提前拒绝超过 50 MB 的图片和超过 500 MB 的视频；大于 8 MB 的图片使用 `wx.compressImage`，视频不压缩。
4. `wx.uploadFile` 以 multipart 请求调用 `POST /api/photos`。
5. 服务端读取文件、校验管理员权限、上传云存储并写入数据库。
6. 服务端使用 FFmpeg 自动抽取视频首帧并写入 `coverFileId`；若自动抽取失败，小程序再把 `wx.chooseMedia` 返回的 `thumbTempFilePath` 上传到 `POST /api/photos/cover`。
7. 历史视频没有 `coverFileId` 时，管理员小程序会按当前页每次最多两条调用 `POST /api/photos/cover/generate` 补生成，避免一次请求处理过多视频。

该链路会让文件内容经过 CloudBase Run 并在服务端转为 Buffer，因此虽然功能上允许视频，长视频或接近 500 MB 上限的文件仍可能受网络、超时和请求体限制。需要稳定支持大视频时，应改为小程序可用的云存储直传，而不是继续放宽 multipart 限制。

### 6.4 文件夹上传链接

- 管理员调用 `POST /api/folders/share` 生成文件夹上传令牌。
- 数据库只保存令牌 SHA-256 摘要；再次生成会替换该文件夹的旧令牌。
- Web URL 使用 `?folder={slug}&upload={token}`。
- 上传者仍必须登录，只是可以在没有管理员角色时向指定文件夹上传。
- 令牌不能授予浏览加密文件夹、删除、重命名或其他管理能力。

## 7. 临时 URL、预览和视频

- `resolvePhotoUrls` 每批最多处理 50 个 `fileId`，默认临时地址有效期 10 分钟。
- `/api/library` 为列表中当前页媒体生成临时地址。
- 小程序图片列表使用 CloudBase `imageMogr2` 生成 640x640 WebP 缩略图。
- 小程序打开图片或视频时调用 `GET /api/photos/url?id=...` 刷新地址。
- 图片刷新地址有效期 10 分钟，视频刷新地址有效期 2 小时。
- `GET /api/photos/url` 必须先检查所属文件夹的读取权限，并返回 `cache-control: no-store`。
- 中文文件夹或文件名可能出现在临时 URL 中，小程序赋给 `<video>` 或预览组件前必须保留 `encodeURI(url)`。
- CloudBase 视频支持 HTTP Range；不要把视频先完整下载到小程序本地再播放。

## 8. API 约定

除注册、登录和管理员应急登录外，API 均要求有效会话。

| 方法与路径 | 权限 | 能力 |
| --- | --- | --- |
| `POST /api/auth/register` | 公开 | 注册 member，并建立会话 |
| `POST /api/auth/login` | 公开 | 本地账号登录 |
| `POST /api/auth/admin` | 管理口令 | bootstrap 管理员登录 |
| `GET/DELETE /api/auth/session` | 登录 | 读取会话或退出 |
| `GET /api/library` | 登录 | 按文件夹分页返回可见媒体；双端支持 `limit/offset` |
| `POST /api/folders` | admin | 创建文件夹 |
| `PATCH /api/folders/order` | admin | 保存完整文件目录顺序 |
| `PATCH /api/folders/name` | admin | 重命名文件夹，保持 slug 不变 |
| `PATCH/DELETE /api/folders` | admin | 设置、更换或移除文件夹密码 |
| `POST /api/folders/unlock` | 登录 | 解锁加密文件夹 |
| `POST /api/folders/share` | admin | 生成或轮换上传链接令牌 |
| `POST /api/photos/upload` | admin/上传令牌 | 生成 Web 直传信息和票据 |
| `PATCH /api/photos/upload` | admin/上传令牌 | 确认 Web 直传并登记媒体 |
| `POST /api/photos` | admin/上传令牌 | multipart 上传，供小程序照片和视频使用 |
| `POST /api/photos/cover` | admin | 为已上传视频保存首帧封面 |
| `PATCH/DELETE /api/photos` | admin | 重命名单项媒体，或将其移入回收站 |
| `PATCH/DELETE /api/photos/batch` | admin | 批量移动，或将最多 100 项影像移入回收站 |
| `PATCH/DELETE /api/photos/recycle` | admin | 批量恢复，或立即永久删除回收站影像 |
| `GET /api/photos/url` | 文件夹可读 | 刷新图片或视频临时地址 |
| `POST /api/audit` | 登录 | 记录客户端预览或下载事件 |
| `GET/PATCH /api/admin/users` | admin | 用户列表、角色和状态管理 |
| `GET /api/admin/audit-logs` | admin | 审计日志列表 |
| `POST /api/admin/verify` | admin | 简单管理员身份检查 |

`DELETE /api/photos` 现在是软删除，不再立即删除云文件。Route Handler 的基本顺序应保持为：认证、角色或资源权限、输入校验、领域操作、审计、响应。不能只依赖界面隐藏按钮实现授权。

### 回收站与操作人

- 普通删除只写入 `deletedAt`、`purgeAt` 和最近操作人，保留期固定为 7 天。
- `/api/library?recycle=1` 仅管理员可用，双端回收站从这里读取内容。
- 回收站支持批量恢复和立即永久删除；永久删除才调用 CloudBase `deleteFile` 并删除数据库记录。
- 每次读取 `/api/library` 会调用 `purgeExpiredPhotos` 清理已经到期的影像；因此在线使用时会自动清理，服务完全无流量时会推迟到下一次访问。
- 上传、重命名、移动、移入回收站和恢复都必须更新 `lastAction*` 字段；批量操作仍要逐张写审计记录。

## 9. 审计日志

所有敏感操作通过 `recordAudit` 写入 `album_audit_logs`。

- IP 不保存明文，而是和服务端密钥组合后生成不可逆 SHA-256 摘要。
- metadata 最多 20 项；键最长 60 字符，字符串值最长 300 字符。
- 用户代理、请求方法、路径、资源 ID、资源名称和时间会一并记录。
- 管理员查看用户或日志本身也会记录。
- 客户端只允许上报 `media.view` 和 `media.download`，不能自定义任意 action。

新增可见数据入口或修改操作时，应增加对应审计事件；若希望 Web 日志显示中文，还应同步更新 `app/album-client.tsx` 的 `ACTION_LABELS`。

## 10. Web 客户端

`app/page.tsx` 是动态服务端页面，读取 Cookie 后渲染 `LoginScreen` 或 `AlbumClient`。

`app/login-screen.tsx` 负责：

- 登录和注册切换。
- 注册字段的基础客户端校验。
- 管理员应急口令入口。
- 成功后刷新页面，让服务端重新读取 HttpOnly Cookie。

`app/album-client.tsx` 负责：

- 文件夹导航、全部影像、搜索、网格/列表视图。
- Web 每页读取 48 项，通过“加载更多”追加；标题显示数据库返回的真实总数。
- 新建文件夹、上传、拖放、进度和上传链接。
- 文件夹解锁、设置密码和移除密码。
- 图片/视频在线播放、下载、重命名、编辑模式、批量移动和 7 天回收站。
- 管理员用户授权和审计日志 Tab。
- 旧 CloudBase Run 域名到正式域名的客户端跳转。

`album-client.tsx` 当前是大型单组件。新增较复杂功能时，优先按“媒体上传、文件夹安全、管理后台、预览器”拆出组件或 hooks，但不要在没有收益时做全量重构。

生产域名同时硬编码在 `album-client.tsx` 和小程序 `utils/api.js`。更换域名时至少同步检查：

- `app/album-client.tsx` 的 `PUBLIC_ALBUM_ORIGIN` 和 `LEGACY_ALBUM_HOST`
- `miniprogram/utils/api.js` 的 `API_BASE`
- `README.md` 与 `miniprogram/README.md`
- 微信公众平台 request、uploadFile、downloadFile 合法域名

## 11. 微信小程序

小程序不使用微信或 QQ OAuth，而是复用站内账号。

### `miniprogram/utils/api.js`

- 保存和清除会话、用户、文件夹访问令牌。
- 所有 `wx.request` 自动添加 Bearer 令牌和 `x-album-client`。
- 加密文件夹请求按需添加 `x-album-folder-token`。
- `uploadMedia` 封装照片/视频的 `wx.uploadFile` 和上传进度，单文件超时为 10 分钟。
- `uploadVideoCover` 只在服务端没有成功生成封面时上传 `thumbTempFilePath`，封面失败不会重复上传原视频。
- `generateVideoCover` 为历史视频请求服务端补生成首帧封面，超时为 2 分钟。

### `pages/login`

- 登录页启动时先验证已有会话。
- 支持注册和登录，成功后进入相册。
- 401 或无效会话会清理本地存储。

### `pages/library`

- 每页请求 24 项，滚动到底继续加载。
- 使用 request id 防止切换文件夹时旧请求覆盖新状态。
- 图片使用缩略图和 lazy-load，失败时回退原图。
- Logo 旁的三横按钮打开文件目录；管理员的新建入口固定在目录顶部，并可用上下箭头持久化调整文件夹顺序。
- 文件夹“更多”操作支持重命名、设置或更换密码、移除密码；文件夹 slug 始终保持不变。
- 管理员可从影像卡片右上角重命名单项照片或视频，保存后重新加载以刷新最近操作人。
- 新上传视频使用微信选择器返回的首帧缩略图作为列表封面，没有封面的历史视频继续显示占位状态。
- 加密文件夹访问令牌按 slug 保存。
- 普通成员只读；管理员可新建文件夹，选择具体文件夹后可创建最多 50 项照片/视频的上传任务。
- 管理员编辑模式单次最多选择 100 项，支持批量移动和移入回收站。
- 管理员回收站支持批量恢复和永久删除；影像卡片显示最近操作者。
- 不允许在“全部影像”直接上传，因为服务端需要明确目标 folderSlug。

### `pages/viewer`

- 只负责视频播放。
- 进入页面后按媒体 ID 获取新的 2 小时临时地址。
- 处理 metadata、播放、缓冲、错误和重试状态。
- 播放地址必须经过 `encodeURI`。

小程序增加新 API 时，优先复用 `utils/api.js`，不要在页面中重复实现认证头和错误解析。

## 12. 环境变量和秘密管理

| 变量 | 用途 |
| --- | --- |
| `CLOUDBASE_ENV_ID` | CloudBase 环境 ID；也兼容运行时 `TCB_ENV` |
| `CLOUDBASE_APIKEY` | 保留在环境模板中的本地凭据配置项；当前源码未直接读取 |
| `ALBUM_ADMIN_KEY` | 管理员应急口令、文件夹访问和上传票据签名密钥 |
| `ALBUM_SESSION_SECRET` | 会话签名和审计 IP 摘要密钥 |
| `ALBUM_PUBLIC_ORIGIN` | 保留的正式域名配置项；当前客户端仍使用代码中的固定域名 |

`getCloudBase()` 当前只把环境 ID 传给 CloudBase SDK，生产环境依赖 CloudBase Run 的运行时身份。本地开发若需要访问真实 CloudBase，应按 SDK 要求提供本地身份，并在实现前确认 `CLOUDBASE_APIKEY` 的具体接入方式。不要仅因为变量存在于 `.env.example` 就假设代码已经消费它。

安全约束：

- `.env*`、微信代码上传私钥、会话令牌、上传令牌、文件夹密码和临时 URL 不得提交 Git。
- 微信代码上传私钥应保存在仓库外，只把路径传给 `miniprogram-ci`。
- 不要在命令行输出、日志、截图或文档中粘贴密钥内容。
- `ALBUM_SESSION_SECRET` 应和 `ALBUM_ADMIN_KEY` 使用不同的高强度随机值。

## 13. 本地开发和验证

Node.js 最低版本为 20.19，生产镜像使用 Node.js 22 Alpine。

```bash
npm install
cp .env.example .env.local
npm run dev
```

提交前至少执行：

```bash
npm run lint
npm test
git diff --check
```

`npm test` 会先执行完整 Next.js production build，再运行 `tests/rendered-html.test.mjs`。当前测试主要验证构建产物存在、关键安全代码和双端功能没有被移除，不是完整端到端测试。修改 API 合同、认证、上传或小程序页面时，应同步增加断言；高风险变更还应补真正的接口或浏览器测试。

不要为了让测试通过而删除安全断言。若测试与正确的新设计冲突，应同时更新实现、测试和本文档，并说明迁移原因。

## 14. 部署和发布

### CloudBase Run

后端和 Web 必须先部署，因为新小程序可能依赖新 API。

```bash
tcb login
tcb cloudrun deploy --serviceName sanbing --port 3000 --source . --force
```

部署后确认新版本状态为 `normal`、`FlowRatio` 为 100，并检查：

- 首页返回 HTTP 200。
- 新增接口存在且未登录时正确返回 401，而不是 404 或 500。
- 旧版本已退出流量。

### 微信小程序

- 项目目录是 `miniprogram/`，不是仓库根目录。
- 使用微信官方 `miniprogram-ci` 或微信开发者工具上传。
- 代码上传私钥不在仓库内。
- 当前网络出口 IP 可能动态变化；白名单开启时应使用稳定 CI 出口，或仅在上传期间按平台安全流程处理白名单。
- 上传完成只代表进入“版本管理”；体验版、提交审核和正式发布仍是独立步骤。

微信公众平台合法域名：

```text
request/uploadFile:
https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com

downloadFile:
https://7061-paratrooper-battalion-d1b3b82e83-1313194650.tcb.qcloud.la
```

## 15. 已知限制和扩展方向

- 影像列表使用数据库 `skip/limit` 分页；大量数据或高并发写入场景可进一步升级为基于 `createdAt + id` 的游标分页。
- Web 搜索目前只过滤已经加载到浏览器的页面，不是服务端全文搜索。
- 解锁失败限流存在单进程内存，不能跨实例共享。
- 小程序支持管理员新建、重命名、排序和加密文件夹，支持单项文件重命名、批量移动、回收站和带首帧封面的照片/视频上传；用户授权和日志查看仍在网页管理端完成。
- 小程序 multipart 上传经过应用服务器，不适合大文件。
- 云存储写入/删除与数据库记录不是事务操作；中途失败可能产生孤立对象或孤立记录，批量导入前应设计补偿和对账。
- `album-client.tsx` 体积较大，复杂迭代前可渐进拆分。
- 当前测试偏结构回归，缺少连接真实 CloudBase 的自动化集成测试。

优先扩展顺序建议：数据库游标分页、共享限流、小程序直传、接口集成测试、Web 组件拆分。

## 16. 后续 AI 开发检查单

开始修改前：

1. 阅读 `README.md`、本文档和目标模块源码。
2. 检查 `git status`，不要覆盖用户未提交的改动。
3. 明确功能影响 Web、小程序、API、数据库、审计和微信域名中的哪些部分。

实现时：

1. 权限判断放在服务端，客户端只负责体验。
2. 加密内容不得从“全部影像”、搜索或统计接口泄露。
3. 媒体地址使用临时 URL，不建立永久公开桶。
4. 新的修改操作和敏感读取补审计日志。
5. 不删除线上或测试媒体，除非用户明确要求。
6. 不修改生产集合结构而不提供兼容或迁移方案。
7. API 合同变化时同步更新 Web、小程序、测试和文档。

交付前：

1. 运行 lint、production build、测试和 `git diff --check`。
2. 查看完整 diff，确认无密钥、私钥、令牌、临时 URL 或无关文件。
3. 先部署 CloudBase Run，再上传小程序。
4. 验证线上状态和核心接口，而不只依赖命令返回成功。
5. 提交清晰的 Git commit 并推送 GitHub。
