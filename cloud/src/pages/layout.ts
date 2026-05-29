/**
 * Shared HTML layout with Tailwind CSS via CDN
 */
type User = { email: string; name: string; picture: string };

export function layout(title: string, user: User | null, body: string): string {
  const nav = user
    ? `<nav class="bg-white border-b border-gray-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex justify-between h-16">
            <div class="flex items-center">
              <a href="/portal" class="flex items-center gap-2">
                <div class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                  <span class="text-white font-bold text-sm">S</span>
                </div>
                <span class="font-semibold text-gray-900 text-lg">Sahamati</span>
              </a>
            </div>
            <div class="flex items-center gap-4">
              <span class="text-sm text-gray-600">${escapeHtml(user.name)}</span>
              ${user.picture ? `<img src="${escapeHtml(user.picture)}" alt="" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer">` : ""}
              <a href="/auth/logout" class="text-sm text-gray-500 hover:text-gray-700">Sign out</a>
            </div>
          </div>
        </div>
      </nav>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Sahamati</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' }
          }
        }
      }
    }
  </script>
  <style>
    .markdown-body h1 { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
    .markdown-body h2 { font-size: 1.25rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
    .markdown-body h3 { font-size: 1.125rem; font-weight: 600; margin: 1rem 0 0.5rem; }
    .markdown-body p { margin: 0.5rem 0; line-height: 1.625; }
    .markdown-body ul, .markdown-body ol { margin: 0.5rem 0; padding-left: 1.5rem; }
    .markdown-body ul { list-style: disc; }
    .markdown-body ol { list-style: decimal; }
    .markdown-body li { margin: 0.25rem 0; }
    .markdown-body code { background: #f3f4f6; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875rem; }
    .markdown-body pre { background: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }
    .markdown-body pre code { background: none; padding: 0; color: inherit; }
    .markdown-body table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
    .markdown-body th, .markdown-body td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; }
    .markdown-body th { background: #f9fafb; font-weight: 600; }
    .markdown-body blockquote { border-left: 3px solid #6366f1; padding-left: 1rem; margin: 0.75rem 0; color: #6b7280; }
    .markdown-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  ${nav}
  ${body}
</body>
</html>`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    "in-progress": "bg-blue-100 text-blue-700",
    completed: "bg-indigo-100 text-indigo-700",
    "not-started": "bg-gray-100 text-gray-600",
    "on-hold": "bg-yellow-100 text-yellow-700",
    skipped: "bg-gray-100 text-gray-400",
  };
  const cls = colors[status] || "bg-gray-100 text-gray-600";
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}">${escapeHtml(status)}</span>`;
}
