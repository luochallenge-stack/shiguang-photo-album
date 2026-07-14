import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_COVER_BYTES = 8 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 45_000;

function runFfmpeg(source: Buffer | string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const input = typeof source === "string" ? source : "pipe:0";
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", input,
      "-map", "0:v:0",
      "-frames:v", "1",
      "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ], {
      stdio: [typeof source === "string" ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputSize = 0;
    let settled = false;
    const finish = (error?: Error, cover?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(cover || Buffer.alloc(0));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("生成视频封面超时"));
    }, FFMPEG_TIMEOUT_MS);

    child.stdout!.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > MAX_COVER_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("生成的视频封面过大"));
        return;
      }
      output.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      const errorSize = errors.reduce((total, item) => total + item.length, 0);
      if (errorSize < 16 * 1024) errors.push(chunk);
    });
    child.on("error", (error) => finish(new Error(`无法启动视频封面生成器：${error.message}`)));
    child.on("close", (code) => {
      const cover = Buffer.concat(output);
      if (code === 0 && cover.length) {
        finish(undefined, cover);
        return;
      }
      const detail = Buffer.concat(errors).toString("utf8").trim().split("\n").pop();
      finish(new Error(detail ? `生成视频封面失败：${detail}` : "生成视频封面失败"));
    });

    if (Buffer.isBuffer(source)) {
      child.stdin!.on("error", () => undefined);
      child.stdin!.end(source);
    }
  });
}

export function extractVideoCover(contents: Buffer): Promise<Buffer> {
  return runFfmpeg(contents);
}

export async function extractVideoCoverFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("读取历史视频失败");
  const directory = await mkdtemp(join(tmpdir(), "album-video-cover-"));
  const inputPath = join(directory, "source-video");
  try {
    const stream = Readable.fromWeb(response.body as never);
    await pipeline(stream, createWriteStream(inputPath));
    return await runFfmpeg(inputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
