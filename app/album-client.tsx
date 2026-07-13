"use client";

import {
  Activity,
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
  LockKeyhole,
  LockOpen,
  LoaderCircle,
  LogOut,
  Maximize2,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isVideoMimeType, mediaInfo, mediaSizeError } from "@/lib/media";
import type { PublicAlbumUser } from "@/lib/auth";
import type { AlbumAuditLog } from "@/lib/cloudbase";

const PUBLIC_ALBUM_ORIGIN = "https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com";
const LEGACY_ALBUM_HOST = "sanbing-4108035-1313194650.ap-shanghai.run.tcloudbase.com";

type FolderItem = {
  id: string;
  name: string;
  slug: string;
  photoCount: number;
  createdAt: string;
  locked: boolean;
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
  folderLocked: boolean;
};

type AdminSection = "users" | "logs";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
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

function formatFullDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function providerLabel(provider: PublicAlbumUser["provider"]): string {
  return provider === "wechat" ? "微信" : provider === "qq" ? "QQ" : "管理员";
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "登录相册",
  "auth.logout": "退出登录",
  "album.view": "访问相册",
  "media.view": "预览影像",
  "media.download": "下载影像",
  "media.upload": "上传影像",
  "media.rename": "重命名影像",
  "media.delete": "删除影像",
  "folder.create": "创建文件夹",
  "folder.unlock": "解锁文件夹",
  "folder.unlock.failed": "解锁失败",
  "folder.password.set": "加密文件夹",
  "folder.password.change": "更换文件夹密码",
  "folder.password.remove": "移除文件夹密码",
  "folder.share.create": "生成上传链接",
  "user.access.update": "修改用户权限",
  "admin.users.view": "查看用户管理",
  "admin.logs.view": "查看操作日志",
};

function downloadUrl(url: string, filename: string): string {
  const separator = url.includes("?") ? "&" : "?";
  const disposition = encodeURIComponent(`attachment; filename=${filename.replace(/[\r\n"\\]/g, "-")}`);
  return `${url}${separator}response-content-disposition=${disposition}`;
}

async function mediaDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  const mimeType = fileMimeType(file);
  if (isVideoMimeType(mimeType)) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("无法读取视频信息"));
        video.src = objectUrl;
      });
      return { width: video.videoWidth || null, height: video.videoHeight || null };
    } catch {
      return { width: null, height: null };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  if (!mimeType.startsWith("image/") || mimeType.includes("heic") || mimeType.includes("heif")) {
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
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    webm: "video/webm",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
  };
  return byExtension[extension || ""] || "application/octet-stream";
}

type DirectUploadResponse = {
  upload: {
    url: string;
    headers: Record<string, string>;
    ticket: string;
  };
};

async function uploadToCloudBase(
  folderSlug: string,
  uploadToken: string,
  file: File,
  dimensions: { width: number | null; height: number | null },
  onProgress: (progress: number) => void,
): Promise<void> {
  const authHeaders = {
    "content-type": "application/json",
  };
  const prepared = await readJson<DirectUploadResponse>(
    await fetch("/api/photos/upload", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        folderSlug,
        uploadToken,
        name: file.name,
        size: file.size,
        mimeType: fileMimeType(file),
        width: dimensions.width,
        height: dimensions.height,
      }),
    }),
  );
  onProgress(3);
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", prepared.upload.url);
    for (const [name, value] of Object.entries(prepared.upload.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(3 + Math.round((event.loaded / event.total) * 92));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`腾讯云存储上传失败 (${request.status})`));
    };
    request.onerror = () => reject(new Error("上传网络中断或云存储跨域校验失败"));
    request.send(file);
  });
  onProgress(96);
  await readJson<{ photo: PhotoItem }>(
    await fetch("/api/photos/upload", {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ ticket: prepared.upload.ticket, uploadToken }),
    }),
  );
}

function mediaLabel(photo: PhotoItem): "照片" | "视频" {
  return isVideoMimeType(photo.mimeType) ? "视频" : "照片";
}

