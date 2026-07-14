"use client";

import {
  Activity,
  Check,
  ChevronRight,
  Clipboard,
  Crown,
  Download,
  Folder,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  Images,
  LayoutList,
  Link2,
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
import NextImage from "next/image";
import { isVideoMimeType, mediaInfo, mediaSizeError } from "@/lib/media";
import type { PublicAlbumUser } from "@/lib/auth";
import type { AlbumAuditLog, AlbumUserPermissions, FolderVisibilityType } from "@/lib/cloudbase";

const PUBLIC_ALBUM_ORIGIN = "https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com";
const LEGACY_ALBUM_HOST = "sanbing-4108035-1313194650.ap-shanghai.run.tcloudbase.com";
const MAX_BATCH_SELECTION = 100;
const WEB_PAGE_SIZE = 48;

type FolderItem = {
  id: string;
  name: string;
  slug: string;
  photoCount: number;
  createdAt: string;
  creatorUserId: string;
  visibilityType: FolderVisibilityType;
  visibleUserIds: string[];
  canManageVisibility: boolean;
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
  deletedAt?: string;
  purgeAt?: string;
  lastAction?: "upload" | "rename" | "move" | "recycle" | "restore";
  lastActionBy?: string;
  lastActionAt?: string;
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
  total: number;
  nextOffset: number;
  hasMore: boolean;
  storageConfigured: boolean;
  recycleCount: number;
  recycleBin: boolean;
};

type AdminSection = "users" | "logs";
type ManagedAlbumUser = Pick<PublicAlbumUser, "id" | "accountLabel" | "displayName" | "title" | "avatarUrl">
  & Partial<Pick<PublicAlbumUser, "provider" | "role" | "permissions" | "status" | "createdAt" | "lastLoginAt">>;

const PERMISSION_OPTIONS: Array<{ key: keyof AlbumUserPermissions; label: string }> = [
  { key: "read", label: "访问" },
  { key: "upload", label: "上传" },
  { key: "edit", label: "编辑" },
  { key: "delete", label: "删除" },
  { key: "manageFolders", label: "文件夹" },
  { key: "assignTitles", label: "赋予称号" },
];

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
  return provider === "local" ? "站内账号" : "管理员口令";
}

function permissionSummary(permissions: AlbumUserPermissions): string {
  if (permissions.manageFolders) return "文件夹管理者";
  if (permissions.upload) return "可上传用户";
  if (permissions.read) return "访问用户";
  return "暂无访问权限";
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "登录相册",
  "auth.register": "注册账号",
  "auth.logout": "退出登录",
  "album.view": "访问相册",
  "media.view": "预览影像",
  "media.download": "下载影像",
  "media.share": "转发影像",
  "media.upload": "上传影像",
  "media.rename": "重命名影像",
  "media.delete": "删除影像",
  "media.move.batch": "批量移动影像",
  "media.recycle": "移入回收站",
  "media.recycle.batch": "批量移入回收站",
  "media.restore.batch": "批量恢复影像",
  "media.purge.batch": "永久删除影像",
  "recycle.view": "查看回收站",
  "folder.create": "创建文件夹",
  "folder.delete": "删除文件夹",
  "folder.visibility.update": "修改可见范围",
  "folder.share.create": "生成上传链接",
  "user.access.update": "修改用户权限",
  "admin.users.view": "查看用户管理",
  "admin.logs.view": "查看操作日志",
};

const VISIBILITY_OPTIONS: Array<{
  type: FolderVisibilityType;
  title: string;
  description: string;
}> = [
  { type: "all", title: "所有人可见", description: "任何已注册用户都能看到" },
  { type: "admins", title: "管理者可见", description: "只对拥有文件夹管理权限的人展示" },
  { type: "specific", title: "某些人可见", description: "仅向勾选的用户展示" },
];

function visibilityLabel(type: FolderVisibilityType): string {
  if (type === "admins") return "管理者可见";
  if (type === "specific") return "指定用户可见";
  return "所有人可见";
}

