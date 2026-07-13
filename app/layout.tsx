import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  return {
    title: "拾光册 - 私人影像空间",
    description: "按文件夹整理、上传、预览和下载你的照片。",
    openGraph: {
      title: "拾光册",
      description: "私人影像空间",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "拾光册相册预览" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "拾光册",
      description: "私人影像空间",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
