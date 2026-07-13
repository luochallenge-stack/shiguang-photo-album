"use client";

import {
  Check,
  ChevronRight,
  Clipboard,
  Download,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  Images,
  LayoutList,
  Link2,
  KeyRound,
  LoaderCircle,
  Maximize2,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type FolderItem = {
  id: string;
  name: string;
  slug: string;
  photoCount: number;
  createdAt: string;
};

type PhotoItem = {
  id: string;
  folderSlug: string;
  objectKey: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdAt: string;
};

type UploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
};

type LibraryResponse = {
  folders: FolderItem[];
  photos: PhotoItem[];
  storageConfigured: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function imageDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  if (!file.type.startsWith("image/") || file.type.includes("heic") || file.type.includes("heif")) {
    return { width: null, height: null };
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片尺寸"));
      image.src = objectUrl;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return { width: null, height: null };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function fileMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
  };
  return byExtension[extension || ""] || "application/octet-stream";
}

function uploadToQiniu(
  uploadUrl: string,
  token: string,
  objectKey: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("token", token);
    form.append("key", objectKey);
    form.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`上传失败 (${request.status})`));
    };
    request.onerror = () => reject(new Error("上传网络中断"));
    request.send(form);
  });
}

export default function Home() {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [dragging, setDragging] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [preview, setPreview] = useState<PhotoItem | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedUpload, setCopiedUpload] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminInput, setAdminInput] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [verifyingAdmin, setVerifyingAdmin] = useState(false);
  const [sharedFolder, setSharedFolder] = useState("");
  const [sharedUploadToken, setSharedUploadToken] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const adminHeaders = (contentType = false): Record<string, string> => ({
    ...(contentType ? { "content-type": "application/json" } : {}),
    ...(adminKey ? { "x-album-admin-key": adminKey } : {}),
  });

  const verifyAdminKey = async (candidate: string, remember = true) => {
    await readJson<{ ok: boolean }>(
      await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "x-album-admin-key": candidate },
      }),
    );
    setAdminKey(candidate);
    setIsAdmin(true);
    if (remember) sessionStorage.setItem("album-admin-key", candidate);
  };

  const loadLibrary = useCallback(async (folder = selectedFolder) => {
    setLoading(true);
    setError("");
    try {
      const query = folder ? `?folder=${encodeURIComponent(folder)}` : "";
      const data = await readJson<LibraryResponse>(await fetch(`/api/library${query}`));
      setFolders(data.folders);
      setPhotos(data.photos);
      setStorageConfigured(data.storageConfigured);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取相册失败");
    } finally {
      setLoading(false);
    }
  }, [selectedFolder]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("folder") || "";
    const uploadToken = params.get("upload") || "";
    if (fromUrl) setSelectedFolder(fromUrl);
    if (fromUrl && uploadToken) {
      setSharedFolder(fromUrl);
      setSharedUploadToken(uploadToken);
    }
    const savedAdminKey = sessionStorage.getItem("album-admin-key") || "";
    if (savedAdminKey) {
      void verifyAdminKey(savedAdminKey, false).catch(() => sessionStorage.removeItem("album-admin-key"));
    }
    void loadLibrary(fromUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFolder = folders.find((folder) => folder.slug === selectedFolder);
  const totalPhotos = folders.reduce((sum, folder) => sum + Number(folder.photoCount), 0);
  const visiblePhotos = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return photos;
    return photos.filter((photo) => photo.name.toLocaleLowerCase().includes(query));
  }, [photos, search]);
  const canUpload = Boolean(
    selectedFolder && (isAdmin || (sharedUploadToken && sharedFolder === selectedFolder)),
  );

  const chooseFolder = (slug: string) => {
    setSelectedFolder(slug);
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set("folder", slug);
    else url.searchParams.delete("folder");
    window.history.replaceState({}, "", url);
    void loadLibrary(slug);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    setError("");
    try {
      const result = await readJson<{ folder: FolderItem }>(
        await fetch("/api/folders", {
          method: "POST",
          headers: adminHeaders(true),
          body: JSON.stringify({ name: newFolderName }),
        }),
      );
      setFolders((current) => [result.folder, ...current]);
      setNewFolderName("");
      setNewFolderOpen(false);
      chooseFolder(result.folder.slug);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建文件夹失败");
    } finally {
      setCreatingFolder(false);
    }
  };

  const updateUpload = (id: string, change: Partial<UploadItem>) => {
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => fileMimeType(file).startsWith("image/"));
    if (!files.length) return;
    if (!selectedFolder) {
      setError("请先选择或新建一个文件夹");
      return;
    }
    if (!canUpload) {
      setError("这个链接没有上传权限，请使用管理口令或文件夹上传链接");
      return;
    }
    if (!storageConfigured) {
      setError("七牛存储尚未配置，暂时不能上传");
      return;
    }

    for (const file of files) {
      const uploadId = crypto.randomUUID();
      setUploads((current) => [
        ...current,
        { id: uploadId, name: file.name, progress: 0, status: "uploading" },
      ]);
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error("单张图片不能超过 50 MB");
        const mimeType = fileMimeType(file);
        const signed = await readJson<{
          token: string;
          uploadUrl: string;
          objectKey: string;
          publicUrl: string;
        }>(
          await fetch("/api/upload-token", {
            method: "POST",
            headers: adminHeaders(true),
            body: JSON.stringify({
              folderSlug: selectedFolder,
              filename: file.name,
              mimeType,
              uploadToken: isAdmin ? undefined : sharedUploadToken,
            }),
          }),
        );
        await uploadToQiniu(
          signed.uploadUrl,
          signed.token,
          signed.objectKey,
          file,
          (progress) => updateUpload(uploadId, { progress }),
        );
        const dimensions = await imageDimensions(file);
        await readJson<{ photo: PhotoItem }>(
          await fetch("/api/photos", {
            method: "POST",
            headers: adminHeaders(true),
            body: JSON.stringify({
              folderSlug: selectedFolder,
              objectKey: signed.objectKey,
              name: file.name,
              url: signed.publicUrl,
              size: file.size,
              mimeType,
              uploadToken: isAdmin ? undefined : sharedUploadToken,
              ...dimensions,
            }),
          }),
        );
        updateUpload(uploadId, { progress: 100, status: "done" });
      } catch (cause) {
        updateUpload(uploadId, {
          status: "error",
          error: cause instanceof Error ? cause.message : "上传失败",
        });
      }
    }
    await loadLibrary(selectedFolder);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(event.dataTransfer.files);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void uploadFiles(event.target.files);
    event.target.value = "";
  };

  const copyFolderLink = async () => {
    if (!selectedFolder) return;
    const url = new URL(window.location.href);
    url.searchParams.set("folder", selectedFolder);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const copyUploadLink = async () => {
    if (!selectedFolder || !isAdmin) return;
    setError("");
    try {
      const result = await readJson<{ uploadToken: string }>(
        await fetch("/api/folders/share", {
          method: "POST",
          headers: adminHeaders(true),
          body: JSON.stringify({ folderSlug: selectedFolder }),
        }),
      );
      const url = new URL(window.location.href);
      url.searchParams.set("folder", selectedFolder);
      url.searchParams.set("upload", result.uploadToken);
      await navigator.clipboard.writeText(url.toString());
      setCopiedUpload(true);
      window.setTimeout(() => setCopiedUpload(false), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成上传链接失败");
    }
  };

  const unlockAdmin = async () => {
    const candidate = adminInput.trim();
    if (!candidate) return;
    setVerifyingAdmin(true);
    setError("");
    try {
      await verifyAdminKey(candidate);
      setAdminInput("");
      setAdminOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理口令错误");
    } finally {
      setVerifyingAdmin(false);
    }
  };

  const lockAdmin = () => {
    sessionStorage.removeItem("album-admin-key");
    setAdminKey("");
    setIsAdmin(false);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><Images size={20} strokeWidth={2.2} /></div>
          <div>
            <strong>拾光册</strong>
            <span>私人影像空间</span>
          </div>
        </div>

        <nav className="folder-nav" aria-label="相册文件夹">
          <div className="nav-heading">
            <span>文件夹</span>
            {isAdmin && (
              <button className="icon-button inverse" onClick={() => setNewFolderOpen(true)} title="新建文件夹" aria-label="新建文件夹">
                <Plus size={17} />
              </button>
            )}
          </div>
          <button className={`folder-row ${selectedFolder ? "" : "active"}`} onClick={() => chooseFolder("")}>
            <Images size={18} />
            <span>全部照片</span>
            <b>{totalPhotos}</b>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={`folder-row ${selectedFolder === folder.slug ? "active" : ""}`}
              onClick={() => chooseFolder(folder.slug)}
            >
              {selectedFolder === folder.slug ? <FolderOpen size={18} /> : <Folder size={18} />}
              <span>{folder.name}</span>
              <b>{folder.photoCount}</b>
            </button>
          ))}
        </nav>

        <button className={`admin-access ${isAdmin ? "active" : ""}`} onClick={() => isAdmin ? lockAdmin() : setAdminOpen(true)}>
          {isAdmin ? <ShieldCheck size={16} /> : <KeyRound size={16} />}
          <span>{isAdmin ? "管理模式已开启" : "管理相册"}</span>
        </button>

        <div className="storage-meter">
          <div className="storage-line">
            <span><HardDrive size={15} /> 七牛 Kodo</span>
            <i className={storageConfigured ? "online" : "offline"} />
          </div>
          <div className="meter-track"><span style={{ width: `${Math.min(100, (totalPhotos / 3000) * 100)}%` }} /></div>
          <small>免费额度 10 GB / 月</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>相册</span><ChevronRight size={15} />
            <strong>{activeFolder?.name || "全部照片"}</strong>
          </div>
          <div className="top-actions">
            <label className="search-box">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索照片" />
            </label>
            {selectedFolder && (
              <button className="secondary-button" onClick={copyFolderLink}>
                {copied ? <Check size={17} /> : <Link2 size={17} />}
                {copied ? "已复制" : "文件夹链接"}
              </button>
            )}
            {selectedFolder && isAdmin && (
              <button className="secondary-button" onClick={() => void copyUploadLink()}>
                {copiedUpload ? <Check size={17} /> : <Share2 size={17} />}
                {copiedUpload ? "已复制" : "上传链接"}
              </button>
            )}
            <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={!canUpload} title={canUpload ? "上传照片" : "需要上传权限"}>
              <Upload size={18} /> 上传照片
            </button>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onFileChange} />
          </div>
        </header>

        <div className="content">
          {!storageConfigured && (
            <div className="notice" role="status">
              <HardDrive size={18} />
              <span><strong>等待接入七牛存储</strong> 配置完成后即可在线上传与查看原图。</span>
            </div>
          )}
          {sharedUploadToken && sharedFolder === selectedFolder && !isAdmin && (
            <div className="share-notice" role="status">
              <Share2 size={17} />
              <span>你可以向「{activeFolder?.name || "当前文件夹"}」上传照片</span>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="icon-button" onClick={() => setError("")} aria-label="关闭"><X size={16} /></button>
            </div>
          )}

          <div className="section-heading">
            <div>
              <h1>{activeFolder?.name || "全部照片"}</h1>
              <p>{visiblePhotos.length} 张照片</p>
            </div>
            <div className="view-toggle" aria-label="视图切换">
              <button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title="网格视图" aria-label="网格视图"><Grid2X2 size={17} /></button>
              <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="列表视图" aria-label="列表视图"><LayoutList size={18} /></button>
            </div>
          </div>

          {canUpload && (
            <div
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={19} />
              <span>添加到「{activeFolder?.name}」</span>
              <small>JPG、PNG、WebP、GIF、HEIC</small>
            </div>
          )}

          {loading ? (
            <div className="loading-state"><LoaderCircle className="spin" size={25} /> 正在读取照片</div>
          ) : visiblePhotos.length ? (
            <div className={viewMode === "grid" ? "photo-grid" : "photo-list"}>
              {visiblePhotos.map((photo) => (
                <article className="photo-card" key={photo.id}>
                  <button className="photo-preview" onClick={() => setPreview(photo)} aria-label={`预览 ${photo.name}`}>
                    <img src={photo.url} alt={photo.name} loading="lazy" />
                    <span className="expand"><Maximize2 size={16} /></span>
                  </button>
                  <div className="photo-meta">
                    <div>
                      <strong title={photo.name}>{photo.name}</strong>
                      <span>{formatSize(photo.size)} · {formatDate(photo.createdAt)}</span>
                    </div>
                    <a className="icon-button" href={`${photo.url}?attname=${encodeURIComponent(photo.name)}`} title="下载原图" aria-label={`下载 ${photo.name}`}>
                      <Download size={17} />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-visual">
                <span><ImageIcon size={28} /></span>
                <span><Images size={32} /></span>
                <span><ImageIcon size={25} /></span>
              </div>
              <h2>{selectedFolder ? "这个文件夹还是空的" : "还没有照片"}</h2>
              <p>{selectedFolder ? "添加第一批照片，影像会按时间自动排列。" : "新建一个文件夹，开始整理你的照片。"}</p>
              {(canUpload || isAdmin) && (
                <button className="primary-button" onClick={() => canUpload ? fileInput.current?.click() : setNewFolderOpen(true)}>
                  {canUpload ? <Upload size={18} /> : <Plus size={18} />}
                  {canUpload ? "上传照片" : "新建文件夹"}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {uploads.length > 0 && (
        <aside className="upload-panel" aria-live="polite">
          <div className="upload-panel-title">
            <strong>上传任务</strong>
            <button className="icon-button" onClick={() => setUploads((items) => items.filter((item) => item.status === "uploading"))} aria-label="清理已完成任务"><X size={16} /></button>
          </div>
          {uploads.slice(-4).map((item) => (
            <div className="upload-task" key={item.id}>
              <span className={`task-icon ${item.status}`}>
                {item.status === "uploading" ? <LoaderCircle className="spin" size={16} /> : item.status === "done" ? <Check size={16} /> : <X size={16} />}
              </span>
              <div>
                <strong>{item.name}</strong>
                <div className="task-progress"><span style={{ width: `${item.progress}%` }} /></div>
                {item.error && <small>{item.error}</small>}
              </div>
              <b>{item.status === "error" ? "失败" : `${item.progress}%`}</b>
            </div>
          ))}
        </aside>
      )}

      {newFolderOpen && (
        <div className="modal-backdrop" onMouseDown={() => setNewFolderOpen(false)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-folder-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon"><Folder size={20} /></span><h2 id="new-folder-title">新建文件夹</h2></div>
              <button className="icon-button" onClick={() => setNewFolderOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <label className="field-label" htmlFor="folder-name">文件夹名称</label>
            <input id="folder-name" className="text-input" autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createFolder(); }} placeholder="例如：2026 / 杭州旅行" />
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setNewFolderOpen(false)}>取消</button>
              <button className="primary-button" disabled={!newFolderName.trim() || creatingFolder} onClick={() => void createFolder()}>
                {creatingFolder ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} 创建
              </button>
            </div>
          </section>
        </div>
      )}

      {adminOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAdminOpen(false)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon"><KeyRound size={20} /></span><h2 id="admin-title">管理相册</h2></div>
              <button className="icon-button" onClick={() => setAdminOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <label className="field-label" htmlFor="admin-key">管理口令</label>
            <input id="admin-key" className="text-input" type="password" autoFocus value={adminInput} onChange={(event) => setAdminInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void unlockAdmin(); }} autoComplete="current-password" />
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setAdminOpen(false)}>取消</button>
              <button className="primary-button" disabled={!adminInput.trim() || verifyingAdmin} onClick={() => void unlockAdmin()}>
                {verifyingAdmin ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />} 进入管理
              </button>
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={preview.name}>
          <div className="preview-toolbar">
            <div>
              <strong>{preview.name}</strong>
              <span>{formatSize(preview.size)}{preview.width ? ` · ${preview.width} × ${preview.height}` : ""}</span>
            </div>
            <div>
              <button className="icon-button dark" onClick={() => navigator.clipboard.writeText(preview.url)} title="复制原图链接" aria-label="复制原图链接"><Clipboard size={18} /></button>
              <a className="icon-button dark" href={`${preview.url}?attname=${encodeURIComponent(preview.name)}`} title="下载原图" aria-label="下载原图"><Download size={18} /></a>
              <button className="icon-button dark" onClick={() => setPreview(null)} title="关闭" aria-label="关闭预览"><X size={20} /></button>
            </div>
          </div>
          <div className="preview-canvas" onClick={() => setPreview(null)}>
            <img src={preview.url} alt={preview.name} onClick={(event) => event.stopPropagation()} />
          </div>
        </div>
      )}
    </main>
  );
}
