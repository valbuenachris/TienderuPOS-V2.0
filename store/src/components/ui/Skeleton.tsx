export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton-bg rounded-md ${className}`.trim()} aria-hidden="true" />;
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-white p-3 shadow-card">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="h-5 w-1/3" />
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="container-page py-8">
      <Skeleton className="mb-6 h-7 w-56" />
      <ProductGridSkeleton />
    </div>
  );
}
