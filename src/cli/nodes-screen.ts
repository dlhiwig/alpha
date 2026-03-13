import * as path from "node:path";
import { writeBase64ToFile } from "./nodes-camera.js";
import { asRecord, asString, resolveTempPathParts } from "./nodes-media-utils.js";

export type ScreenRecordPayload = {
  format: string;
  base64: string;
  durationMs?: number;
  fps?: number;
  screenIndex?: number;
  hasAudio?: boolean;
};

export function parseScreenRecordPayload(value: unknown): ScreenRecordPayload {
  const obj = asRecord(value);
  const format = asString(obj.format);
  const base64 = asString(obj.base64);
  if (!format || !base64) {
    throw new Error("invalid screen.record payload");
  }
  return {
    format,
    base64,
    durationMs: typeof obj.durationMs === "number" ? obj.durationMs : undefined,
    fps: typeof obj.fps === "number" ? obj.fps : undefined,
    screenIndex: typeof obj.screenIndex === "number" ? obj.screenIndex : undefined,
    hasAudio: typeof obj.hasAudio === "boolean" ? obj.hasAudio : undefined,
  };
}

export function screenRecordTempPath(opts: { ext: string; tmpDir?: string; id?: string }) {
<<<<<<< HEAD
  const tmpDir = opts.tmpDir ?? os.tmpdir();
  const id = opts.id ?? randomUUID();
  const ext = opts.ext.startsWith(".") ? opts.ext : `.${opts.ext}`;
  return path.join(tmpDir, `nicholsbot-screen-record-${id}${ext}`);
=======
  const { tmpDir, id, ext } = resolveTempPathParts(opts);
  return path.join(tmpDir, `openclaw-screen-record-${id}${ext}`);
>>>>>>> sync/upstream-20260313
}

export async function writeScreenRecordToFile(filePath: string, base64: string) {
  return writeBase64ToFile(filePath, base64);
}
