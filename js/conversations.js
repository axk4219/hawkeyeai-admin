/* ============================================================
   Hawk Eye AI Dashboard - Live Conversations Module
   ============================================================ */

(function() {
  'use strict';

  // --- State ---
  var sessions = [];
  var activeSessionId = null;
  var activeFilter = 'all';
  var searchQuery = '';
  var realtimeChannel = null;

  // --- DOM refs ---
  var sessionListEl = document.getElementById('sessionList');
  var chatPanel = document.getElementById('chatPanel');
  var emptyMain = document.getElementById('emptyMain');
  var chatMessages = document.getElementById('chatMessages');
  var chatSiteBadge = document.getElementById('chatSiteBadge');
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
    var session = await Auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return;
    }

    document.getElementById('navUserEmail').textContent = session.user.email;
    document.getElementById('logoutBtn').addEventListener('click', Auth.signOut);

    document.getElementById('pageLoading').classList.add('hidden');
    document.getElementById('conversationsContent').classList.remove('hidden');

    bindEvents();
    await loadSessions();
    subscribeRealtime();
  }

  // --- Events ---
  function bindEvents() {
    // Filter tabs
    var filters = document.querySelectorAll('.conv-filter');
    for (var i = 0; i < filters.length; i++) {
      filters[i].addEventListener('click', function() {
        for (var j = 0; j < filters.length; j++) filters[j].classList.remove('active');
        this.classList.add('active');
        activeFilter = this.getAttribute('data-filter');
        renderSessionList();
      });
    }

    // Search
    sessionSearch.addEventListener('input', function() {
      searchQuery = this.value.toLowerCase();
      renderSessionList();
    });

    // Reply
    sendReplyBtn.addEventListener('click', sendReply);
    replyInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
    });

    // Take Over / Hand Back
    takeOverBtn.addEventListener('click', function() { setMode('human'); });
    handBackBtn.addEventListener('click', function() { setMode('ai'); });

    // Delete conversation
    deleteConvBtn.addEventListener('click', deleteConversation);
  }

  // --- Load Sessions ---
  async function loadSessions() {
    var result = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('status', 'active')
      .order('last_message_at', { ascending: false });

    if (result.data) {
      sessions = result.data;
      updateStats();
      renderSessionList();
    }
  }

  // --- Update Stats ---
  function updateStats() {
    var filtered = getFilteredSessions();
    statActive.textContent = filtered.length;
    statHuman.textContent = filtered.filter(function(s) { return s.mode === 'human'; }).length;
  }

  // --- Filter Sessions ---
  function getFilteredSessions() {
    return sessions.filter(function(s) {
      if (activeFilter !== 'all' && s.site !== activeFilter) return false;
      if (searchQuery && s.session_id.toLowerCase().indexOf(searchQuery) === -1
          && (!s.last_message_preview || s.last_message_preview.toLowerCase().indexOf(searchQuery) === -1)) {
        return false;
      }
      return true;
    });
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
      var siteClass = s.site === 'home-services' ? 'conv-session-site--home' : 'conv-session-site--hosp';
      var siteLabel = s.site === 'home-services' ? 'Home Services' : 'Hospitality';
      var modeClass = s.mode === 'human' ? 'conv-session-mode--human' : 'conv-session-mode--ai';
      var modeLabel = s.mode === 'human' ? 'Human' : 'AI';
      var timeAgo = formatTimeAgo(s.last_message_at);
      var preview = s.last_message_preview || 'No messages yet';

      html +=
        '<div class="conv-session' + (isActive ? ' active' : '') + '" data-session="' + s.session_id + '">' +
          '<div class="conv-session-dot ' + dotClass + '"></div>' +
          '<div class="conv-session-body">' +
            '<div class="conv-session-top">' +
              '<span class="conv-session-site ' + siteClass + '">' + siteLabel + '</span>' +
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

    // Bind click events
    var items = sessionListEl.querySelectorAll('.conv-session');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        selectSession(this.getAttribute('data-session'));
      });
    }
  }

  // --- Select Session ---
  async function selectSession(sessionId) {
    activeSessionId = sessionId;
    renderSessionList();

    emptyMain.classList.add('hidden');
    chatPanel.classList.remove('hidden');

    // Find session data
    var session = sessions.find(function(s) { return s.session_id === sessionId; });
    if (!session) return;

    // Update header
    var siteLabel = session.site === 'home-services' ? 'Home Services' : 'Hospitality';
    var siteBadgeClass = session.site === 'home-services' ? 'badge-cyan' : 'badge-magenta';
    chatSiteBadge.textContent = siteLabel;
    chatSiteBadge.className = 'badge ' + siteBadgeClass;
    chatSessionId.textContent = sessionId.length > 25 ? sessionId.slice(0, 25) + '...' : sessionId;
    updateModeUI(session.mode);

    // Load transcript
    await loadTranscript(sessionId);
  }

  // --- Load Transcript ---
  async function loadTranscript(sessionId) {
    var result = await supabase
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

  // --- Append Message ---
  function appendMessage(msg) {
    var div = document.createElement('div');
    var roleClass = 'conv-msg--' + msg.role;
    div.className = 'conv-msg ' + roleClass;
    div.setAttribute('data-id', msg.id);

    var label = msg.role === 'user' ? 'Customer' : msg.role === 'admin' ? 'You' : 'AI Assistant';
    var time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML =
      '<span class="conv-msg-label">' + label + '</span>' +
      escapeHtml(msg.content) +
      '<span class="conv-msg-time">' + time + '</span>';

    chatMessages.appendChild(div);
  }

  // --- Send Reply ---
  async function sendReply() {
    var text = replyInput.value.trim();
    if (!text || !activeSessionId) return;

    replyInput.value = '';
    sendReplyBtn.disabled = true;

    // Insert message as admin with delivered=false
    var result = await supabase
      .from('chat_messages')
      .insert({
        session_id: activeSessionId,
        role: 'admin',
        content: text,
        delivered: false,
      })
      .select();

    if (result.data && result.data.length > 0) {
      appendMessage(result.data[0]);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    sendReplyBtn.disabled = false;
    replyInput.focus();
  }

  // --- Delete Conversation ---
  async function deleteConversation() {
    if (!activeSessionId) return;
    if (!confirm('Delete this conversation? This cannot be undone.')) return;

    // Delete messages first (cascade should handle this, but be explicit)
    await supabase
      .from('chat_messages')
      .delete()
      .eq('session_id', activeSessionId);

    await supabase
      .from('chat_sessions')
      .delete()
      .eq('session_id', activeSessionId);

    // Remove from local state
    sessions = sessions.filter(function(s) { return s.session_id !== activeSessionId; });
    activeSessionId = null;

    // Reset UI
    chatPanel.classList.add('hidden');
    emptyMain.classList.remove('hidden');
    renderSessionList();
    updateStats();
  }

  // --- Set Mode (Take Over / Hand Back) ---
  async function setMode(mode) {
    if (!activeSessionId) return;

    await supabase
      .from('chat_sessions')
      .update({ mode: mode, updated_at: new Date().toISOString() })
      .eq('session_id', activeSessionId);

    // Update local state
    var session = sessions.find(function(s) { return s.session_id === activeSessionId; });
    if (session) session.mode = mode;

    updateModeUI(mode);
    renderSessionList();
    updateStats();
  }

  // --- Update Mode UI ---
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

  // --- Realtime Subscriptions ---
  function subscribeRealtime() {
    if (!supabase) return;

    realtimeChannel = supabase
      .channel('chat-realtime')
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

    // Update session list preview
    var session = sessions.find(function(s) { return s.session_id === msg.session_id; });
    if (session) {
      session.last_message_at = msg.created_at;
      if (msg.role === 'user') {
        session.last_message_preview = msg.content.slice(0, 200);
        session.message_count = (session.message_count || 0) + 1;
      }
      // Re-sort sessions
      sessions.sort(function(a, b) {
        return new Date(b.last_message_at) - new Date(a.last_message_at);
      });
      renderSessionList();
      updateStats();
    }

    // If this message belongs to the active conversation, show it
    if (msg.session_id === activeSessionId) {
      // Avoid duplicates (we already appended admin messages on send)
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
    var idx = sessions.findIndex(function(s) { return s.session_id === updated.session_id; });
    if (idx !== -1) {
      sessions[idx] = Object.assign(sessions[idx], updated);
      renderSessionList();
      updateStats();

      // Update chat panel if this is the active session
      if (updated.session_id === activeSessionId) {
        updateModeUI(updated.mode);
      }
    }
  }

  function handleNewSession(payload) {
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

  // --- Start ---
  init();

})();
