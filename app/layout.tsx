import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "伞兵训练营的时光集",
  description: "按文件夹整理、上传、预览和下载照片与视频。",
  openGraph: {
    title: "伞兵训练营的时光集",
    description: "照片与视频影像集",
  },
  twitter: {
    card: "summary",
    title: "伞兵训练营的时光集",
    description: "照片与视频影像集",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
