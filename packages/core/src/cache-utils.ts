export function normalizeCacheTag(tag: unknown): string | undefined {
  if (typeof tag !== "string") {
    return undefined;
  }

  const normalized = tag.trim();
  return normalized === "" ? undefined : normalized;
}

export function normalizeCacheTags(tags: readonly unknown[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  const normalized = new Set<string>();
  for (const tag of tags) {
    const normalizedTag = normalizeCacheTag(tag);
    if (normalizedTag) {
      normalized.add(normalizedTag);
    }
  }

  return [...normalized];
}

export function normalizeCachePath(url: unknown): string {
  if (typeof url !== "string") {
    return "/";
  }

  const raw = url.trim();
  if (raw === "") {
    return "/";
  }

  let pathname: string;
  if (raw.startsWith("/")) {
    pathname = raw.split("?")[0]!.split("#")[0]!;
  } else {
    try {
      pathname = new URL(raw, "http://capstan.local").pathname;
    } catch {
      pathname = raw.split("?")[0]!.split("#")[0]!;
    }
  }

  if (pathname === "") {
    return "/";
  }

  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function createPageCacheKey(url: string): string {
  return `page:${normalizeCachePath(url)}`;
}

export function createCachePathTag(url: unknown): string {
  return `path:${normalizeCachePath(url)}`;
}

export function createCachePathTagFromKey(key: string): string | undefined {
  return key.startsWith("page:/") ? `path:${key.slice("page:".length)}` : undefined;
}

export class CacheTagIndex {
  private tagIndex = new Map<string, Set<string>>();

  register(key: string, tags: readonly string[]): void {
    this.unregister(key);

    for (const tag of tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  unregister(key: string): void {
    for (const [tag, keys] of this.tagIndex) {
      keys.delete(key);
      if (keys.size === 0) {
        this.tagIndex.delete(tag);
      }
    }
  }

  async invalidateTag(
    tag: unknown,
    deleteKey: (key: string) => Promise<boolean>,
  ): Promise<number> {
    const normalizedTag = normalizeCacheTag(tag);
    if (!normalizedTag) {
      return 0;
    }

    const keys = this.tagIndex.get(normalizedTag);
    if (!keys || keys.size === 0) {
      this.tagIndex.delete(normalizedTag);
      return 0;
    }

    let count = 0;
    for (const key of [...keys]) {
      if (await deleteKey(key)) {
        this.unregister(key);
        count++;
      }
    }

    this.tagIndex.delete(normalizedTag);
    return count;
  }

  clear(): void {
    this.tagIndex.clear();
  }
}
