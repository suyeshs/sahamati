/**
 * Dashboard page — project list with visibility awareness
 */
import { layout, escapeHtml, formatDate, statusBadge } from "./layout";

type User = { email: string; name: string; picture: string; globalRole?: string };

export function dashboardPage(user: User, projects: Record<string, unknown>[]): string {
  const isAdmin = user.globalRole === "admin";
  const myProjects = projects.filter((p) => p.user_role);
  const browseProjects = projects.filter((p) => !p.user_role);

  const projectCard = (p: Record<string, unknown>) => {
    const visibility = String(p.visibility || "private");
    const visIcon: Record<string, string> = {
      private: `<svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>`,
      internal: `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`,
      public: `<svg class="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
    };
    const roleLabel = p.user_role ? `<span class="text-xs text-indigo-500 font-medium">${escapeHtml(String(p.user_role))}</span>` : "";

    return `
    <a href="/portal/projects/${escapeHtml(String(p.slug))}" class="block bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md hover:border-indigo-200 transition-all">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-2">
          ${visIcon[visibility] || visIcon.private}
          <h3 class="font-semibold text-gray-900">${escapeHtml(String(p.name))}</h3>
        </div>
        <div class="flex items-center gap-2">
          ${roleLabel}
          ${statusBadge(String(p.status))}
        </div>
      </div>
      ${p.description ? `<p class="text-sm text-gray-500 mb-4 line-clamp-2">${escapeHtml(String(p.description))}</p>` : '<p class="text-sm text-gray-400 mb-4 italic">No description</p>'}
      <div class="flex items-center gap-4 text-xs text-gray-400">
        <span>${p.member_count} members</span>
        <span>${p.phase_count} phases</span>
        <span>${p.doc_count} docs</span>
        <span class="ml-auto">${formatDate(String(p.updated_at))}</span>
      </div>
    </a>`;
  };

  const mySection = myProjects.length
    ? myProjects.map(projectCard).join("")
    : `<div class="col-span-full text-center py-12">
        <div class="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg class="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
        </div>
        <p class="text-gray-500">You're not a member of any projects yet</p>
        <p class="text-sm text-gray-400 mt-1">Ask a project admin to add you, or browse shared projects below.</p>
      </div>`;

  const browseSection = browseProjects.length
    ? `<div class="mt-10">
        <h2 class="text-lg font-semibold text-gray-900 mb-1">Shared Projects</h2>
        <p class="text-sm text-gray-400 mb-4">Projects shared within the organization or publicly</p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${browseProjects.map(projectCard).join("")}
        </div>
      </div>`
    : "";

  const adminSection = isAdmin ? renderAdminPanel() : "";

  return layout(
    "Dashboard",
    user,
    `<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-gray-900">Projects</h1>
        <p class="text-gray-500 mt-1">Your projects and shared workspaces</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${mySection}
      </div>
      ${browseSection}
      ${adminSection}
    </main>`
  );
}

function renderAdminPanel(): string {
  return `
  <details class="mt-10 bg-white rounded-xl border border-gray-200" id="admin-whitelist">
    <summary class="cursor-pointer select-none px-6 py-4 flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">Whitelist</h2>
        <p class="text-sm text-gray-400">Emails allowed to sign in to the portal (admin only)</p>
      </div>
      <span class="text-xs text-gray-400">Click to expand</span>
    </summary>
    <div class="border-t border-gray-100 px-6 py-5">
      <form id="wl-add-form" class="flex flex-col sm:flex-row gap-2 mb-5">
        <input id="wl-email" type="email" required placeholder="user@sahamati.org.in"
          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input id="wl-note" type="text" placeholder="note (optional)"
          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button type="submit"
          class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
          Add
        </button>
      </form>
      <div id="wl-error" class="hidden mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700"></div>
      <div id="wl-list" class="text-sm text-gray-500">Loading…</div>
    </div>
  </details>
  <script>
  (function(){
    const list = document.getElementById('wl-list');
    const form = document.getElementById('wl-add-form');
    const emailInput = document.getElementById('wl-email');
    const noteInput = document.getElementById('wl-note');
    const errBox = document.getElementById('wl-error');

    function showError(msg){
      errBox.textContent = msg;
      errBox.classList.remove('hidden');
      setTimeout(() => errBox.classList.add('hidden'), 5000);
    }

    function escape(s){
      return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    async function load(){
      list.textContent = 'Loading…';
      const res = await fetch('/api/admin/allowed-emails', { credentials: 'same-origin' });
      if (!res.ok) {
        list.textContent = 'Failed to load whitelist (status ' + res.status + ').';
        return;
      }
      const { allowedEmails } = await res.json();
      if (!allowedEmails.length) {
        list.innerHTML = '<p class="text-gray-400 italic">No emails whitelisted yet.</p>';
        return;
      }
      list.innerHTML = '<table class="w-full text-left">'
        + '<thead><tr class="text-xs text-gray-400 uppercase">'
        + '<th class="py-2 pr-4">Email</th>'
        + '<th class="py-2 pr-4">Added by</th>'
        + '<th class="py-2 pr-4">Note</th>'
        + '<th class="py-2"></th>'
        + '</tr></thead><tbody>'
        + allowedEmails.map(e =>
            '<tr class="border-t border-gray-100">'
            + '<td class="py-2 pr-4 font-mono text-xs">' + escape(e.email) + '</td>'
            + '<td class="py-2 pr-4 text-gray-500 text-xs">' + escape(e.added_by || '') + '</td>'
            + '<td class="py-2 pr-4 text-gray-500 text-xs">' + escape(e.note || '') + '</td>'
            + '<td class="py-2 text-right">'
            + '<button data-email="' + escape(e.email) + '" class="wl-remove text-xs text-red-600 hover:underline">Remove</button>'
            + '</td></tr>'
          ).join('')
        + '</tbody></table>';
      list.querySelectorAll('.wl-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          const email = btn.getAttribute('data-email');
          if (!confirm('Remove ' + email + ' from the whitelist?')) return;
          const res = await fetch('/api/admin/allowed-emails/' + encodeURIComponent(email), {
            method: 'DELETE', credentials: 'same-origin'
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            showError(body.error || 'Remove failed');
            return;
          }
          load();
        });
      });
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const res = await fetch('/api/admin/allowed-emails', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.value.trim(), note: noteInput.value.trim() || undefined })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showError(body.error || 'Add failed');
        return;
      }
      emailInput.value = '';
      noteInput.value = '';
      load();
    });

    document.getElementById('admin-whitelist').addEventListener('toggle', (ev) => {
      if (ev.target.open && list.textContent === 'Loading…') load();
    });
  })();
  </script>`;
}
