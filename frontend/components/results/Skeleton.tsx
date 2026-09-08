// Shimmer placeholders shown in ResultsPanel while the agent pipeline is
// running (Analyst/Reviewer/Summarizer), before real listings arrive — P4-3.
// Loosely mirrors ApartmentCard's shape so the swap to real cards doesn't jump.
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-md bg-[linear-gradient(90deg,theme(colors.neutral.100)_25%,theme(colors.neutral.50)_37%,theme(colors.neutral.100)_63%)] bg-[length:400%_100%] animate-shimmer ${className}`}
    />
  );
}

export function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="relative bg-surface rounded-2xl border border-neutral-100 p-4 shadow-xs animate-reveal"
      style={{ animationDelay: `${delay}ms` }}
      aria-hidden
    >
      <div className="absolute top-3 right-3">
        <Shimmer className="w-16 h-4 rounded-full" />
      </div>
      <Shimmer className="w-28 h-6 mb-3" />
      <Shimmer className="w-4/5 h-3.5 mb-2" />
      <Shimmer className="w-2/5 h-3 mb-4" />
      <div className="flex gap-2">
        <Shimmer className="w-16 h-5 rounded-lg" />
        <Shimmer className="w-20 h-5 rounded-lg" />
      </div>
    </div>
  );
}

export function SkeletonResults() {
  return (
    <div className="h-full overflow-hidden px-4 py-4 space-y-3">
      <SkeletonCard delay={0} />
      <SkeletonCard delay={70} />
      <SkeletonCard delay={140} />
    </div>
  );
}