export default function Home({ initialUser }: { initialUser: PublicAlbumUser }) {
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
  const [activeView, setActiveView] = useState<"album" | "admin">("album");
  const [adminSection, setAdminSection] = useState<AdminSection>("users");
  const [managedUsers, setManagedUsers] = useState<PublicAlbumUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AlbumAuditLog[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [sharedFolder, setSharedFolder] = useState("");
  const [sharedUploadToken, setSharedUploadToken] = useState("");
  const [editingPhoto, setEditingPhoto] = useState<PhotoItem | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingPhoto, setDeletingPhoto] = useState<PhotoItem | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [folderLocked, setFolderLocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockingFolder, setUnlockingFolder] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityPassword, setSecurityPassword] = useState("");
  const [savingSecurity, setSavingSecurity] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = initialUser.role === "admin";

  const adminHeaders = (contentType = false): Record<string, string> => ({
    ...(contentType ? { "content-type": "application/json" } : {}),
  });

  const loadLibrary = useCallback(async (folder = selectedFolder) => {
    setLoading(true);
    setError("");
    try {
      const query = folder ? `?folder=${encodeURIComponent(folder)}` : "";
      const data = await readJson<LibraryResponse>(await fetch(`/api/library${query}`));
      setFolders(data.folders);
      setPhotos(data.photos);
      setStorageConfigured(data.storageConfigured);
      setFolderLocked(data.folderLocked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取相册失败");
    } finally {
      setLoading(false);
    }
  }, [selectedFolder]);

  useEffect(() => {
    if (window.location.hostname === LEGACY_ALBUM_HOST) {
      window.location.replace(new URL(`${window.location.pathname}${window.location.search}${window.location.hash}`, PUBLIC_ALBUM_ORIGIN));
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("folder") || "";
    const uploadToken = params.get("upload") || "";
    const initialize = window.setTimeout(() => {
      const run = async () => {
        if (fromUrl) setSelectedFolder(fromUrl);
        if (fromUrl && uploadToken) {
          setSharedFolder(fromUrl);
          setSharedUploadToken(uploadToken);
        }
        await loadLibrary(fromUrl);
      };
      void run();
    }, 0);
    return () => window.clearTimeout(initialize);
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
    setActiveView("album");
    setPhotos([]);
    setPreview(null);
    setFolderLocked(false);
    setUnlockPassword("");
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
    const files = Array.from(fileList).filter((file) => Boolean(mediaInfo(file.name, fileMimeType(file))));
    if (!files.length) {
      setError("请选择 JPG、PNG、WebP、GIF、HEIC、MP4、MOV、M4V、WebM 或 MPEG 文件");
      return;
    }
    if (!selectedFolder) {
      setError("请先选择或新建一个文件夹");
      return;
    }
    if (!canUpload) {
      setError("这个链接没有上传权限，请使用管理口令或文件夹上传链接");
      return;
    }
    if (!storageConfigured) {
      setError("腾讯云存储尚未配置，暂时不能上传");
      return;
    }

    for (const file of files) {
      const uploadId = crypto.randomUUID();
      setUploads((current) => [
        ...current,
        { id: uploadId, name: file.name, progress: 0, status: "uploading" },
      ]);
      try {
        const media = mediaInfo(file.name, fileMimeType(file));
        if (!media) throw new Error("不支持这种文件格式");
        const sizeError = mediaSizeError(media.kind, file.size);
        if (sizeError) throw new Error(sizeError);
        const dimensions = await mediaDimensions(file);
        await uploadToCloudBase(
          selectedFolder,
          isAdmin ? "" : sharedUploadToken,
          file,
          dimensions,
          (progress) => updateUpload(uploadId, { progress }),
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

  const unlockFolder = async () => {
    if (!selectedFolder || !unlockPassword) return;
    setUnlockingFolder(true);
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch("/api/folders/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folderSlug: selectedFolder, password: unlockPassword }),
        }),
      );
      setUnlockPassword("");
      await loadLibrary(selectedFolder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解锁文件夹失败");
    } finally {
      setUnlockingFolder(false);
    }
  };

  const saveFolderPassword = async () => {
    if (!selectedFolder || securityPassword.length < 4) return;
    setSavingSecurity(true);
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch("/api/folders", {
          method: "PATCH",
          headers: adminHeaders(true),
          body: JSON.stringify({ folderSlug: selectedFolder, password: securityPassword }),
        }),
      );
      setSecurityPassword("");
      setSecurityOpen(false);
      await loadLibrary(selectedFolder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置文件夹密码失败");
    } finally {
      setSavingSecurity(false);
    }
  };

  const removeFolderPassword = async () => {
    if (!selectedFolder) return;
    setSavingSecurity(true);
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch(`/api/folders?folderSlug=${encodeURIComponent(selectedFolder)}`, {
          method: "DELETE",
          headers: adminHeaders(),
        }),
      );
      setSecurityPassword("");
      setSecurityOpen(false);
      await loadLibrary(selectedFolder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除文件夹密码失败");
    } finally {
      setSavingSecurity(false);
    }
  };

  const openRename = (photo: PhotoItem) => {
    setEditingPhoto(photo);
    setEditingName(photo.name);
  };

  const renamePhoto = async () => {
    const name = editingName.trim();
    if (!editingPhoto || !name) return;
    setSavingPhoto(true);
    setError("");
    try {
      const result = await readJson<{ photo: PhotoItem }>(
        await fetch("/api/photos", {
          method: "PATCH",
          headers: adminHeaders(true),
          body: JSON.stringify({ id: editingPhoto.id, name }),
        }),
      );
      setPhotos((current) => current.map((photo) => (photo.id === result.photo.id ? { ...photo, name: result.photo.name } : photo)));
      setPreview((current) => current?.id === result.photo.id ? { ...current, name: result.photo.name } : current);
      setEditingPhoto(null);
      setEditingName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重命名文件失败");
    } finally {
      setSavingPhoto(false);
    }
  };

  const deletePhoto = async () => {
    if (!deletingPhoto) return;
    setSavingPhoto(true);
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch(`/api/photos?id=${encodeURIComponent(deletingPhoto.id)}`, {
          method: "DELETE",
          headers: adminHeaders(),
        }),
      );
      const deletedId = deletingPhoto.id;
      setPhotos((current) => current.filter((photo) => photo.id !== deletedId));
      setFolders((current) => current.map((folder) => (
        folder.slug === deletingPhoto.folderSlug
          ? { ...folder, photoCount: Math.max(0, folder.photoCount - 1) }
          : folder
      )));
      setPreview((current) => current?.id === deletedId ? null : current);
      setDeletingPhoto(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除文件失败");
    } finally {
      setSavingPhoto(false);
    }
  };

  const logMediaAccess = (photo: PhotoItem, action: "media.view" | "media.download") => {
    void fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        resourceId: photo.id,
        resourceName: photo.name,
        folderSlug: photo.folderSlug,
      }),
      keepalive: true,
    });
  };

  const openPreview = (photo: PhotoItem) => {
    setPreview(photo);
    logMediaAccess(photo, "media.view");
  };

  const logout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    window.location.reload();
  };

  const loadAdminData = async (section: AdminSection = adminSection) => {
    if (!isAdmin) return;
    setAdminLoading(true);
    setError("");
    try {
      if (section === "users") {
        const result = await readJson<{ users: PublicAlbumUser[] }>(await fetch("/api/admin/users"));
        setManagedUsers(result.users);
      } else {
        const result = await readJson<{ logs: AlbumAuditLog[] }>(await fetch("/api/admin/audit-logs?limit=200"));
        setAuditLogs(result.logs);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取管理数据失败");
    } finally {
      setAdminLoading(false);
    }
  };

  const openAdminView = (section: AdminSection = "users") => {
    setActiveView("admin");
    setAdminSection(section);
    void loadAdminData(section);
  };

  const switchAdminSection = (section: AdminSection) => {
    setAdminSection(section);
    void loadAdminData(section);
  };

  const updateManagedUser = async (
    target: PublicAlbumUser,
    changes: Partial<Pick<PublicAlbumUser, "role" | "status">>,
  ) => {
    setError("");
    try {
      const result = await readJson<{ user: PublicAlbumUser }>(await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: target.id, ...changes }),
      }));
      setManagedUsers((users) => users.map((user) => user.id === result.user.id ? result.user : user));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新用户权限失败");
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><Images size={20} strokeWidth={2.2} /></div>
          <div>
            <strong>伞兵训练营的时光集</strong>
            <span>照片与视频影像集</span>
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
            <span>全部影像</span>
            <b>{totalPhotos}</b>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={`folder-row ${selectedFolder === folder.slug ? "active" : ""}`}
              onClick={() => chooseFolder(folder.slug)}
            >
              {folder.locked
                ? <LockKeyhole size={18} />
                : selectedFolder === folder.slug ? <FolderOpen size={18} /> : <Folder size={18} />}
              <span>{folder.name}</span>
              <b>{folder.locked ? <LockKeyhole size={13} aria-label="已加密" /> : folder.photoCount}</b>
            </button>
          ))}
          {isAdmin && (
            <button className={`folder-row admin-nav-row ${activeView === "admin" ? "active" : ""}`} onClick={() => openAdminView("users")}>
              <Users size={18} />
              <span>用户与日志</span>
              <ShieldCheck size={14} />
            </button>
          )}
        </nav>

        <div className="signed-user">
          <span className="user-avatar">
            {initialUser.avatarUrl ? <img src={initialUser.avatarUrl} alt="" /> : <UserRound size={18} />}
          </span>
          <span className="user-copy">
            <strong>{initialUser.displayName}</strong>
            <small>{providerLabel(initialUser.provider)} · {isAdmin ? "管理员" : "成员"}</small>
          </span>
          <button className="icon-button inverse" onClick={() => void logout()} title="退出登录" aria-label="退出登录"><LogOut size={16} /></button>
        </div>

        <div className="storage-meter">
          <div className="storage-line">
            <span><HardDrive size={15} /> 腾讯云 CloudBase</span>
            <i className={storageConfigured ? "online" : "offline"} />
          </div>
          <div className="meter-track"><span style={{ width: `${Math.min(100, (totalPhotos / 3000) * 100)}%` }} /></div>
          <small>云存储与 CDN 加速</small>
        </div>
      </aside>

      {activeView === "album" ? (
      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>相册</span><ChevronRight size={15} />
            <strong>{activeFolder?.name || "全部影像"}</strong>
          </div>
          <div className="top-actions">
            <label className="search-box">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索照片或视频" />
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
            {selectedFolder && isAdmin && (
              <button
                className="secondary-button"
                onClick={() => { setSecurityPassword(""); setSecurityOpen(true); }}
              >
                <LockKeyhole size={17} />
                {activeFolder?.locked ? "更换密码" : "设置密码"}
              </button>
            )}
            <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={!canUpload} title={canUpload ? "上传照片或视频" : "需要上传权限"}>
              <Upload size={18} /> 上传影像
            </button>
            <input ref={fileInput} type="file" accept="image/*,video/mp4,video/quicktime,video/x-m4v,video/webm,video/mpeg,.mov,.m4v" multiple hidden onChange={onFileChange} />
          </div>
        </header>

        <div className="content">
          {!storageConfigured && (
            <div className="notice" role="status">
              <HardDrive size={18} />
              <span><strong>等待接入腾讯云存储</strong> 配置完成后即可在线上传与查看照片和视频。</span>
            </div>
          )}
          {sharedUploadToken && sharedFolder === selectedFolder && !isAdmin && (
            <div className="share-notice" role="status">
              <Share2 size={17} />
              <span>你可以向「{activeFolder?.name || "当前文件夹"}」上传照片或视频</span>
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
              <h1>{activeFolder?.name || "全部影像"}</h1>
              <p>{folderLocked ? "需要密码访问" : `${visiblePhotos.length} 项影像`}</p>
            </div>
            {!folderLocked && <div className="view-toggle" aria-label="视图切换">
              <button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title="网格视图" aria-label="网格视图"><Grid2X2 size={17} /></button>
              <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="列表视图" aria-label="列表视图"><LayoutList size={18} /></button>
            </div>}
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
              <small>图片最大 50 MB · 视频最大 500 MB</small>
            </div>
          )}

          {loading ? (
            <div className="loading-state"><LoaderCircle className="spin" size={25} /> 正在读取影像</div>
          ) : folderLocked ? (
            <section className="locked-state" aria-labelledby="locked-folder-title">
              <span className="lock-visual"><LockKeyhole size={30} /></span>
              <h2 id="locked-folder-title">这个文件夹已加密</h2>
              <p>输入密码后即可查看和下载其中的照片与视频。</p>
              <form className="unlock-form" onSubmit={(event) => { event.preventDefault(); void unlockFolder(); }}>
                <input
                  className="text-input"
                  type="password"
                  value={unlockPassword}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="文件夹密码"
                  aria-label="文件夹密码"
                  autoFocus
                />
                <button className="primary-button" type="submit" disabled={!unlockPassword || unlockingFolder}>
                  {unlockingFolder ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
                  解锁
                </button>
              </form>
            </section>
          ) : visiblePhotos.length ? (
            <div className={viewMode === "grid" ? "photo-grid" : "photo-list"}>
              {visiblePhotos.map((photo) => (
                <article className="photo-card" key={photo.id}>
                  <button className="photo-preview" onClick={() => openPreview(photo)} aria-label={`预览 ${photo.name}`}>
                    {isVideoMimeType(photo.mimeType)
                      ? <video src={photo.url} muted playsInline preload="metadata" aria-label={photo.name} />
                      : <img src={photo.url} alt={photo.name} loading="lazy" />}
                    {isVideoMimeType(photo.mimeType) && <span className="play-badge"><Play size={19} fill="currentColor" /></span>}
                    <span className="expand"><Maximize2 size={16} /></span>
                  </button>
                  <div className="photo-meta">
                    <div>
                      <strong title={photo.name}>{photo.name}</strong>
                      <span>{formatSize(photo.size)} · {formatDate(photo.createdAt)}</span>
                    </div>
                    <div className="photo-actions">
                      {isAdmin && (
                        <>
                          <button className="icon-button" onClick={() => openRename(photo)} title="重命名" aria-label={`重命名 ${photo.name}`}><Pencil size={16} /></button>
                          <button className="icon-button danger" onClick={() => setDeletingPhoto(photo)} title={`删除${mediaLabel(photo)}`} aria-label={`删除 ${photo.name}`}><Trash2 size={16} /></button>
                        </>
                      )}
                      <a className="icon-button" href={downloadUrl(photo.url, photo.name)} onClick={() => logMediaAccess(photo, "media.download")} title="下载原文件" aria-label={`下载 ${photo.name}`}>
                        <Download size={17} />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-visual">
                <span><Video size={28} /></span>
                <span><Images size={32} /></span>
                <span><ImageIcon size={25} /></span>
              </div>
              <h2>{selectedFolder ? "这个文件夹还是空的" : "还没有影像"}</h2>
              <p>{selectedFolder ? "添加第一批照片或视频，影像会按时间自动排列。" : "新建一个文件夹，开始整理你的照片与视频。"}</p>
              {(canUpload || isAdmin) && (
                <button className="primary-button" onClick={() => canUpload ? fileInput.current?.click() : setNewFolderOpen(true)}>
                  {canUpload ? <Upload size={18} /> : <Plus size={18} />}
                  {canUpload ? "上传影像" : "新建文件夹"}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      ) : (
        <section className="workspace admin-workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <span>管理</span><ChevronRight size={15} />
              <strong>{adminSection === "users" ? "用户管理" : "访问与操作日志"}</strong>
            </div>
            <div className="top-actions">
              <button className="secondary-button" onClick={() => void loadAdminData()} disabled={adminLoading}>
                {adminLoading ? <LoaderCircle className="spin" size={17} /> : <Activity size={17} />}
                刷新
              </button>
              <button className="secondary-button" onClick={() => setActiveView("album")}>
                <Images size={17} /> 返回相册
              </button>
            </div>
          </header>
          <div className="content admin-content">
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button className="icon-button" onClick={() => setError("")} aria-label="关闭"><X size={16} /></button>
              </div>
            )}
            <div className="admin-page-heading">
              <div>
                <h1>相册管理</h1>
                <p>成员身份、访问状态和审计记录仅对管理员可见。</p>
              </div>
              <div className="admin-tabs" role="tablist" aria-label="管理视图">
                <button className={adminSection === "users" ? "active" : ""} onClick={() => switchAdminSection("users")} role="tab">
                  <Users size={17} /> 用户
                </button>
                <button className={adminSection === "logs" ? "active" : ""} onClick={() => switchAdminSection("logs")} role="tab">
                  <Activity size={17} /> 日志
                </button>
              </div>
            </div>

            {adminLoading ? (
              <div className="loading-state"><LoaderCircle className="spin" size={25} /> 正在读取管理数据</div>
            ) : adminSection === "users" ? (
              <div className="management-table" role="table" aria-label="用户管理">
                <div className="management-row management-header" role="row">
                  <span>用户</span><span>登录来源</span><span>最后登录</span><span>角色</span><span>状态</span>
                </div>
                {managedUsers.map((user) => (
                  <div className="management-row user-row" role="row" key={user.id}>
                    <div className="managed-user">
                      <span className="managed-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <UserRound size={18} />}</span>
                      <span><strong>{user.displayName}</strong><small>{user.accountLabel}</small></span>
                    </div>
                    <span className={`provider-tag ${user.provider}`}>{providerLabel(user.provider)}</span>
                    <span className="table-date">{formatFullDate(user.lastLoginAt)}</span>
                    <select
                      value={user.role}
                      disabled={user.id === initialUser.id}
                      onChange={(event) => void updateManagedUser(user, { role: event.target.value as PublicAlbumUser["role"] })}
                      aria-label={`${user.displayName}的角色`}
                    >
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                    <label className="status-toggle">
                      <input
                        type="checkbox"
                        checked={user.status === "active"}
                        disabled={user.id === initialUser.id}
                        onChange={(event) => void updateManagedUser(user, { status: event.target.checked ? "active" : "disabled" })}
                      />
                      <span>{user.status === "active" ? "已启用" : "已停用"}</span>
                    </label>
                  </div>
                ))}
                {!managedUsers.length && <div className="table-empty">还没有用户记录</div>}
              </div>
            ) : (
              <div className="management-table audit-table" role="table" aria-label="访问与操作日志">
                <div className="management-row audit-row management-header" role="row">
                  <span>时间</span><span>用户</span><span>操作</span><span>对象</span><span>访问摘要</span>
                </div>
                {auditLogs.map((log) => (
                  <div className="management-row audit-row" role="row" key={log.id}>
                    <span className="table-date">{formatFullDate(log.createdAt)}</span>
                    <span className="audit-user"><strong>{log.userName}</strong><small>{providerLabel(log.provider)}</small></span>
                    <span className="action-tag">{ACTION_LABELS[log.action] || log.action}</span>
                    <span className="resource-cell"><strong>{log.resourceName || log.resourceType}</strong><small>{log.path}</small></span>
                    <span className="audit-fingerprint" title={log.userAgent}>{log.ipHash}</span>
                  </div>
                ))}
                {!auditLogs.length && <div className="table-empty">还没有审计记录</div>}
              </div>
            )}
          </div>
        </section>
      )}

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

      {securityOpen && activeFolder && (
        <div className="modal-backdrop" onMouseDown={() => !savingSecurity && setSecurityOpen(false)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="folder-security-title">
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><LockKeyhole size={19} /></span>
                <h2 id="folder-security-title">{activeFolder.locked ? "更换文件夹密码" : "设置文件夹密码"}</h2>
              </div>
              <button className="icon-button" disabled={savingSecurity} onClick={() => setSecurityOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message security-message">
              加锁后，文件夹中的照片和视频不会出现在全部影像中，访问该文件夹需要输入密码。
            </p>
            <label className="field-label" htmlFor="folder-password">{activeFolder.locked ? "新密码" : "文件夹密码"}</label>
            <input
              id="folder-password"
              className="text-input"
              type="password"
              minLength={4}
              maxLength={128}
              autoFocus
              autoComplete="new-password"
              value={securityPassword}
              onChange={(event) => setSecurityPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void saveFolderPassword(); }}
              placeholder="至少 4 个字符"
            />
            <div className="dialog-actions security-actions">
              {activeFolder.locked && (
                <button className="secondary-button remove-lock-button" disabled={savingSecurity} onClick={() => void removeFolderPassword()}>
                  <LockOpen size={17} /> 移除密码
                </button>
              )}
              <button className="secondary-button" disabled={savingSecurity} onClick={() => setSecurityOpen(false)}>取消</button>
              <button className="primary-button" disabled={securityPassword.length < 4 || savingSecurity} onClick={() => void saveFolderPassword()}>
                {savingSecurity ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
                {activeFolder.locked ? "更换密码" : "加密文件夹"}
              </button>
            </div>
          </section>
        </div>
      )}

      {editingPhoto && (
        <div className="modal-backdrop" onMouseDown={() => !savingPhoto && setEditingPhoto(null)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rename-photo-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon"><Pencil size={19} /></span><h2 id="rename-photo-title">重命名{mediaLabel(editingPhoto)}</h2></div>
              <button className="icon-button" disabled={savingPhoto} onClick={() => setEditingPhoto(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <label className="field-label" htmlFor="photo-name">文件名称</label>
            <input id="photo-name" className="text-input" autoFocus maxLength={180} value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renamePhoto(); }} />
            <div className="dialog-actions">
              <button className="secondary-button" disabled={savingPhoto} onClick={() => setEditingPhoto(null)}>取消</button>
              <button className="primary-button" disabled={!editingName.trim() || savingPhoto} onClick={() => void renamePhoto()}>
                {savingPhoto ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} 保存
              </button>
            </div>
          </section>
        </div>
      )}

      {deletingPhoto && (
        <div className="modal-backdrop" onMouseDown={() => !savingPhoto && setDeletingPhoto(null)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-photo-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon danger"><Trash2 size={19} /></span><h2 id="delete-photo-title">删除{mediaLabel(deletingPhoto)}</h2></div>
              <button className="icon-button" disabled={savingPhoto} onClick={() => setDeletingPhoto(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message">确定删除「{deletingPhoto.name}」吗？原文件和相册记录都会被永久删除，无法恢复。</p>
            <div className="dialog-actions">
              <button className="secondary-button" disabled={savingPhoto} onClick={() => setDeletingPhoto(null)}>取消</button>
              <button className="danger-button" disabled={savingPhoto} onClick={() => void deletePhoto()}>
                {savingPhoto ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} 删除
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
              {isAdmin && (
                <>
                  <button className="icon-button dark" onClick={() => openRename(preview)} title="重命名" aria-label={`重命名${mediaLabel(preview)}`}><Pencil size={17} /></button>
                  <button className="icon-button dark danger" onClick={() => setDeletingPhoto(preview)} title={`删除${mediaLabel(preview)}`} aria-label={`删除${mediaLabel(preview)}`}><Trash2 size={17} /></button>
                </>
              )}
              <button className="icon-button dark" onClick={() => navigator.clipboard.writeText(preview.url)} title="复制文件链接" aria-label="复制文件链接"><Clipboard size={18} /></button>
              <a className="icon-button dark" href={downloadUrl(preview.url, preview.name)} onClick={() => logMediaAccess(preview, "media.download")} title="下载原文件" aria-label="下载原文件"><Download size={18} /></a>
              <button className="icon-button dark" onClick={() => setPreview(null)} title="关闭" aria-label="关闭预览"><X size={20} /></button>
            </div>
          </div>
          <div className="preview-canvas" onClick={() => setPreview(null)}>
            {isVideoMimeType(preview.mimeType)
              ? <video src={preview.url} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} />
              : <img src={preview.url} alt={preview.name} onClick={(event) => event.stopPropagation()} />}
          </div>
        </div>
      )}
    </main>
  );
}
