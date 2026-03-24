/* ============================================================
   Hawk Eye AI Dashboard - Dashboard Logic
   Fetches data from Supabase, renders UI, handles actions
   ============================================================ */

// ---- n8n Webhook URLs (configure after setting up n8n) ----
const N8N_APPROVE_WEBHOOK = 'https://n8n.srv1426838.hstgr.cloud/webhook/approve-blog-post';
const N8N_REJECT_WEBHOOK = 'https://n8n.srv1426838.hstgr.cloud/webhook/approve-blog-post';

// ---- State ----
let gapData = [];
let draftPosts = [];
let publishedPosts = [];
let currentSort = { column: 'priority_score', ascending: false };

// ---- Initialization ----
(async function initDashboard() {
  // Wait for auth
  const session = await Auth.getSession();
  if (!session) return;

  await loadAllData();
  initFilters();
  initSorting();
  initModal();
})();

// ---- Data Loading ----
async function loadAllData() {
  try {
    const [gaps, drafts, published] = await Promise.all([
      fetchGapAnalysis(),
      fetchDraftPosts(),
      fetchPublishedPosts(),
    ]);

    gapData = gaps;
    draftPosts = drafts;
    publishedPosts = published;

    renderGapStats();
    renderGapTable();
    renderApprovalQueue();
    renderPublishedTable();
    populateCategoryFilter();
  } catch (err) {
    console.error('Failed to load data:', err);
    showToast('Failed to load dashboard data. Check console for details.', 'error');
  }
}

async function fetchGapAnalysis() {
  // Delete any gaps older than today so they don't accumulate
  await deleteOldGaps();

  // Only fetch today's gaps, capped at 8, sorted by priority
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('gap_analysis')
    .select('*')
    .in('status', ['researched', 'identified'])
    .gte('created_at', todayStart.toISOString())
    .order('priority_score', { ascending: false })
    .limit(8);

  if (error) throw error;
  return data || [];
}

async function deleteOldGaps() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Delete gaps older than today that are still in researched/identified status
  // Uses service role key because there is no DELETE RLS policy on gap_analysis
  const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkb2dsZ2dxdnRkemp0aXJ1b21xIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc1OTk4NCwiZXhwIjoyMDg4MzM1OTg0fQ.cQYEAKg4nmw6C3mrZsU-eU00vnFsXyir9vpPnZIPMr8';
  const cutoff = todayStart.toISOString();

  try {
    const resp = await fetch(
      SUPABASE_URL + '/rest/v1/gap_analysis?created_at=lt.' + encodeURIComponent(cutoff) + '&status=in.(researched,identified,archived)',
      {
        method: 'DELETE',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Prefer': 'return=minimal'
        }
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.warn('Failed to delete old gaps:', body);
    }
  } catch (err) {
    console.warn('Failed to delete old gaps:', err);
  }
}

