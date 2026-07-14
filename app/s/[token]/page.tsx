import Image from "next/image";
import { resolveMediaShare } from "../../../lib/media-share";

export const dynamic = "force-dynamic";

export default async function SharedImagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await resolveMediaShare(token);
  if (!shared) {
    return (
      <main className="public-share-page public-share-expired">
        <div>
          <span>伞兵训练营的时光集</span>
          <h1>链接已失效</h1>
          <p>分享链接不存在、已经超过 24 小时，或图片已被删除。</p>
        </div>
      </main>
    );
  }
  const width = Math.max(1, shared.photo.width || 1600);
  const height = Math.max(1, shared.photo.height || 1200);
  const tokenParam = encodeURIComponent(token);
  return (
    <main className="public-share-page">
      <header className="public-share-header">
        <div><span>伞兵训练营的时光集</span><h1>{shared.photo.name}</h1></div>
        <nav className="public-share-actions" aria-label="图片操作">
          <a href={`/s/${tokenParam}/image`}>查看大图</a>
          <a href={`/s/${tokenParam}/download`}>下载原图</a>
        </nav>
      </header>
      <section className="public-share-media" aria-label={shared.photo.name}>
        <a className="public-share-image-link" href={`/s/${tokenParam}/image`} aria-label={`查看大图：${shared.photo.name}`}>
          <Image
            src={`/s/${tokenParam}/image`}
            alt={shared.photo.name}
            width={width}
            height={height}
            priority
            unoptimized
          />
        </a>
      </section>
      <footer className="public-share-footer">此链接生成后 24 小时内有效</footer>
    </main>
  );
}
