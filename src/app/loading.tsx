// Route-segment loading fallback shown while lazy page chunks download.
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    </div>
  );
}