export type MediaKind = "youtube" | "instagram" | "news" | "x";
export type MediaGroup = "videos" | "webinars" | "press";

export interface MediaItem {
  id: string;
  group: MediaGroup;
  kind: MediaKind;
  url: string;
  title: string;
  source: string;
  date?: string;
  thumbnail?: string;
  order?: number;
}

export const MEDIA_SOURCES: Pick<MediaItem, "group" | "kind" | "url" | "order">[] = [
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=PZ42pYy-Gzo", order: 1 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=7-oIt5gaHLo", order: 2 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=kD00g7Q2NCQ", order: 3 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=kNzOvq8Dlmw", order: 4 },
  { group: "videos", kind: "youtube", url: "https://www.youtube.com/watch?v=ZsofGOah79s", order: 5 },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DdAc6jimWYc/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/Dc-iO3gtLcU/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DY1EWoapTSA/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DYGOKSdjyU_/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DXLj6KbkXtx/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DQBMbWij8yV/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DPoMGJKE60j/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DNqF6xdR8mk/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DJElV3XSbH3/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DIjG-qAJz5-/" },
  { group: "webinars", kind: "instagram", url: "https://www.instagram.com/p/DKMrvJkzUEp/" },
  { group: "press", kind: "news", url: "https://www.detik.com/edu/edutainment/d-7212856/inovasi-mahasiswa-its-bantu-tunanetra-melihat-orang-alzheimer-mengingat" },
  { group: "press", kind: "news", url: "https://kumparan.com/beritaanaksurabaya/teknologi-ai-karya-mahasiswa-di-surabaya-bantu-tunanetra-dan-alzheimer-22M4Z5qN4lV" },
  { group: "press", kind: "news", url: "https://sorotnesia.com/its-kenalkan-teknologi-ai-untuk-penyandang-tunanetra-di-surabaya/" },
  { group: "press", kind: "x", url: "https://x.com/narasitv/status/1768137689768030550" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/DHTPNrqvLXN/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/DE7VE2VpFJi/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C34Te0PvbSD/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C32GMlJBnrt/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C37D4TuJvpW/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C4p0gyYvFPY/" },
  { group: "press", kind: "instagram", url: "https://www.instagram.com/p/C_z-QW4SD6_/" },
];

export function youtubeId(url: string): string | undefined {
  const m =
    url.match(/[?&]v=([^&#]+)/) ||
    url.match(/youtu\.be\/([^?&#]+)/) ||
    url.match(/shorts\/([^?&#]+)/) ||
    url.match(/embed\/([^?&#]+)/);
  return m?.[1];
}

export function mediaThumbnail(item: MediaItem): string | undefined {
  if (item.thumbnail) return item.thumbnail;
  if (item.kind === "youtube") {
    const vid = youtubeId(item.url);
    return vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : undefined;
  }
  return undefined;
}

function itemId(url: string, kind: MediaKind): string {
  if (kind === "youtube") return youtubeId(url) || url;
  if (kind === "instagram") {
    const m = url.match(/\/p\/([^/]+)/);
    return m?.[1] || url;
  }
  if (kind === "x") {
    const m = url.match(/status\/(\d+)/);
    return m?.[1] || url;
  }
  try { return new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-"); } catch { return url; }
}

import generated from "./media.generated";
import overrides from "./media.overrides";

function buildItems(): MediaItem[] {
  return MEDIA_SOURCES.map((src) => {
    const id = itemId(src.url, src.kind);
    const gen = (generated as Record<string, Partial<MediaItem>>)[id] || {};
    const ovr = (overrides as Record<string, Partial<MediaItem>>)[id] || {};
    const merged = { ...gen, ...ovr };
    return {
      id,
      group: src.group,
      kind: src.kind,
      url: src.url,
      title: merged.title || "TODO",
      source: merged.source || src.kind,
      date: merged.date,
      thumbnail: merged.thumbnail,
      order: src.order,
    } as MediaItem;
  });
}

const ALL = buildItems();

export const VIDEOS = ALL.filter((m) => m.group === "videos").sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const WEBINAR_POSTS = ALL.filter((m) => m.group === "webinars").sort((a, b) => {
  if (a.date && b.date) return b.date.localeCompare(a.date);
  return 0;
});
export const PRESS = ALL.filter((m) => m.group === "press").sort((a, b) => {
  const kindOrder: Record<string, number> = { news: 0, x: 1, instagram: 2, youtube: 3 };
  const ko = (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
  if (ko !== 0) return ko;
  if (a.date && b.date) return b.date.localeCompare(a.date);
  return 0;
});

export const MEDIA_SECTION_LABELS = {
  videos: { index: "Videos", heading: "The journey on camera" },
  press: { index: "In the news", heading: "Press and coverage" },
  webinars: { index: "Webinars", heading: "Sessions and workshops" },
};
