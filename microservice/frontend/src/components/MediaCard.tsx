import { Play, Newspaper } from "lucide-react";
import { YoutubeIcon, InstagramIcon } from "@/components/Icons";
import type { MediaItem } from "@/content/media";
import { mediaThumbnail } from "@/content/media";

const KIND_BADGE: Record<string, { icon: React.ReactNode; bg: string }> = {
  youtube: { icon: <YoutubeIcon className="w-3 h-3" />, bg: "bg-red-600" },
  instagram: { icon: <InstagramIcon className="w-3 h-3" />, bg: "bg-pink-600" },
  news: { icon: <Newspaper className="w-3 h-3" />, bg: "bg-slate-700" },
  x: { icon: <span className="text-[10px] font-bold leading-none">𝕏</span>, bg: "bg-black" },
};

function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

export function MediaCard({ item, index }: { item: MediaItem; index?: number }) {
  const thumb = mediaThumbnail(item);
  const badge = KIND_BADGE[item.kind];

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="brutal-panel overflow-hidden flex flex-col focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--holo-cyan)] group"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden bg-slate-100 dark:bg-slate-900">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className={`w-full h-full object-cover ${item.kind === "instagram" ? "object-top" : ""} transition-transform duration-300 motion-safe:group-hover:scale-[1.03]`}
          />
        ) : (
          <div className="w-full h-full holo-void flex items-center justify-center">
            <span className="text-sm text-slate-400 font-medium">{item.source}</span>
          </div>
        )}
        {/* Play overlay for YouTube */}
        {item.kind === "youtube" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center group-hover:bg-black/70 transition-colors">
              <Play className="w-5 h-5 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}
        {/* Source badge */}
        {badge && (
          <div className={`absolute top-2 left-2 ${badge.bg} text-white rounded px-1.5 py-0.5 flex items-center gap-1 text-[11px]`}>
            {badge.icon}
          </div>
        )}
        {/* Order number for videos */}
        {index != null && (
          <div className="absolute top-2 right-2 bg-black/60 text-white rounded px-1.5 py-0.5 text-[11px] font-mono backdrop-blur-sm">
            {String(index + 1).padStart(2, "0")}
          </div>
        )}
      </div>
      {/* Meta */}
      <div className="p-4 flex-1 flex flex-col">
        <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-1.5">
          {item.source}{item.date ? `, ${formatDate(item.date)}` : ""}
        </p>
        <p className="text-[14px] font-semibold text-foreground leading-snug line-clamp-2">
          {item.title}
        </p>
      </div>
    </a>
  );
}
