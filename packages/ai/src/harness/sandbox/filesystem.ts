/**
 * Scoped filesystem sandbox — agent can only read/write within rootDir.
 *
 * Path traversal attacks (e.g. "../../etc/passwd") are blocked by resolving
 * all paths and verifying they stay within rootDir.
 */

import { resolve, relative } from "node:path";
import { readFile, writeFile, readdir, stat, unlink, mkdir } from "node:fs/promises";
import type { FsSandbox, FsSandboxConfig } from "../types.js";

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export class FsSandboxImpl implements FsSandbox {
  private rootDir: string;
  private allowWrite: boolean;
  private allowDelete: boolean;
  private maxFileSize: number;

  constructor(config: FsSandboxConfig) {
    this.rootDir = resolve(config.rootDir);
    this.allowWrite = config.allowWrite ?? true;
    this.allowDelete = config.allowDelete ?? false;
    this.maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  }

  /** Resolve a path within the sandbox, throw if it escapes rootDir */
  private resolvePath(path: string): string {
    const resolved = resolve(this.rootDir, path);
    const rel = relative(this.rootDir, resolved);
    if (rel.startsWith("..") || resolve(resolved) !== resolved.replace(/\/$/, "")) {
      throw new Error(`Path traversal blocked: ${path}`);
    }
    // Extra safety: ensure resolved is within rootDir
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error(`Path traversal blocked: ${path}`);
    }
    return resolved;
  }

  async read(path: string): Promise<string> {
    const resolved = this.resolvePath(path);
    return readFile(resolved, "utf-8");
  }

  async write(path: string, content: string): Promise<void> {
    if (!this.allowWrite) {
      throw new Error("Filesystem sandbox: writes are disabled");
    }

    const bytes = Buffer.byteLength(content, "utf-8");
    if (bytes > this.maxFileSize) {
      throw new Error(
        `File too large: ${bytes} bytes exceeds limit of ${this.maxFileSize} bytes`,
      );
    }

    const resolved = this.resolvePath(path);

    // Ensure parent directory exists
    const dir = resolve(resolved, "..");
    await mkdir(dir, { recursive: true });

    await writeFile(resolved, content, "utf-8");
  }

  async list(dir = "."): Promise<string[]> {
    const resolved = this.resolvePath(dir);
    const entries = await readdir(resolved);
    return entries;
  }

  async exists(path: string): Promise<boolean> {
    try {
      const resolved = this.resolvePath(path);
      await stat(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    if (!this.allowDelete) {
      throw new Error("Filesystem sandbox: deletes are disabled");
    }
    const resolved = this.resolvePath(path);
    await unlink(resolved);
  }

  async stat(path: string): Promise<{ size: number; isDir: boolean }> {
    const resolved = this.resolvePath(path);
    const s = await stat(resolved);
    return { size: s.size, isDir: s.isDirectory() };
  }
}
