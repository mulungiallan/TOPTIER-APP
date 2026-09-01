import Link from "next/link";

// 404 page for unknown routes.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <p className="text-6xl font-bold mb-3 text-blue-600">404</p>
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-sm text-zinc-400 mb-6">
        The page you&apos;re looking for doesn&apos;t exist or was moved.
      </p>
      <Link
        href="/"
        className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        Go home
      </Link>
    </div>
  );
}