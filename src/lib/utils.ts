import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Drafts are previewable in `astro dev` and left out of production builds
export function isPublished(entry: { data: { draft?: boolean } }) {
  return import.meta.env.DEV || !entry.data.draft
}

export const COLLECTION_LABELS: Record<string, string> = {
  projects: "프로젝트",
  blog: "기술 기록",
  posts: "블로그",
}

export function formatDate(date: Date) {
  return Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export function readingTime(html: string) {
  const textOnly = html.replace(/<[^>]+>/g, "")
  const wordCount = textOnly.split(/\s+/).length
  const readingTimeMinutes = ((wordCount / 200) + 1).toFixed()
  return `${readingTimeMinutes} min read`
}


export function truncateText(str: string, maxLength: number): string {
  const ellipsis = '…';

  if (str.length <= maxLength) return str;

  const trimmed = str.trimEnd();
  if (trimmed.length <= maxLength) return trimmed;

  const cutoff = maxLength - ellipsis.length;
  let sliced = str.slice(0, cutoff).trimEnd();

  return sliced + ellipsis;
}