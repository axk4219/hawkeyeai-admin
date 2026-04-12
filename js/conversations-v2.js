/* ============================================================
   Hawk Eye AI Dashboard — RAG Bot Conversations (v2)
   Reads from luhnod Supabase project (separate from ddog).
   Writes go through the CF Worker /admin endpoints.
   ============================================================ */

(function() {
  'use strict';

  // --- Config ---
  var LUHNOD_URL = 'https://luhnodlfnxbkaoxuwijx.supabase.co';
  var LUHNOD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1aG5vZGxmbnhia2FveHV3aWp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0Nzc4MzAsImV4cCI6MjA4ODA1MzgzMH0.zIRnKMe2G5L9XnqKZAvJzZ5Qez3Rtlcw1MRdBc6Zcw0';
  var WORKER_URL = 'https://hawkeye-rag-chatbot.anthony-419.workers.dev';
  var ADMIN_TOKEN = '84b03a7051b522284747067304a3e25e6814f4bfc29c5558a4c3d5cdf221ed70';
  var SITE_TAG = 'hawkeye-main';

  // --- State ---
  var sessions = [];
  var activeSessionId = null;
  var activeFilter = 'all';
  var searchQuery = '';
  var realtimeChannel = null;
  var luhnodClient = null;

  // --- DOM refs ---
  var sessionListEl = document.getElementById('sessionList');
  var chatPanel = document.getElementById('chatPanel');
  var emptyMain = document.getElementById('emptyMain');
  var chatMessages = document.getElementById('chatMessages');
  var chatVerticalBadge = document.getElementById('chatVerticalBadge');
  var chatSessionId = document.getElementById('chatSessionId');
  var chatModeBadge = document.getElementById('chatModeBadge');
  var takeOverBtn = document.getElementById('takeOverBtn');
  var handBackBtn = document.getElementById('handBackBtn');
  var replyInput = document.getElementById('replyInput');
  var sendReplyBtn = document.getElementById('sendReplyBtn');
  var sessionSearch = document.getElementById('sessionSearch');
  var statActive = document.getElementById('statActive');
  var statHuman = document.getElementById('statHuman');
  var deleteConvBtn = document.getElementById('deleteConvBtn');

  // --- Init ---
  async function init() {
    // Gate access via ddog Supabase auth (existing admin portal login)
    var session = await Auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return;
    }

    document.getElementById('navUserEmail').textContent = session.user.email;
    document.getElementById('logoutBtn').addEventListener('click', Auth.signOut);

    // Initialize SEPARATE Supabase client for luhnod (chatbot project).
    // auth.js has overwritten window.supabase with a CLIENT instance for ddog,
    // so we use the SDK ref captured before auth.js loaded.
    try {
      var sdk = window._supabaseSdk || window.supabase;
      luhnodClient = sdk.createClient(LUHNOD_URL, LUHNOD_ANON_KEY);
    } catch (e) {
      console.error('Luhnod client init failed:', e);
    }

    document.getElementById('pageLoading').classList.add('hidden');
    document.getElementById('conversationsContent').classList.remove('hidden');

    bindEvents();
    await loadSessions();
    subscribeRealtime();
  }

  // --- Events ---
  function bindEvents() {
    var filters = document.querySelectorAll('.conv-filter');
    for (var i = 0; i < filters.length; i++) {
      filters[i].addEventListener('click', function() {
        for (var j = 0; j < filters.length; j++) filters[j].classList.remove('active');
        this.classList.add('active');
        activeFilter = this.getAttribute('data-filter');
        renderSessionList();
        updateStats();
      });
    }

    sessionSearch.addEventListener('input', function() {
      searchQuery = this.value.toLowerCase();
      renderSessionList();
    });

    sendReplyBtn.addEventListener('click', sendReply);
    replyInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
    });

    takeOverBtn.addEventListener('click', function() { setMode('human'); });
    handBackBtn.addEventListener('click', function() { setMode('ai'); });

    deleteConvBtn.addEventListener('click', deleteConversation);
  }

  // --- Worker admin API helpers ---
  function adminFetch(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers['Authorization'] = 'Bearer ' + ADMIN_TOKEN;
    headers['Content-Type'] = 'application/json';
    return fetch(WORKER_URL + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function(r) {
      if (!r.ok) throw new Error('Admin API ' + r.status);
      return r.json();
    });
  }

  // --- Load Sessions ---
  async function loadSessions() {
    if (!luhnodClient) return;
    var result = await luhnodClient
      .from('chat_sessions')
      .select('*')
      .eq('status', 'active')
      .eq('site', SITE_TAG)
      .order('last_message_at', { ascending: false });

    if (result.data) {
      sessions = result.data;
      updateStats();
      renderSessionList();
    } else if (result.error) {
      console.error('loadSessions error:', result.error);
    }
  }

  // --- Helpers ---
  function detectVertical(session) {
    if (session.vertical) return session.vertical;
    var preview = (session.last_message_preview || '').toLowerCase();
    if (/real estate|realtor|broker/.test(preview)) return 'real-estate';
    if (/healthcare|medical|patient|clinic/.test(preview)) return 'healthcare';
    if (/legal|law firm|attorney/.test(preview)) return 'legal';
    if (/ecommerce|shopify|store/.test(preview)) return 'ecommerce';
    return 'unknown';
  }

  function getFilteredSessions() {
    return sessions.filter(function(s) {
      if (activeFilter !== 'all' && detectVertical(s) !== activeFilter) return false;
      if (searchQuery) {
        var inSession = s.session_id.toLowerCase().indexOf(searchQuery) !== -1;
        var inPreview = s.last_message_preview && s.last_message_preview.toLowerCase().indexOf(searchQuery) !== -1;
        if (!inSession && !inPreview) return false;
      }
      return true;
    });
  }

  function updateStats() {
    var filtered = getFilteredSessions();
    statActive.textContent = filtered.length;
    statHuman.textContent = filtered.filter(function(s) { return s.mode === 'human'; }).length;
  }

  // --- Render Session List ---
  function renderSessionList() {
    var filtered = getFilteredSessions();

    if (filtered.length === 0) {
      sessionListEl.innerHTML =
        '<div class="empty-state">' +
          '<h3>No conversations</h3>' +
          '<p>No active conversations match your filter.</p>' +
        '</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var s = filtered[i];
      var isActive = s.session_id === activeSessionId;
      var dotClass = s.mode === 'human' ? 'conv-session-dot--human' : 'conv-session-dot--active';
      var vertical = detectVertical(s);
      var verticalLabel = verticalToLabel(vertical);
      var modeClass = s.mode === 'human' ? 'conv-session-mode--human' : 'conv-session-mode--ai';
      var modeLabel = s.mode === 'human' ? 'Human' : 'AI';
      var timeAgo = formatTimeAgo(s.last_message_at);
      var preview = s.last_message_preview || 'No messages yet';

      html +=
        '<div class="conv-session' + (isActive ? ' active' : '') + '" data-session="' + escapeAttr(s.session_id) + '">' +
          '<div class="conv-session-dot ' + dotClass + '"></div>' +
          '<div class="conv-session-body">' +
            '<div class="conv-session-top">' +
              '<span class="conv-session-site conv-session-site--home">' + verticalLabel + '</span>' +
              '<span class="conv-session-time">' + timeAgo + '</span>' +
            '</div>' +
            '<div class="conv-session-preview">' + escapeHtml(preview) + '</div>' +
            '<div class="conv-session-meta">' +
              '<span class="conv-session-count">' + (s.message_count || 0) + ' msgs</span>' +
              '<span class="conv-session-mode ' + modeClass + '">' + modeLabel + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    sessionListEl.innerHTML = html;

    var items = sessionListEl.querySelectorAll('.conv-session');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        selectSession(this.getAttribute('data-session'));
      });
    }
  }

  function verticalToLabel(v) {
    switch (v) {
      case 'real-estate': return 'Real Estate';
      case 'healthcare': return 'Healthcare';
      case 'legal': return 'Legal';
      case 'ecommerce': return 'E-commerce';
      case 'professional-services': return 'Pro Services';
      default: return 'Unknown';
    }
  }

  // --- Select Session ---
  async function selectSession(sessionId) {
    activeSessionId = sessionId;
    renderSessionList();

    emptyMain.classList.add('hidden');
    chatPanel.classList.remove('hidden');

    var session = sessions.find(function(s) { return s.session_id === sessionId; });
    if (!session) return;

    var vertical = detectVertical(session);
    chatVerticalBadge.textContent = verticalToLabel(vertical);
    chatVerticalBadge.className = 'badge badge-cyan';
    chatSessionId.textContent = sessionId.length > 25 ? sessionId.slice(0, 25) + '...' : sessionId;
    updateModeUI(session.mode);

    await loadTranscript(sessionId);
  }

  // --- Load Transcript ---
  async function loadTranscript(sessionId) {
    if (!luhnodClient) return;
    var result = await luhnodClient
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    chatMessages.innerHTML = '';

    if (!result.data || result.data.length === 0) {
      chatMessages.innerHTML = '<div class="empty-state"><p>No messages in this conversation yet.</p></div>';
      return;
    }

    for (var i = 0; i < result.data.length; i++) {
      appendMessage(result.data[i]);
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendMessage(msg) {
    var div = document.createElement('div');
    var roleClass = 'conv-msg--' + msg.role;
    div.className = 'conv-msg ' + roleClass;
    div.setAttribute('data-id', msg.id);

    var label = msg.role === 'user' ? 'Visitor' : msg.role === 'admin' ? 'You' : 'AI';
    var time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML =
      '<span class="conv-msg-label">' + label + '</span>' +
      escapeHtml(msg.content) +
      '<span class="conv-msg-time">' + time + '</span>';

    chatMessages.appendChild(div);
  }

  // --- Send Reply (via worker /admin endpoint) ---
  async function sendReply() {
    var text = replyInput.value.trim();
    if (!text || !activeSessionId) return;

    replyInput.value = '';
    sendReplyBtn.disabled = true;

    try {
      var result = await adminFetch('/admin/session/' + encodeURIComponent(activeSessionId) + '/reply', {
        method: 'POST',
        body: { content: text },
      });
      if (result.message) {
        appendMessage(result.message);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    } catch (e) {
      console.error('sendReply error:', e);
      alert('Failed to send reply. Check console.');
    }

    sendReplyBtn.disabled = false;
    replyInput.focus();
  }

  // --- Set Mode (Take Over / Hand Back) via worker ---
  async function setMode(mode) {
    if (!activeSessionId) return;

    try {
      var endpoint = mode === 'human' ? '/takeover' : '/handback';
      await adminFetch('/admin/session/' + encodeURIComponent(activeSessionId) + endpoint, {
        method: 'POST',
      });
      var session = sessions.find(function(s) { return s.session_id === activeSessionId; });
      if (session) session.mode = mode;
      updateModeUI(mode);
      renderSessionList();
      updateStats();
    } catch (e) {
      console.error('setMode error:', e);
      alert('Failed to change mode.');
    }
  }

  function updateModeUI(mode) {
    if (mode === 'human') {
      chatModeBadge.textContent = 'Human Mode';
      chatModeBadge.className = 'badge badge-yellow';
      takeOverBtn.classList.add('hidden');
      handBackBtn.classList.remove('hidden');
      replyInput.disabled = false;
      replyInput.placeholder = 'Type your reply...';
      sendReplyBtn.disabled = false;
    } else {
      chatModeBadge.textContent = 'AI Mode';
      chatModeBadge.className = 'badge badge-green';
      takeOverBtn.classList.remove('hidden');
      handBackBtn.classList.add('hidden');
      replyInput.disabled = true;
      replyInput.placeholder = 'Take over to reply...';
      sendReplyBtn.disabled = true;
    }
  }

  // --- Delete Conversation (via worker) ---
  async function deleteConversation() {
    if (!activeSessionId) return;
    if (!confirm('Delete this conversation? This cannot be undone.')) return;

    try {
      await adminFetch('/admin/session/' + encodeURIComponent(activeSessionId), { method: 'DELETE' });
      sessions = sessions.filter(function(s) { return s.session_id !== activeSessionId; });
      activeSessionId = null;
      chatPanel.classList.add('hidden');
      emptyMain.classList.remove('hidden');
      renderSessionList();
      updateStats();
    } catch (e) {
      console.error('delete error:', e);
      alert('Failed to delete.');
    }
  }

  // --- Realtime Subscriptions (via luhnod client) ---
  function subscribeRealtime() {
    if (!luhnodClient) return;

    realtimeChannel = luhnodClient
      .channel('rag-chat-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_messages',
      }, function(payload) {
        handleNewMessage(payload);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_sessions',
      }, function(payload) {
        handleSessionUpdate(payload);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_sessions',
      }, function(payload) {
        handleNewSession(payload);
      })
      .subscribe();
  }

  function handleNewMessage(payload) {
    if (payload.eventType !== 'INSERT') return;
    var msg = payload.new;

    var session = sessions.find(function(s) { return s.session_id === msg.session_id; });
    if (session) {
      session.last_message_at = msg.created_at;
      if (msg.role === 'user') {
        session.last_message_preview = msg.content.slice(0, 200);
        session.message_count = (session.message_count || 0) + 1;
      }
      sessions.sort(function(a, b) {
        return new Date(b.last_message_at) - new Date(a.last_message_at);
      });
      renderSessionList();
      updateStats();
    }

    if (msg.session_id === activeSessionId) {
      if (msg.role === 'admin') {
        var existing = chatMessages.querySelector('[data-id="' + msg.id + '"]');
        if (existing) return;
      }
      appendMessage(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  function handleSessionUpdate(payload) {
    var updated = payload.new;
    if (updated.site !== SITE_TAG) return;
    var idx = sessions.findIndex(function(s) { return s.session_id === updated.session_id; });
    if (idx !== -1) {
      sessions[idx] = Object.assign(sessions[idx], updated);
      renderSessionList();
      updateStats();
      if (updated.session_id === activeSessionId) {
        updateModeUI(updated.mode);
      }
    }
  }

  function handleNewSession(payload) {
    if (payload.new.site !== SITE_TAG) return;
    sessions.unshift(payload.new);
    renderSessionList();
    updateStats();
  }

  // --- Helpers ---
  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var now = new Date();
    var date = new Date(dateStr);
    var diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return String(text).replace(/"/g, '&quot;');
  }

  // --- Start ---
  init();

})();
