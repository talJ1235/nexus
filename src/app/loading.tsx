import { ItemCardSkeleton } from "@/components/app/item-card";

/**
 * Skeleton that mirrors the real shell (sidebar, sticky header, title, grid) so nothing shifts
 * when the page arrives. Hidden for the first ~0.45s — fast loads never see it.
 */
export default function Loading() {
  return (
    <div className="loading-shell flex min-h-dvh" aria-busy="true" aria-live="polite">
      <div className="skeleton-pulse flex min-w-0 flex-1">
        <aside className="hidden h-dvh w-[264px] shrink-0 border-e border-line lg:block">
          <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
            <div className="skeleton size-7 rounded-[9px]" />
            <div className="skeleton h-4 w-16 rounded" />
          </div>
          <div className="mt-2 space-y-1.5 px-2">
            {[62, 48, 55, 44].map((w, i) => (
              <div key={i} className="flex h-[34px] items-center gap-2.5 px-2.5">
                <div className="skeleton size-4 rounded" />
                <div className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-6 space-y-1.5 px-2">
            {[58, 40].map((w, i) => (
              <div key={i} className="flex h-[34px] items-center gap-2.5 px-2.5">
                <div className="skeleton size-2.5 rounded-[3px]" />
                <div className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="border-b border-line/70">
            <div className="mx-auto max-w-[1400px] px-4 py-3 sm:px-6 lg:px-8">
              <div className="skeleton h-12 rounded-xl" />
            </div>
          </div>
          <div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">
            <div className="skeleton h-7 w-40 rounded-lg" />
            <div className="skeleton mt-3 h-3.5 w-56 rounded" />
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-4">
              {Array.from({ length: 8 }, (_, i) => (
                <ItemCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