function VisibilityFields({
  visibilityType,
  selectedUserIds,
  users,
  requiredUserId,
  disabled,
  onVisibilityTypeChange,
  onSelectedUserIdsChange,
}: {
  visibilityType: FolderVisibilityType;
  selectedUserIds: string[];
  users: PublicAlbumUser[];
  requiredUserId: string;
  disabled: boolean;
  onVisibilityTypeChange: (type: FolderVisibilityType) => void;
  onSelectedUserIdsChange: (ids: string[]) => void;
}) {
  const chooseType = (type: FolderVisibilityType) => {
    onVisibilityTypeChange(type);
    if (type === "specific" && requiredUserId && !selectedUserIds.includes(requiredUserId)) {
      onSelectedUserIdsChange([...selectedUserIds, requiredUserId]);
    }
  };
  const toggleUser = (userId: string) => {
    if (userId === requiredUserId) return;
    onSelectedUserIdsChange(selectedUserIds.includes(userId)
      ? selectedUserIds.filter((id) => id !== userId)
      : [...selectedUserIds, userId]);
  };
  return (
    <div className="visibility-editor">
      <span className="field-label">可见范围</span>
      <div className="visibility-options" role="radiogroup" aria-label="文件夹可见范围">
        {VISIBILITY_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            className={visibilityType === option.type ? "active" : ""}
            role="radio"
            aria-checked={visibilityType === option.type}
            disabled={disabled}
            onClick={() => chooseType(option.type)}
          >
            <strong>{option.title}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      {visibilityType === "specific" && (
        <div className="visibility-users" aria-label="选择可见用户">
          {users.map((user) => (
            <label key={user.id}>
              <input
                type="checkbox"
                checked={selectedUserIds.includes(user.id)}
                disabled={disabled || user.id === requiredUserId}
                onChange={() => toggleUser(user.id)}
              />
              <span><strong>{user.displayName}</strong><small>{user.accountLabel}</small></span>
              <b>{permissionSummary(user.permissions)}</b>
            </label>
          ))}
          {!users.length && <p>正在读取用户列表...</p>}
        </div>
      )}
    </div>
  );
}

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

function operationLabel(photo: PhotoItem): string {
  const labels: Record<NonNullable<PhotoItem["lastAction"]>, string> = {
    upload: "上传",
    rename: "重命名",
    move: "移动",
    recycle: "移入回收站",
    restore: "恢复",
  };
  if (!photo.lastActionBy) return "历史影像";
  return `${photo.lastActionBy} ${photo.lastAction ? labels[photo.lastAction] : "操作"}`;
}

export default function Home({ initialUser }: { initialUser: PublicAlbumUser }) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [recycleCount, setRecycleCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [dragging, setDragging] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderVisibility, setNewFolderVisibility] = useState<FolderVisibilityType>("admins");
  const [newFolderVisibleUserIds, setNewFolderVisibleUserIds] = useState<string[]>([initialUser.id]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [preview, setPreview] = useState<PhotoItem | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedUpload, setCopiedUpload] = useState(false);
  const [activeView, setActiveView] = useState<"album" | "admin">("album");
  const [adminSection, setAdminSection] = useState<AdminSection>("users");
  const [managedUsers, setManagedUsers] = useState<ManagedAlbumUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AlbumAuditLog[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [sharedFolder, setSharedFolder] = useState("");
  const [sharedUploadToken, setSharedUploadToken] = useState("");
  const [editingFolder, setEditingFolder] = useState<FolderItem | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [savingFolderName, setSavingFolderName] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<FolderItem | null>(null);
  const [savingFolderDelete, setSavingFolderDelete] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<PhotoItem | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingPhoto, setDeletingPhoto] = useState<PhotoItem | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchTargetFolder, setBatchTargetFolder] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);
  const [visibilityUsers, setVisibilityUsers] = useState<PublicAlbumUser[]>([]);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [folderVisibility, setFolderVisibility] = useState<FolderVisibilityType>("admins");
  const [folderVisibleUserIds, setFolderVisibleUserIds] = useState<string[]>([]);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const libraryRequestId = useRef(0);
  const isSuperAdmin = initialUser.accountLabel === "alishan-tea";
  const canDirectUpload = initialUser.permissions.upload;
  const canEditMedia = initialUser.permissions.edit;
  const canDeleteMedia = initialUser.permissions.delete;
  const canManageFolders = initialUser.permissions.manageFolders;
  const canAssignTitles = initialUser.permissions.assignTitles;
  const canOpenPeople = isSuperAdmin || canAssignTitles;
  const canBatchEdit = canEditMedia || canDeleteMedia;

  const adminHeaders = (contentType = false): Record<string, string> => ({
    ...(contentType ? { "content-type": "application/json" } : {}),
  });

  const loadLibrary = useCallback(async (folder = selectedFolder, recycleBin = false, append = false) => {
    if (append && (!hasMore || loadingMore)) return;
    const requestId = ++libraryRequestId.current;
    const offset = append ? nextOffset : 0;
    setLoading(!append);
    setLoadingMore(append);
    setError("");
    try {
      const query = new URLSearchParams({ limit: String(WEB_PAGE_SIZE), offset: String(offset) });
      if (recycleBin) query.set("recycle", "1");
      else if (folder) query.set("folder", folder);
      const data = await readJson<LibraryResponse>(await fetch(`/api/library?${query}`));
      if (requestId !== libraryRequestId.current) return;
      setFolders(data.folders);
      setPhotos((current) => {
        if (!append) return data.photos;
        const seen = new Set(current.map((photo) => photo.id));
        return [...current, ...data.photos.filter((photo) => !seen.has(photo.id))];
      });
      setTotal(Number(data.total) || 0);
      setNextOffset(Number(data.nextOffset) || 0);
      setHasMore(Boolean(data.hasMore));
      setStorageConfigured(data.storageConfigured);
      setRecycleCount(data.recycleCount || 0);
    } catch (cause) {
      if (requestId !== libraryRequestId.current) return;
      setError(cause instanceof Error ? cause.message : "读取相册失败");
    } finally {
      if (requestId === libraryRequestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [hasMore, loadingMore, nextOffset, selectedFolder]);

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
  const selectedPhotoSet = useMemo(() => new Set(selectedPhotoIds), [selectedPhotoIds]);
  const selectableVisiblePhotos = visiblePhotos.slice(0, MAX_BATCH_SELECTION);
  const allVisibleSelected = selectableVisiblePhotos.length > 0 && selectableVisiblePhotos.every((photo) => selectedPhotoSet.has(photo.id));
  const moveTargets = useMemo(
    () => showRecycleBin ? [] : selectedFolder ? folders.filter((folder) => folder.slug !== selectedFolder) : folders,
    [folders, selectedFolder, showRecycleBin],
  );
  const canUpload = Boolean(
    !showRecycleBin && selectedFolder && (canDirectUpload || (sharedUploadToken && sharedFolder === selectedFolder)),
  );

  const chooseFolder = (slug: string) => {
    setActiveView("album");
    setShowRecycleBin(false);
    setPhotos([]);
    setPreview(null);
    setEditMode(false);
    setSelectedPhotoIds([]);
    setBatchMoveOpen(false);
    setBatchDeleteOpen(false);
    setSelectedFolder(slug);
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set("folder", slug);
    else url.searchParams.delete("folder");
    window.history.replaceState({}, "", url);
    void loadLibrary(slug, false);
  };

  const chooseRecycleBin = () => {
    setActiveView("album");
    setShowRecycleBin(true);
    setSelectedFolder("");
    setPhotos([]);
    setPreview(null);
    setEditMode(false);
    setSelectedPhotoIds([]);
    setBatchMoveOpen(false);
    setBatchDeleteOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("folder");
    window.history.replaceState({}, "", url);
    void loadLibrary("", true);
  };

  const loadVisibilityUsers = async (folderSlug = "") => {
    if (visibilityUsers.length) return visibilityUsers;
    const query = folderSlug ? `?folder=${encodeURIComponent(folderSlug)}` : "";
    const result = await readJson<{ users: PublicAlbumUser[] }>(await fetch(`/api/users/options${query}`));
    setVisibilityUsers(result.users);
    return result.users;
  };

  const openNewFolder = () => {
    setNewFolderName("");
    setNewFolderVisibility("admins");
    setNewFolderVisibleUserIds([initialUser.id]);
    setNewFolderOpen(true);
    void loadVisibilityUsers().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "读取用户列表失败");
    });
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
          body: JSON.stringify({
            name: newFolderName,
            visibilityType: newFolderVisibility,
            visibleUserIds: newFolderVisibleUserIds,
          }),
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
          canDirectUpload ? "" : sharedUploadToken,
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
    if (!selectedFolder || !canManageFolders) return;
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

  const openFolderVisibility = () => {
    if (!activeFolder?.canManageVisibility) return;
    setFolderVisibility(activeFolder.visibilityType);
    setFolderVisibleUserIds(activeFolder.visibleUserIds);
    setVisibilityOpen(true);
    void loadVisibilityUsers(activeFolder.slug).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "读取用户列表失败");
    });
  };

  const saveFolderVisibility = async () => {
    if (!selectedFolder || !activeFolder?.canManageVisibility) return;
    setSavingVisibility(true);
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch("/api/folders", {
          method: "PATCH",
          headers: adminHeaders(true),
          body: JSON.stringify({
            folderSlug: selectedFolder,
            visibilityType: folderVisibility,
            visibleUserIds: folderVisibleUserIds,
          }),
        }),
      );
      setVisibilityOpen(false);
      await loadLibrary(selectedFolder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置文件夹可见范围失败");
    } finally {
      setSavingVisibility(false);
    }
  };

  const openFolderRename = () => {
    if (!activeFolder || !canManageFolders) return;
    setEditingFolder(activeFolder);
    setEditingFolderName(activeFolder.name);
  };

  const renameFolder = async () => {
    const name = editingFolderName.trim();
    if (!editingFolder || !name || !canManageFolders) return;
    setSavingFolderName(true);
    setError("");
    try {
      const result = await readJson<{ folder: FolderItem }>(
        await fetch("/api/folders/name", {
          method: "PATCH",
          headers: adminHeaders(true),
          body: JSON.stringify({ folderSlug: editingFolder.slug, name }),
        }),
      );
      setFolders((current) => current.map((folder) => (
        folder.slug === result.folder.slug ? { ...folder, name: result.folder.name } : folder
      )));
      setEditingFolder(null);
      setEditingFolderName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重命名文件夹失败");
    } finally {
      setSavingFolderName(false);
    }
  };

  const deleteFolder = async () => {
    if (!deletingFolder || !canManageFolders) return;
    setSavingFolderDelete(true);
    setError("");
    try {
      await readJson<{ ok: boolean }>(
        await fetch(`/api/folders?folder=${encodeURIComponent(deletingFolder.slug)}`, {
          method: "DELETE",
          headers: adminHeaders(),
        }),
      );
      setDeletingFolder(null);
      setSelectedFolder("");
      setPhotos([]);
      const url = new URL(window.location.href);
      url.searchParams.delete("folder");
      url.searchParams.delete("upload");
      window.history.replaceState({}, "", url);
      await loadLibrary("", false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除文件夹失败");
      setDeletingFolder(null);
    } finally {
      setSavingFolderDelete(false);
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
      setPhotos((current) => current.map((photo) => (photo.id === result.photo.id ? { ...photo, ...result.photo } : photo)));
      setPreview((current) => current?.id === result.photo.id ? { ...current, ...result.photo } : current);
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
      setPreview((current) => current?.id === deletedId ? null : current);
      setDeletingPhoto(null);
      await loadLibrary(selectedFolder);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移入回收站失败");
    } finally {
      setSavingPhoto(false);
    }
  };

  const leaveEditMode = (force = false) => {
    if (batchSaving && !force) return;
    setEditMode(false);
    setSelectedPhotoIds([]);
    setBatchMoveOpen(false);
    setBatchDeleteOpen(false);
    setBatchTargetFolder("");
  };

  const togglePhotoSelection = (photoId: string) => {
    if (!selectedPhotoSet.has(photoId) && selectedPhotoIds.length >= MAX_BATCH_SELECTION) {
      setError(`单次最多选择 ${MAX_BATCH_SELECTION} 项影像`);
      return;
    }
    setSelectedPhotoIds((current) => current.includes(photoId)
      ? current.filter((id) => id !== photoId)
      : [...current, photoId]);
  };

  const toggleAllVisible = () => {
    const visibleIds = new Set(selectableVisiblePhotos.map((photo) => photo.id));
    setSelectedPhotoIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.has(id))
      : [...new Set([...current, ...visibleIds])].slice(0, MAX_BATCH_SELECTION));
    if (!allVisibleSelected && visiblePhotos.length > MAX_BATCH_SELECTION) {
      setError(`已选择当前结果中的前 ${MAX_BATCH_SELECTION} 项`);
    }
  };

  const openBatchMove = () => {
    if (!selectedPhotoIds.length || !moveTargets.length) return;
    setBatchTargetFolder(moveTargets[0].slug);
    setBatchMoveOpen(true);
  };

  const moveSelectedPhotos = async () => {
    if (!selectedPhotoIds.length || !batchTargetFolder || batchSaving) return;
    setBatchSaving(true);
    setError("");
    try {
      const result = await readJson<{ movedCount: number; skippedCount: number }>(await fetch("/api/photos/batch", {
        method: "PATCH",
        headers: adminHeaders(true),
        body: JSON.stringify({ ids: selectedPhotoIds, targetFolderSlug: batchTargetFolder }),
      }));
      await loadLibrary(selectedFolder);
      leaveEditMode(true);
      if (!result.movedCount && result.skippedCount) setError("所选影像已经位于目标文件夹");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量移动影像失败");
    } finally {
      setBatchSaving(false);
    }
  };

  const deleteSelectedPhotos = async () => {
    if (!selectedPhotoIds.length || batchSaving) return;
    setBatchSaving(true);
    setError("");
    try {
      await readJson<{ recycledCount: number }>(await fetch("/api/photos/batch", {
        method: "DELETE",
        headers: adminHeaders(true),
        body: JSON.stringify({ ids: selectedPhotoIds }),
      }));
      await loadLibrary(selectedFolder);
      leaveEditMode(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量移入回收站失败");
    } finally {
      setBatchSaving(false);
    }
  };

  const restoreSelectedPhotos = async () => {
    if (!selectedPhotoIds.length || batchSaving) return;
    setBatchSaving(true);
    setError("");
    try {
      await readJson<{ restoredCount: number }>(await fetch("/api/photos/recycle", {
        method: "PATCH",
        headers: adminHeaders(true),
        body: JSON.stringify({ ids: selectedPhotoIds }),
      }));
      await loadLibrary("", true);
      leaveEditMode(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "批量恢复影像失败");
    } finally {
      setBatchSaving(false);
    }
  };

  const purgeSelectedPhotos = async () => {
    if (!selectedPhotoIds.length || batchSaving) return;
    setBatchSaving(true);
    setError("");
    try {
      await readJson<{ purgedCount: number }>(await fetch("/api/photos/recycle", {
        method: "DELETE",
        headers: adminHeaders(true),
        body: JSON.stringify({ ids: selectedPhotoIds }),
      }));
      await loadLibrary("", true);
      leaveEditMode(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "永久删除影像失败");
    } finally {
      setBatchSaving(false);
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
    if (section === "users" && !canOpenPeople) return;
    if (section === "logs" && !isSuperAdmin) return;
    setAdminLoading(true);
    setError("");
    try {
      if (section === "users") {
        const result = await readJson<{ users: ManagedAlbumUser[] }>(await fetch("/api/admin/users"));
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
    const nextSection = section === "logs" && !isSuperAdmin ? "users" : section;
    setActiveView("admin");
    setAdminSection(nextSection);
    void loadAdminData(nextSection);
  };

  const switchAdminSection = (section: AdminSection) => {
    if (section === "logs" && !isSuperAdmin) return;
    setAdminSection(section);
    void loadAdminData(section);
  };

  const updateManagedUser = async (
    target: ManagedAlbumUser,
    changes: { permissions?: AlbumUserPermissions; status?: PublicAlbumUser["status"]; title?: string },
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

  const toggleManagedPermission = (target: ManagedAlbumUser, key: keyof AlbumUserPermissions, checked: boolean) => {
    if (!isSuperAdmin || !target.permissions || target.accountLabel === "alishan-tea") return;
    void updateManagedUser(target, { permissions: { ...target.permissions, [key]: checked } });
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><NextImage src="/logo.png" alt="" width={42} height={42} priority /></div>
          <div>
            <strong>伞兵训练营的时光集</strong>
            <span>照片与视频影像集</span>
          </div>
        </div>

        <nav className="folder-nav" aria-label="相册文件夹">
          <div className="nav-heading">
            <span>文件夹</span>
            {canManageFolders && (
              <button className="icon-button inverse" onClick={openNewFolder} title="新建文件夹" aria-label="新建文件夹">
                <Plus size={17} />
              </button>
            )}
          </div>
          <button className={`folder-row ${!selectedFolder && !showRecycleBin ? "active" : ""}`} onClick={() => chooseFolder("")}>
            <Images size={18} />
            <span>全部影像</span>
            <b>{totalPhotos}</b>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className={`folder-row ${!showRecycleBin && selectedFolder === folder.slug ? "active" : ""}`}
              onClick={() => chooseFolder(folder.slug)}
              title={visibilityLabel(folder.visibilityType)}
            >
              {folder.visibilityType === "admins"
                ? <Users size={18} />
                : folder.visibilityType === "specific"
                  ? <UserRound size={18} />
                  : selectedFolder === folder.slug ? <FolderOpen size={18} /> : <Folder size={18} />}
              <span>{folder.name}</span>
              <b>{folder.photoCount}</b>
            </button>
          ))}
          {canDeleteMedia && (
            <button className={`folder-row recycle-row ${showRecycleBin ? "active" : ""}`} onClick={chooseRecycleBin}>
              <Trash2 size={18} />
              <span>回收站</span>
              <b>{recycleCount}</b>
            </button>
          )}
          {canOpenPeople && (
            <button className={`folder-row admin-nav-row ${activeView === "admin" ? "active" : ""}`} onClick={() => openAdminView("users")}>
              <Users size={18} />
              <span>{isSuperAdmin ? "权限与日志" : "称号管理"}</span>
              <ShieldCheck size={14} />
            </button>
          )}
        </nav>

        <div className="signed-user">
          <span className="user-avatar">
            {initialUser.avatarUrl ? <img src={initialUser.avatarUrl} alt="" /> : <UserRound size={18} />}
          </span>
          <span className="user-copy">
            <strong className={initialUser.title ? "shimmer-title" : undefined}>{initialUser.title || initialUser.displayName}</strong>
            <small>{initialUser.title ? `${initialUser.displayName} · ${permissionSummary(initialUser.permissions)}` : `${providerLabel(initialUser.provider)} · ${permissionSummary(initialUser.permissions)}`}</small>
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
            <strong>{showRecycleBin ? "回收站" : activeFolder?.name || "全部影像"}</strong>
          </div>
          <div className="top-identity" aria-label="当前用户称号">
            <Crown size={16} />
            <span className={initialUser.title ? "shimmer-title" : undefined}>{initialUser.title || permissionSummary(initialUser.permissions)}</span>
            <strong>{initialUser.displayName}</strong>
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
            {selectedFolder && canManageFolders && (
              <button className="secondary-button" onClick={openFolderRename}>
                <Pencil size={17} />
                重命名
              </button>
            )}
            {selectedFolder && activeFolder && canManageFolders && (
              <button className="secondary-button" onClick={() => setDeletingFolder(activeFolder)} title="删除空文件夹">
                <Trash2 size={17} />
                删除
              </button>
            )}
            {selectedFolder && canManageFolders && (
              <button className="secondary-button" onClick={() => void copyUploadLink()}>
                {copiedUpload ? <Check size={17} /> : <Share2 size={17} />}
                {copiedUpload ? "已复制" : "上传链接"}
              </button>
            )}
            {selectedFolder && activeFolder?.canManageVisibility && (
              <button
                className="secondary-button"
                onClick={openFolderVisibility}
              >
                <ShieldCheck size={17} />
                可见范围
              </button>
            )}
            {!showRecycleBin && <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={!canUpload} title={canUpload ? "上传照片或视频" : "需要上传权限"}>
              <Upload size={18} /> 上传影像
            </button>}
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
          {sharedUploadToken && sharedFolder === selectedFolder && !canDirectUpload && (
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
          {showRecycleBin && (
            <div className="recycle-notice" role="status">
              <Trash2 size={17} />
              <span>回收站中的影像保留 7 天，到期后会自动永久删除；可在到期前批量恢复。</span>
            </div>
          )}

          <div className="section-heading">
            <div>
              <h1>{showRecycleBin ? "回收站" : activeFolder?.name || "全部影像"}</h1>
              <p>{editMode
                  ? `已选择 ${selectedPhotoIds.length} 项`
                  : search.trim()
                    ? `当前已加载内容中找到 ${visiblePhotos.length} 项 · 共 ${total} 项`
                    : `${total} 项影像`}</p>
            </div>
            <div className="section-controls">
              {canBatchEdit && visiblePhotos.length > 0 && (
                <button className={`secondary-button edit-mode-button ${editMode ? "active" : ""}`} onClick={() => editMode ? leaveEditMode() : setEditMode(true)}>
                  {editMode ? <X size={16} /> : <Pencil size={16} />}
                  {editMode ? "退出编辑" : "编辑"}
                </button>
              )}
              <div className="view-toggle" aria-label="视图切换">
                <button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title="网格视图" aria-label="网格视图"><Grid2X2 size={17} /></button>
                <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} title="列表视图" aria-label="列表视图"><LayoutList size={18} /></button>
              </div>
            </div>
          </div>

          {editMode && (
            <div className="batch-toolbar" role="toolbar" aria-label="批量编辑影像">
              <div>
                <button className="secondary-button" onClick={toggleAllVisible}>
                  <Check size={16} /> {allVisibleSelected ? "取消全选" : visiblePhotos.length > MAX_BATCH_SELECTION ? "选择前 100 项" : "全选当前结果"}
                </button>
                <span>已选择 <strong>{selectedPhotoIds.length}</strong> 项</span>
              </div>
              {showRecycleBin ? (
                <div>
                  <button className="secondary-button" disabled={!selectedPhotoIds.length || batchSaving} onClick={() => void restoreSelectedPhotos()}>
                    <FolderOpen size={16} /> 恢复
                  </button>
                  <button className="danger-button" disabled={!selectedPhotoIds.length || batchSaving} onClick={() => setBatchDeleteOpen(true)}>
                    <Trash2 size={16} /> 永久删除
                  </button>
                </div>
              ) : (
                <div>
                  {canEditMedia && <button className="secondary-button" disabled={!selectedPhotoIds.length || !moveTargets.length || batchSaving} onClick={openBatchMove}>
                    <FolderOpen size={16} /> 移动到
                  </button>}
                  {canDeleteMedia && <button className="danger-button" disabled={!selectedPhotoIds.length || batchSaving} onClick={() => setBatchDeleteOpen(true)}>
                    <Trash2 size={16} /> 移入回收站
                  </button>}
                </div>
              )}
            </div>
          )}

          {canUpload && !editMode && (
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
          ) : photos.length ? (
            <>
            {visiblePhotos.length ? (
            <div className={viewMode === "grid" ? "photo-grid" : "photo-list"}>
              {visiblePhotos.map((photo) => (
                <article className={`photo-card ${editMode ? "editing" : ""} ${selectedPhotoSet.has(photo.id) ? "selected" : ""}`} key={photo.id}>
                  <button
                    className="photo-preview"
                    onClick={() => editMode ? togglePhotoSelection(photo.id) : openPreview(photo)}
                    aria-label={editMode ? `${selectedPhotoSet.has(photo.id) ? "取消选择" : "选择"} ${photo.name}` : `预览 ${photo.name}`}
                  >
                    {isVideoMimeType(photo.mimeType)
                      ? <video src={photo.url} muted playsInline preload="metadata" aria-label={photo.name} />
                      : <img src={photo.url} alt={photo.name} loading="lazy" />}
                    {isVideoMimeType(photo.mimeType) && <span className="play-badge"><Play size={19} fill="currentColor" /></span>}
                    {editMode
                      ? <span className="selection-mark">{selectedPhotoSet.has(photo.id) && <Check size={17} strokeWidth={3} />}</span>
                      : <span className="expand"><Maximize2 size={16} /></span>}
                  </button>
                  <div className="photo-meta">
                    <div>
                      <strong title={photo.name}>{photo.name}</strong>
                      <span>{formatSize(photo.size)} · {formatDate(photo.createdAt)}</span>
                      <span className="media-operator">{operationLabel(photo)}{photo.lastActionAt ? ` · ${formatDate(photo.lastActionAt)}` : ""}</span>
                      {showRecycleBin && photo.purgeAt && <span className="purge-date">{formatDate(photo.purgeAt)} 后永久删除</span>}
                    </div>
                    {!editMode && <div className="photo-actions">
                      {canEditMedia && !showRecycleBin && <button className="icon-button" onClick={() => openRename(photo)} title="重命名" aria-label={`重命名 ${photo.name}`}><Pencil size={16} /></button>}
                      {canDeleteMedia && !showRecycleBin && <button className="icon-button danger" onClick={() => setDeletingPhoto(photo)} title={`删除${mediaLabel(photo)}`} aria-label={`删除 ${photo.name}`}><Trash2 size={16} /></button>}
                      <a className="icon-button" href={downloadUrl(photo.url, photo.name)} onClick={() => logMediaAccess(photo, "media.download")} title="下载原文件" aria-label={`下载 ${photo.name}`}>
                        <Download size={17} />
                      </a>
                    </div>}
                  </div>
                </article>
              ))}
            </div>
            ) : (
              <div className="search-empty">当前已加载的影像中没有匹配项，可以继续加载下一页后再搜索。</div>
            )}
            <div className="library-pagination" aria-live="polite">
              <span>已加载 {photos.length} / {total} 项</span>
              {hasMore ? (
                <button
                  className="secondary-button"
                  onClick={() => void loadLibrary(selectedFolder, showRecycleBin, true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? <LoaderCircle className="spin" size={16} /> : <ChevronRight size={16} />}
                  {loadingMore ? "正在加载" : "加载更多"}
                </button>
              ) : <strong>已经显示全部影像</strong>}
            </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-visual">
                <span><Video size={28} /></span>
                <span><Images size={32} /></span>
                <span><ImageIcon size={25} /></span>
              </div>
              <h2>{showRecycleBin ? "回收站是空的" : selectedFolder ? "这个文件夹还是空的" : "还没有影像"}</h2>
              <p>{showRecycleBin ? "删除的影像会在这里保留 7 天。" : selectedFolder ? "添加第一批照片或视频，影像会按时间自动排列。" : "新建一个文件夹，开始整理你的照片与视频。"}</p>
              {!showRecycleBin && (canUpload || canManageFolders) && (
                <button className="primary-button" onClick={() => canUpload ? fileInput.current?.click() : openNewFolder()}>
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
                <h1>{isSuperAdmin ? "人员权限管理" : "成员称号管理"}</h1>
                <p>{isSuperAdmin ? "阿里山清茶是超级管理员，可逐项设置其他成员权限、状态和称号。" : "你可以授予或修改成员称号，但看不到其他人的权限设置。"}</p>
              </div>
              <div className={`admin-tabs ${isSuperAdmin ? "" : "single"}`} role="tablist" aria-label="管理视图">
                <button className={adminSection === "users" ? "active" : ""} onClick={() => switchAdminSection("users")} role="tab">
                  <Users size={17} /> 用户
                </button>
                {isSuperAdmin && (
                  <button className={adminSection === "logs" ? "active" : ""} onClick={() => switchAdminSection("logs")} role="tab">
                    <Activity size={17} /> 日志
                  </button>
                )}
              </div>
            </div>

            {adminLoading ? (
              <div className="loading-state"><LoaderCircle className="spin" size={25} /> 正在读取管理数据</div>
            ) : adminSection === "users" ? (
              <div className={`management-table ${isSuperAdmin ? "permission-table" : "title-table"}`} role="table" aria-label={isSuperAdmin ? "人员权限管理" : "称号管理"}>
                <div className="management-row management-header" role="row">
                  <span>用户</span><span>称号</span>{isSuperAdmin && <><span>权限开关</span><span>账号状态</span></>}
                </div>
                {managedUsers.map((user) => (
                  <div className="management-row user-row" role="row" key={user.id}>
                    <div className="managed-user">
                      <span className="managed-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <UserRound size={18} />}</span>
                      <span><strong>{user.displayName}</strong><small>{user.accountLabel}{isSuperAdmin && user.provider && user.lastLoginAt ? ` · ${providerLabel(user.provider)} · ${formatFullDate(user.lastLoginAt)}` : ""}</small></span>
                    </div>
                    {canAssignTitles ? (
                      <input
                        className="title-input"
                        value={user.title || ""}
                        maxLength={20}
                        placeholder="设置称号"
                        onChange={(event) => setManagedUsers((users) => users.map((item) => item.id === user.id ? { ...item, title: event.target.value } : item))}
                        onBlur={(event) => void updateManagedUser(user, { title: event.currentTarget.value })}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                        aria-label={`${user.displayName}的称号`}
                      />
                    ) : <span className="title-readonly">{user.title || "未设置"}</span>}
                    {isSuperAdmin && <div className="permission-switches">
                      {PERMISSION_OPTIONS.map((permission) => (
                        <label key={permission.key}>
                          <input
                            type="checkbox"
                            checked={user.accountLabel === "alishan-tea" || Boolean(user.permissions?.[permission.key])}
                            disabled={user.accountLabel === "alishan-tea"}
                            onChange={(event) => toggleManagedPermission(user, permission.key, event.target.checked)}
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </div>}
                    {isSuperAdmin && (user.accountLabel === "alishan-tea" ? <strong className="super-admin-badge">超级管理员</strong> : <label className="status-toggle">
                      <input
                        type="checkbox"
                        checked={user.status === "active"}
                        onChange={(event) => void updateManagedUser(user, { status: event.target.checked ? "active" : "disabled" })}
                      />
                      <span>{user.status === "active" ? "已启用" : "已停用"}</span>
                    </label>)}
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
            <VisibilityFields
              visibilityType={newFolderVisibility}
              selectedUserIds={newFolderVisibleUserIds}
              users={visibilityUsers}
              requiredUserId={initialUser.id}
              disabled={creatingFolder}
              onVisibilityTypeChange={setNewFolderVisibility}
              onSelectedUserIdsChange={setNewFolderVisibleUserIds}
            />
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setNewFolderOpen(false)}>取消</button>
              <button
                className="primary-button"
                disabled={!newFolderName.trim() || creatingFolder || (newFolderVisibility === "specific" && !newFolderVisibleUserIds.length)}
                onClick={() => void createFolder()}
              >
                {creatingFolder ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} 创建
              </button>
            </div>
          </section>
        </div>
      )}

      {visibilityOpen && activeFolder && (
        <div className="modal-backdrop" onMouseDown={() => !savingVisibility && setVisibilityOpen(false)}>
          <section className="dialog visibility-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="folder-visibility-title">
            <div className="dialog-heading">
              <div>
                <span className="dialog-icon"><ShieldCheck size={19} /></span>
                <h2 id="folder-visibility-title">「{activeFolder.name}」的可见范围</h2>
              </div>
              <button className="icon-button" disabled={savingVisibility} onClick={() => setVisibilityOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message security-message">没有权限的人不会在目录、全部影像或搜索结果中看到这个文件夹及其内容。</p>
            <VisibilityFields
              visibilityType={folderVisibility}
              selectedUserIds={folderVisibleUserIds}
              users={visibilityUsers}
              requiredUserId={activeFolder.creatorUserId}
              disabled={savingVisibility}
              onVisibilityTypeChange={setFolderVisibility}
              onSelectedUserIdsChange={setFolderVisibleUserIds}
            />
            <div className="dialog-actions">
              <button className="secondary-button" disabled={savingVisibility} onClick={() => setVisibilityOpen(false)}>取消</button>
              <button
                className="primary-button"
                disabled={savingVisibility || (folderVisibility === "specific" && !folderVisibleUserIds.length)}
                onClick={() => void saveFolderVisibility()}
              >
                {savingVisibility ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                保存
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

      {editingFolder && (
        <div className="modal-backdrop" onMouseDown={() => !savingFolderName && setEditingFolder(null)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rename-folder-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon"><Pencil size={19} /></span><h2 id="rename-folder-title">重命名文件夹</h2></div>
              <button className="icon-button" disabled={savingFolderName} onClick={() => setEditingFolder(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <label className="field-label" htmlFor="editing-folder-name">文件夹名称</label>
            <input id="editing-folder-name" className="text-input" autoFocus maxLength={80} value={editingFolderName} onChange={(event) => setEditingFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameFolder(); }} />
            <div className="dialog-actions">
              <button className="secondary-button" disabled={savingFolderName} onClick={() => setEditingFolder(null)}>取消</button>
              <button className="primary-button" disabled={!editingFolderName.trim() || savingFolderName} onClick={() => void renameFolder()}>
                {savingFolderName ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} 保存
              </button>
            </div>
          </section>
        </div>
      )}

      {deletingFolder && (
        <div className="modal-backdrop" onMouseDown={() => !savingFolderDelete && setDeletingFolder(null)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-folder-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon danger"><Trash2 size={19} /></span><h2 id="delete-folder-title">删除文件夹</h2></div>
              <button className="icon-button" disabled={savingFolderDelete} onClick={() => setDeletingFolder(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message">
              {deletingFolder.photoCount > 0
                ? `「${deletingFolder.name}」中还有 ${deletingFolder.photoCount} 项影像，请先移动影像；回收站内容也需要恢复后移动或永久删除。`
                : `确定删除空文件夹「${deletingFolder.name}」吗？文件夹删除后无法恢复。`}
            </p>
            <div className="dialog-actions">
              <button className="secondary-button" disabled={savingFolderDelete} onClick={() => setDeletingFolder(null)}>取消</button>
              <button className="danger-button" disabled={savingFolderDelete || deletingFolder.photoCount > 0} onClick={() => void deleteFolder()}>
                {savingFolderDelete ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} 删除文件夹
              </button>
            </div>
          </section>
        </div>
      )}

      {deletingPhoto && (
        <div className="modal-backdrop" onMouseDown={() => !savingPhoto && setDeletingPhoto(null)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="delete-photo-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon danger"><Trash2 size={19} /></span><h2 id="delete-photo-title">移入回收站</h2></div>
              <button className="icon-button" disabled={savingPhoto} onClick={() => setDeletingPhoto(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message">确定将「{deletingPhoto.name}」移入回收站吗？影像会保留 7 天，期间可以恢复。</p>
            <div className="dialog-actions">
              <button className="secondary-button" disabled={savingPhoto} onClick={() => setDeletingPhoto(null)}>取消</button>
              <button className="danger-button" disabled={savingPhoto} onClick={() => void deletePhoto()}>
                {savingPhoto ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} 移入回收站
              </button>
            </div>
          </section>
        </div>
      )}

      {batchMoveOpen && (
        <div className="modal-backdrop" onMouseDown={() => !batchSaving && setBatchMoveOpen(false)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="batch-move-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon"><FolderOpen size={19} /></span><h2 id="batch-move-title">移动 {selectedPhotoIds.length} 项影像</h2></div>
              <button className="icon-button" disabled={batchSaving} onClick={() => setBatchMoveOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message security-message">选择目标文件夹，照片和视频会保留原名称与拍摄信息。</p>
            <label className="field-label" htmlFor="batch-target-folder">目标文件夹</label>
            <select id="batch-target-folder" className="text-input folder-select" value={batchTargetFolder} disabled={batchSaving} onChange={(event) => setBatchTargetFolder(event.target.value)}>
              {moveTargets.map((folder) => <option key={folder.id} value={folder.slug}>{folder.name}（{visibilityLabel(folder.visibilityType)}）</option>)}
            </select>
            <div className="dialog-actions">
              <button className="secondary-button" disabled={batchSaving} onClick={() => setBatchMoveOpen(false)}>取消</button>
              <button className="primary-button" disabled={!batchTargetFolder || batchSaving} onClick={() => void moveSelectedPhotos()}>
                {batchSaving ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />} 确认移动
              </button>
            </div>
          </section>
        </div>
      )}

      {batchDeleteOpen && (
        <div className="modal-backdrop" onMouseDown={() => !batchSaving && setBatchDeleteOpen(false)}>
          <section className="dialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="batch-delete-title">
            <div className="dialog-heading">
              <div><span className="dialog-icon danger"><Trash2 size={19} /></span><h2 id="batch-delete-title">{showRecycleBin ? "永久删除影像" : "移入回收站"}</h2></div>
              <button className="icon-button" disabled={batchSaving} onClick={() => setBatchDeleteOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <p className="dialog-message">{showRecycleBin
              ? `确定永久删除已选择的 ${selectedPhotoIds.length} 项影像吗？云存储原文件会被删除，无法恢复。`
              : `确定将已选择的 ${selectedPhotoIds.length} 项影像移入回收站吗？影像会保留 7 天。`}</p>
            <div className="dialog-actions">
              <button className="secondary-button" disabled={batchSaving} onClick={() => setBatchDeleteOpen(false)}>取消</button>
              <button className="danger-button" disabled={batchSaving} onClick={() => void (showRecycleBin ? purgeSelectedPhotos() : deleteSelectedPhotos())}>
                {batchSaving ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} {showRecycleBin ? "永久删除" : "移入回收站"} {selectedPhotoIds.length} 项
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
              {canEditMedia && !showRecycleBin && <button className="icon-button dark" onClick={() => openRename(preview)} title="重命名" aria-label={`重命名${mediaLabel(preview)}`}><Pencil size={17} /></button>}
              {canDeleteMedia && !showRecycleBin && <button className="icon-button dark danger" onClick={() => setDeletingPhoto(preview)} title={`删除${mediaLabel(preview)}`} aria-label={`删除${mediaLabel(preview)}`}><Trash2 size={17} /></button>}
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
