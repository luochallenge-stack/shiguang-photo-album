import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AlbumHlsRendition } from "./cloudbase";

type UploadedFile = { fileId: string; url: string };
type UploadFn = (objectKey: string, contents: Buffer) => Promise<UploadedFile>;

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;
const FFPROBE_TIMEOUT_MS = 20_000;

const PRESETS = [
  { name: "360p", label: "流畅", width: 640, height: 360, videoBitrate: "700k", maxrate: "850k", bufsize: "1200k", audioBitrate: "96k", bandwidth: 900000 },
  { name: "720p", label: "高清", width: 1280, height: 720, videoBitrate: "2200k", maxrate: "2600k", bufsize: "4200k", audioBitrate: "128k", bandwidth: 2800000 },
];

function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, stdout = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`${command} 执行超时`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.reduce((total, item) => total + item.length, 0) < 512 * 1024) output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.reduce((total, item) => total + item.length, 0) < 64 * 1024) errors.push(chunk);
    });
    child.on("error", (error) => finish(new Error(`无法启动 ${command}：${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        finish(undefined, Buffer.concat(output).toString("utf8"));
        return;
      }
      const detail = Buffer.concat(errors).toString("utf8").trim().split("\n").pop();
      finish(new Error(detail ? `${command} 失败：${detail}` : `${command} 失败`));
    });
  });
}

async function videoHeight(inputPath: string): Promise<number> {
  try {
    const output = await runCommand("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=height",
      "-of", "default=nw=1:nk=1",
      inputPath,
    ], FFPROBE_TIMEOUT_MS);
    return Math.max(0, Number(output.trim()) || 0);
  } catch {
    return 0;
  }
}

async function downloadVideo(sourceUrl: string, inputPath: string): Promise<void> {
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) throw new Error("读取源视频失败");
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(inputPath));
}

async function transcodeRendition(inputPath: string, outputDir: string, preset: typeof PRESETS[number]) {
  await mkdir(outputDir, { recursive: true });
  const segmentPath = join(outputDir, "segment-%05d.ts");
  const playlistPath = join(outputDir, "index.m3u8");
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-vf", `scale=w=-2:h=${preset.height}:force_original_aspect_ratio=decrease`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-profile:v", "main",
    "-crf", "24",
    "-b:v", preset.videoBitrate,
    "-maxrate", preset.maxrate,
    "-bufsize", preset.bufsize,
    "-c:a", "aac",
    "-b:a", preset.audioBitrate,
    "-ac", "2",
    "-f", "hls",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", segmentPath,
    playlistPath,
  ], FFMPEG_TIMEOUT_MS);
  return playlistPath;
}

export async function transcodeVideoToHls(
  sourceUrl: string,
  baseObjectKey: string,
  upload: UploadFn,
): Promise<AlbumHlsRendition[]> {
  const directory = await mkdtemp(join(tmpdir(), "album-hls-"));
  const inputPath = join(directory, "source-video");
  try {
    await downloadVideo(sourceUrl, inputPath);
    const sourceHeight = await videoHeight(inputPath);
    const presets = PRESETS.filter((preset) => !sourceHeight || preset.height <= sourceHeight + 40);
    const selectedPresets = presets.length ? presets : [PRESETS[0]];
    const renditions: AlbumHlsRendition[] = [];
    for (const preset of selectedPresets) {
      const renditionDir = join(directory, preset.name);
      const playlistPath = await transcodeRendition(inputPath, renditionDir, preset);
      const playlist = await readFile(playlistPath, "utf8");
      const segmentNames = (await readdir(renditionDir))
        .filter((name) => name.endsWith(".ts"))
        .sort();
      const segments = [];
      for (const segmentName of segmentNames) {
        const segment = await upload(
          `${baseObjectKey}/${preset.name}/${segmentName}`,
          await readFile(join(renditionDir, segmentName)),
        );
        segments.push({ name: basename(segmentName), fileId: segment.fileId });
      }
      renditions.push({
        name: preset.name,
        label: preset.label,
        width: preset.width,
        height: preset.height,
        bandwidth: preset.bandwidth,
        playlist,
        segments,
      });
    }
    return renditions;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