async function fetchDraftPosts() {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('status', 'drafted')
    .order('drafted_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function fetchPublishedPosts() {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ---- Gap Analysis Rendering ----
function renderGapStats() {
  const total = gapData.length;
  const high = gapData.filter(g => g.priority_score >= 8).length;
  const medium = gapData.filter(g => g.priority_score >= 5 && g.priority_score < 8).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statHigh').textContent = high;
  document.getElementById('statMedium').textContent = medium;

  // Last research date
  const lastDateEl = document.getElementById('statLastDate');
  if (gapData.length > 0) {
    const dates = gapData.map(g => new Date(g.created_at));
    const latest = new Date(Math.max(...dates));
    lastDateEl.textContent = formatDateShort(latest);
    lastDateEl.style.fontSize = '1.2rem';
  } else {
    lastDateEl.textContent = '-';
  }
}

function renderGapTable() {
  const tbody = document.getElementById('gapTableBody');
  const emptyState = document.getElementById('gapEmpty');
  const tableWrapper = tbody.closest('.table-wrapper');

  const filtered = getFilteredGaps();
  const sorted = sortData(filtered, currentSort.column, currentSort.ascending);

  if (sorted.length === 0) {
    tableWrapper.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  tableWrapper.classList.remove('hidden');
  emptyState.classList.add('hidden');

  tbody.innerHTML = sorted.map(gap => `
    <tr>
      <td>
        <span class="priority-badge ${getPriorityClass(gap.priority_score)}">${gap.priority_score}</span>
      </td>
      <td>
        <span class="site-badge site-badge--${gap.site}">${gap.site === 'main' ? 'Main' : 'Hosp.'}</span>
      </td>
      <td class="headline-cell">${escapeHtml(gap.headline)}</td>
      <td><span class="badge badge-blue">${escapeHtml(gap.category)}</span></td>
      <td><span class="badge ${getVolumeBadge(gap.search_volume_tier)}">${gap.search_volume_tier}</span></td>
      <td>
        <div class="keywords-cell">
          ${(gap.keywords || []).slice(0, 4).map(k => `<span class="keyword-tag">${escapeHtml(k)}</span>`).join('')}
          ${(gap.keywords || []).length > 4 ? `<span class="keyword-tag">+${gap.keywords.length - 4}</span>` : ''}
        </div>
      </td>
      <td class="rationale-cell">${escapeHtml(gap.gap_rationale || '')}</td>
    </tr>
  `).join('');
}

// ---- Approval Queue Rendering ----
function renderApprovalQueue() {
  const mainPosts = draftPosts.filter(p => p.site === 'main');
  const hospPosts = draftPosts.filter(p => p.site === 'hospitality');

  renderApprovalSection('main', mainPosts);
  renderApprovalSection('hospitality', hospPosts);
}

function renderApprovalSection(site, posts) {
  const gridId = site === 'main' ? 'mainApprovalGrid' : 'hospitalityApprovalGrid';
  const emptyId = site === 'main' ? 'mainApprovalEmpty' : 'hospitalityApprovalEmpty';
  const countId = site === 'main' ? 'mainDraftCount' : 'hospitalityDraftCount';

  const grid = document.getElementById(gridId);
  const empty = document.getElementById(emptyId);
  const countEl = document.getElementById(countId);

  countEl.textContent = posts.length;

  if (posts.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  empty.classList.add('hidden');

  grid.innerHTML = posts.map(post => `
    <div class="approval-card" data-post-id="${post.id}">
      <div class="approval-card-header">
        <div>
          <div class="approval-card-title">${escapeHtml(post.title)}</div>
          <div class="approval-card-meta mt-1">
            <span class="badge badge-blue">${escapeHtml(post.category)}</span>
            <span class="meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
              ${escapeHtml(post.read_time || '-')}
            </span>
            <span class="meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              ${post.word_count ? post.word_count.toLocaleString() + ' words' : '-'}
            </span>
          </div>
        </div>
        ${post.seo_score ? `<span class="seo-score ${getSeoScoreClass(post.seo_score)}">SEO ${post.seo_score}/10</span>` : ''}
      </div>

      <div class="approval-card-meta">
        <span class="meta-item text-muted">Drafted ${formatDate(post.drafted_at)}</span>
      </div>

      <div class="approval-card-actions">
        <button class="btn btn-outline btn-small" onclick="previewPost('${post.id}')">Preview</button>
        <button class="btn btn-primary btn-small" onclick="approvePost('${post.id}')">Approve</button>
        <button class="btn btn-danger btn-small" onclick="openRejectModal('${post.id}')">Reject</button>
      </div>
    </div>
  `).join('');
}

// ---- Published Posts Rendering ----
function renderPublishedTable() {
  const tbody = document.getElementById('publishedTableBody');
  const empty = document.getElementById('publishedEmpty');
  const countEl = document.getElementById('publishedCount');
  const tableWrapper = tbody.closest('.table-wrapper');

  countEl.textContent = publishedPosts.length;

  if (publishedPosts.length === 0) {
    tableWrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  tableWrapper.classList.remove('hidden');
  empty.classList.add('hidden');

  tbody.innerHTML = publishedPosts.map(post => `
    <tr>
      <td class="title-cell">${escapeHtml(post.title)}</td>
      <td><span class="site-badge site-badge--${post.site}">${post.site === 'main' ? 'Main' : 'Hospitality'}</span></td>
      <td><span class="badge badge-blue">${escapeHtml(post.category)}</span></td>
      <td>${formatDate(post.published_at)}</td>
      <td>${post.word_count ? post.word_count.toLocaleString() : '-'}</td>
      <td>${post.seo_score ? `<span class="seo-score ${getSeoScoreClass(post.seo_score)}">${post.seo_score}/10</span>` : '-'}</td>
      <td><button class="btn btn-danger btn-small" onclick="deletePost('${post.id}', '${escapeHtml(post.title).replace(/'/g, "\\'")}')">Delete</button></td>
    </tr>
  `).join('');
}

// ---- Actions ----
async function approvePost(postId) {
  const btn = document.querySelector(`[data-post-id="${postId}"] .btn-primary`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Approving...';
  }

  try {
    // Update status in Supabase
    const { error } = await supabase
      .from('blog_posts')
      .update({ status: 'approved' })
      .eq('id', postId);

    if (error) throw error;

    // n8n auto-publisher polls Supabase every minute for approved posts
    // No need to call webhook directly (avoids CORS issues)

    showToast('Post approved! It will be published within 1 minute.', 'success');

    // Refresh data
    await loadAllData();
  } catch (err) {
    console.error('Approve failed:', err);
    showToast('Failed to approve post: ' + err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Approve';
    }
  }
}

function previewPost(postId) {
  const post = draftPosts.find(p => p.id === postId);
  if (!post) return;

  // If preview_url exists, open it
  if (post.preview_url) {
    window.open(post.preview_url, '_blank');
    return;
  }

  // Otherwise, render body_html in a new tab
  if (post.body_html) {
    const previewWindow = window.open('', '_blank');
    previewWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Preview: ${escapeHtml(post.title)}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
        <style>
          :root{--bg-primary:#0A0A0F;--text-primary:#F0F0F5;--text-secondary:#A0A0B5;--neon-cyan:#00FFFF;--neon-magenta:#FF00FF}
          body{font-family:'Inter',sans-serif;background:var(--bg-primary);color:var(--text-secondary);max-width:800px;margin:0 auto;padding:2rem;line-height:1.7}
          h1,h2,h3{font-family:'Space Grotesk',sans-serif;color:var(--text-primary)}
          h1{font-size:2rem;margin-bottom:1rem}
          h2{font-size:1.4rem;margin-top:2rem;margin-bottom:0.75rem;color:var(--neon-cyan)}
          h3{font-size:1.1rem;margin-top:1.5rem;margin-bottom:0.5rem}
          a{color:var(--neon-cyan)}
          blockquote{border-left:3px solid var(--neon-cyan);margin:1.5rem 0;padding:1rem 1.5rem;background:rgba(0,255,255,0.05);border-radius:0 8px 8px 0}
          ul,ol{padding-left:1.5rem}
          li{margin-bottom:0.5rem}
          .preview-banner{background:rgba(255,0,255,0.1);border:1px solid rgba(255,0,255,0.3);padding:0.75rem 1rem;border-radius:8px;margin-bottom:2rem;font-size:0.85rem;color:var(--neon-magenta);text-align:center}
        </style>
      </head>
      <body>
        <div class="preview-banner">PREVIEW MODE — This post has not been published yet</div>
        <h1>${escapeHtml(post.title)}</h1>
        <p style="color:#606075;font-size:0.9rem;margin-bottom:2rem">${escapeHtml(post.category)} &middot; ${escapeHtml(post.read_time || '')} &middot; ${post.word_count ? post.word_count.toLocaleString() + ' words' : ''}</p>
        ${post.body_html}
      </body>
      </html>
    `);
    previewWindow.document.close();
  } else {
    showToast('No preview content available for this post.', 'error');
  }
}

// ---- Delete Post ----
async function deletePost(postId, postTitle) {
  if (!confirm('Delete "' + postTitle + '"?\n\nThis will remove it from the database. The blog file on GitHub will remain until manually removed.')) {
    return;
  }

  try {
    // Use service role key for delete (RLS doesn't allow DELETE via anon/authenticated by default)
    const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkb2dsZ2dxdnRkemp0aXJ1b21xIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mjc1OTk4NCwiZXhwIjoyMDg4MzM1OTg0fQ.cQYEAKg4nmw6C3mrZsU-eU00vnFsXyir9vpPnZIPMr8';
    const resp = await fetch(
      SUPABASE_URL + '/rest/v1/blog_posts?id=eq.' + postId,
      {
        method: 'DELETE',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Prefer': 'return=minimal'
        }
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(body);
    }

    showToast('Post deleted.', 'success');
    await loadAllData();
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('Failed to delete post: ' + err.message, 'error');
  }
}

// ---- Reject Modal ----
function initModal() {
  const overlay = document.getElementById('rejectModal');
  const cancelBtn = document.getElementById('rejectCancel');
  const confirmBtn = document.getElementById('rejectConfirm');

  cancelBtn.addEventListener('click', closeRejectModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeRejectModal();
  });

  confirmBtn.addEventListener('click', async () => {
    const postId = document.getElementById('rejectPostId').value;
    const notes = document.getElementById('rejectNotes').value.trim();

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Rejecting...';

    try {
      const { error } = await supabase
        .from('blog_posts')
        .update({
          status: 'rejected',
          reviewer_notes: notes || null,
        })
        .eq('id', postId);

      if (error) throw error;

      // Optionally trigger n8n webhook
      if (N8N_REJECT_WEBHOOK && N8N_REJECT_WEBHOOK !== 'YOUR_N8N_REJECT_WEBHOOK_URL') {
        await fetch(N8N_REJECT_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: postId, action: 'reject', notes }),
        }).catch(err => console.warn('Webhook failed (non-blocking):', err));
      }

      showToast('Post rejected.', 'success');
      closeRejectModal();
      await loadAllData();
    } catch (err) {
      console.error('Reject failed:', err);
      showToast('Failed to reject post: ' + err.message, 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Reject Post';
    }
  });
}

function openRejectModal(postId) {
  document.getElementById('rejectPostId').value = postId;
  document.getElementById('rejectNotes').value = '';
  document.getElementById('rejectModal').classList.add('active');
}

function closeRejectModal() {
  document.getElementById('rejectModal').classList.remove('active');
}

// ---- Filters ----
function initFilters() {
  ['filterSite', 'filterPriority', 'filterCategory', 'filterVolume'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderGapTable);
  });
}

function populateCategoryFilter() {
  const categories = [...new Set(gapData.map(g => g.category))].sort();
  const select = document.getElementById('filterCategory');
  // Keep "All Categories" option, remove the rest
  select.innerHTML = '<option value="all">All Categories</option>';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

function getFilteredGaps() {
  const site = document.getElementById('filterSite').value;
  const priority = document.getElementById('filterPriority').value;
  const category = document.getElementById('filterCategory').value;
  const volume = document.getElementById('filterVolume').value;

  return gapData.filter(g => {
    if (site !== 'all' && g.site !== site) return false;
    if (priority === 'high' && g.priority_score < 8) return false;
    if (priority === 'medium' && (g.priority_score < 5 || g.priority_score >= 8)) return false;
    if (priority === 'low' && g.priority_score >= 5) return false;
    if (category !== 'all' && g.category !== category) return false;
    if (volume !== 'all' && g.search_volume_tier !== volume) return false;
    return true;
  });
}

// ---- Sorting ----
function initSorting() {
  document.querySelectorAll('.gap-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (currentSort.column === col) {
        currentSort.ascending = !currentSort.ascending;
      } else {
        currentSort.column = col;
        currentSort.ascending = col === 'headline' || col === 'category'; // Text cols default ascending
      }

      // Update sort indicators
      document.querySelectorAll('.gap-table thead th').forEach(h => h.classList.remove('sorted'));
      th.classList.add('sorted');
      th.querySelector('.sort-icon').textContent = currentSort.ascending ? '\u25B2' : '\u25BC';

      renderGapTable();
    });
  });
}

function sortData(data, column, ascending) {
  return [...data].sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return ascending ? -1 : 1;
    if (valA > valB) return ascending ? 1 : -1;
    return 0;
  });
}

// ---- Toast ----
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast--${type} active`;

  setTimeout(() => {
    toast.classList.remove('active');
  }, 4000);
}

// ---- Helpers ----
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getPriorityClass(score) {
  if (score >= 8) return 'priority-high';
  if (score >= 5) return 'priority-medium';
  return 'priority-low';
}

function getVolumeBadge(tier) {
  if (tier === 'high') return 'badge-cyan';
  if (tier === 'medium') return 'badge-yellow';
  return 'badge-dim';
}

function getSeoScoreClass(score) {
  if (score >= 8) return 'seo-score--good';
  if (score >= 5) return 'seo-score--ok';
  return 'seo-score--bad';
}
