import type { CommuteInfo } from "@/lib/types";
import { ClockIcon } from "@/lib/icons";

interface Props {
  commute?: CommuteInfo;
}

export function CommuteBadge({ commute }: Props) {
  if (!commute) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-neutral-100 text-neutral-400 text-[11px] font-medium rounded-lg">
        <ClockIcon className="w-3 h-3" />
        Commute N/A
      </span>
    );
  }

  const minutes = Math.round(commute.duration_seconds / 60);
  const color =
    minutes <= 20 ? "bg-success-50 text-success-700"
    : minutes <= 40 ? "bg-warning-50 text-warning-700"
    : "bg-danger-50 text-danger-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg font-medium ${color}`}>
      <ClockIcon className="w-3 h-3" />
      {commute.duration_text} · {commute.distance_text}
    </span>
  );
}
