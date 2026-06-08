import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

export interface EvidenceStorage {
  put(dealId: string, data: Buffer): Promise<{ key: string; sha256: string }>;
  get(key: string): Promise<Buffer>;
}

export class LocalEvidenceStorage implements EvidenceStorage {
  async put(dealId: string, data: Buffer) {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const directory = path.resolve(env.EVIDENCE_LOCAL_PATH, dealId);
    await mkdir(directory, { recursive: true });
    const key = `${dealId}/${sha256}`;
    await writeFile(path.join(directory, sha256), data, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    return { key, sha256 };
  }

  async get(key: string) {
    const [dealId, sha256, extra] = key.split("/");
    if (!dealId || !sha256 || extra || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid evidence key");
    return readFile(path.resolve(env.EVIDENCE_LOCAL_PATH, dealId, sha256));
  }
}

// R2 must be implemented with an S3-compatible client before EVIDENCE_STORAGE=r2 is enabled.
export function evidenceStorage(): EvidenceStorage {
  if (env.EVIDENCE_STORAGE === "r2") throw new Error("R2 evidence storage is not implemented in this MVP");
  return new LocalEvidenceStorage();
}
