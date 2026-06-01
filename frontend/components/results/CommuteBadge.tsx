import type { CommuteInfo } from "@/lib/types";

interface Props {
  commute?: CommuteInfo;
}

export function CommuteBadge({ commute }: Props) {
  if (!commute) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded-full">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Commute N/A
      </span>
    );
  }

  const minutes = Math.round(commute.duration_seconds / 60);
  const color =
    minutes <= 20 ? "bg-green-100 text-green-700"
    : minutes <= 40 ? "bg-amber-100 text-amber-700"
    : "bg-red-100 text-red-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium ${color}`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {commute.duration_text} · {commute.distance_text}
    </span>
  );
}
