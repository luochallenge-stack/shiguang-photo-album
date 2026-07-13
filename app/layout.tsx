import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://paratrooper-battalion-d1b3b82e83-1313194650.ap-shanghai.app.tcloudbase.com"),
  title: "伞兵训练营的时光集",
  description: "按文件夹整理、上传、预览和下载照片与视频。",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "伞兵训练营的时光集",
    description: "照片与视频影像集",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary",
    title: "伞兵训练营的时光集",
    description: "照片与视频影像集",
    images: ["/logo.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
