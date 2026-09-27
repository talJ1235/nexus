import { ItemCardSkeleton } from "@/components/app/item-card";

export default function Loading() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[264px] shrink-0 border-e border-line lg:block">
        <div className="space-y-3 p-4">
          <div className="skeleton h-7 w-28 rounded-lg" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-7 rounded-lg" style={{ width: `${70 + ((i * 13) % 25)}%` }} />
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-3 sm:px-6 lg:px-8">
        <div className="skeleton h-12 rounded-xl" />
        <div className="skeleton mt-8 h-8 w-48 rounded-lg" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-4">
          {Array.from({ length: 10 }, (_, i) => (
            <ItemCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
