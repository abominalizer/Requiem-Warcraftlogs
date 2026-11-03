export default function Loading() {
  return (
    <div className="flex items-center gap-3 py-20 text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      Fetching logs from Warcraft Logs… (big reports can take a few seconds)
    </div>
  );
}
