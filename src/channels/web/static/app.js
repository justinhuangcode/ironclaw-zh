// IronClaw Web Gateway - Client

let token = '';
let eventSource = null;
let logEventSource = null;
let currentTab = 'chat';
let currentThreadId = null;
let currentThreadIsReadOnly = false;
let assistantThreadId = null;
let hasMore = false;
let oldestTimestamp = null;
let loadingOlder = false;
let sseHasConnectedBefore = false;
let jobEvents = new Map(); // job_id -> Array of events
let jobListRefreshTimer = null;
let pairingPollInterval = null;
let unreadThreads = new Map(); // thread_id -> unread count
let _loadThreadsTimer = null;
const JOB_EVENTS_CAP = 500;
const MEMORY_SEARCH_QUERY_MAX_LENGTH = 100;

function t(key, vars) {
  if (window.i18n && typeof window.i18n.t === 'function') {
    return window.i18n.t(key, vars);
  }
  return key;
}

function activeLocale() {
  if (window.i18n && typeof window.i18n.getLocale === 'function') {
    return window.i18n.getLocale();
  }
  return 'en';
}

// --- Slash Commands ---

const SLASH_COMMANDS = [
  { cmd: '/status',     desc: 'Show all jobs, or /status <id> for one job', descKey: 'slash.status_desc' },
  { cmd: '/list',       desc: 'List all jobs', descKey: 'slash.list_desc' },
  { cmd: '/cancel',     desc: '/cancel <job-id> — cancel a running job', descKey: 'slash.cancel_desc' },
  { cmd: '/undo',       desc: 'Revert the last turn', descKey: 'slash.undo_desc' },
  { cmd: '/redo',       desc: 'Re-apply an undone turn', descKey: 'slash.redo_desc' },
  { cmd: '/compact',    desc: 'Compress the context window', descKey: 'slash.compact_desc' },
  { cmd: '/clear',      desc: 'Clear thread and start fresh', descKey: 'slash.clear_desc' },
  { cmd: '/interrupt',  desc: 'Stop the current turn', descKey: 'slash.interrupt_desc' },
  { cmd: '/heartbeat',  desc: 'Trigger manual heartbeat check', descKey: 'slash.heartbeat_desc' },
  { cmd: '/summarize',  desc: 'Summarize the current thread', descKey: 'slash.summarize_desc' },
  { cmd: '/suggest',    desc: 'Suggest next steps', descKey: 'slash.suggest_desc' },
  { cmd: '/help',       desc: 'Show help', descKey: 'slash.help_desc' },
  { cmd: '/version',    desc: 'Show version info', descKey: 'slash.version_desc' },
  { cmd: '/tools',      desc: 'List available tools', descKey: 'slash.tools_desc' },
  { cmd: '/skills',     desc: 'List installed skills', descKey: 'slash.skills_desc' },
  { cmd: '/model',      desc: 'Show or switch the LLM model', descKey: 'slash.model_desc' },
  { cmd: '/thread new', desc: 'Create a new conversation thread', descKey: 'slash.thread_new_desc' },
];

function localizeSlashCommands() {
  for (const item of SLASH_COMMANDS) {
    if (item.descKey) {
      item.desc = t(item.descKey);
    }
  }
}

let _slashSelected = -1;
let _slashMatches = [];

// --- Tool Activity State ---
let _activeGroup = null;
let _activeToolCards = {};
let _activityThinking = null;

// --- Auth ---

function authenticate() {
  token = document.getElementById('token-input').value.trim();
  if (!token) {
    document.getElementById('auth-error').textContent = t('error.token_required');
    return;
  }

  // Test the token against the health-ish endpoint (chat/threads requires auth)
  apiFetch('/api/chat/threads')
    .then(() => {
      sessionStorage.setItem('ironclaw_token', token);
      document.getElementById('auth-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      // Strip token and log_level from URL so they're not visible in the address bar
      const cleaned = new URL(window.location);
      const urlLogLevel = cleaned.searchParams.get('log_level');
      cleaned.searchParams.delete('token');
      cleaned.searchParams.delete('log_level');
      window.history.replaceState({}, '', cleaned.pathname + cleaned.search);
      connectSSE();
      connectLogSSE();
      startGatewayStatusPolling();
      checkTeeStatus();
      loadThreads();
      loadMemoryTree();
      loadJobs();
      // Apply URL log_level param if present, otherwise just sync the dropdown
      if (urlLogLevel) {
        setServerLogLevel(urlLogLevel);
      } else {
        loadServerLogLevel();
      }
    })
    .catch(() => {
      sessionStorage.removeItem('ironclaw_token');
      document.getElementById('auth-screen').style.display = '';
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-error').textContent = t('error.invalid_token');
    });
}

document.getElementById('token-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') authenticate();
});

// Auto-authenticate from URL param or saved session
function autoAuth() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    document.getElementById('token-input').value = urlToken;
    authenticate();
    return;
  }
  const saved = sessionStorage.getItem('ironclaw_token');
  if (saved) {
    document.getElementById('token-input').value = saved;
    // Hide auth screen immediately to prevent flash, authenticate() will
    // restore it if the token turns out to be invalid.
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    authenticate();
  }
}

async function boot() {
  if (window.i18n && typeof window.i18n.loadLocale === 'function') {
    await window.i18n.loadLocale(window.i18n.detectLocale());
    localizeSlashCommands();
    window.i18n.applyI18n(document);
  }
  autoAuth();
}

boot().catch((err) => {
  console.error('Failed to boot i18n', err);
  autoAuth();
});

// --- API helper ---

function apiFetch(path, options) {
  const opts = options || {};
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = 'Bearer ' + token;
  if (opts.body && typeof opts.body === 'object') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(path, opts).then((res) => {
    if (!res.ok) {
      return res.text().then(function(body) {
        throw new Error(body || (res.status + ' ' + res.statusText));
      });
    }
    return res.json();
  });
}

// --- Restart Feature ---

let isRestarting = false; // Track if we're currently restarting
let restartEnabled = false; // Track if restart is available in this deployment

function triggerRestart() {
  if (!currentThreadId) {
    alert(t('error.start_conversation_first'));
    return;
  }

  // Show the confirmation modal
  const confirmModal = document.getElementById('restart-confirm-modal');
  confirmModal.style.display = 'flex';
}

function confirmRestart() {
  if (!currentThreadId) {
    alert(t('error.start_conversation_first'));
    return;
  }

  // Hide confirmation modal
  const confirmModal = document.getElementById('restart-confirm-modal');
  confirmModal.style.display = 'none';

  const restartBtn = document.getElementById('restart-btn');
  const restartIcon = document.getElementById('restart-icon');

  // Mark as restarting
  isRestarting = true;
  restartBtn.disabled = true;
  if (restartIcon) restartIcon.classList.add('spinning');

  // Show progress modal
  const loaderEl = document.getElementById('restart-loader');
  loaderEl.style.display = 'flex';

  // Send restart command via chat
  console.log('[confirmRestart] Sending /restart command to server');
  apiFetch('/api/chat/send', {
    method: 'POST',
    body: {
      content: '/restart',
      thread_id: currentThreadId,
    },
  })
    .then((response) => {
      console.log('[confirmRestart] API call succeeded, response:', response);
    })
    .catch((err) => {
      console.error('[confirmRestart] Restart request failed:', err);
      addMessage('system', t('error.restart_failed', { message: err.message }));
      isRestarting = false;
      restartBtn.disabled = false;
      if (restartIcon) restartIcon.classList.remove('spinning');
      loaderEl.style.display = 'none';
    });
}

function cancelRestart() {
  const confirmModal = document.getElementById('restart-confirm-modal');
  confirmModal.style.display = 'none';
}

function tryShowRestartModal() {
  // Defensive callback for when restart is detected in messages.
  if (!isRestarting) {
    isRestarting = true;
    const restartBtn = document.getElementById('restart-btn');
    const restartIcon = document.getElementById('restart-icon');
    restartBtn.disabled = true;
    if (restartIcon) restartIcon.classList.add('spinning');

    // Show progress modal
    const loaderEl = document.getElementById('restart-loader');
    loaderEl.style.display = 'flex';
  }
}

function updateRestartButtonVisibility() {
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) {
    restartBtn.style.display = restartEnabled ? 'block' : 'none';
  }
}

function startGatewayStatusPolling() {
  fetchGatewayStatus();
  // Poll every 5 seconds
  setInterval(fetchGatewayStatus, 5000);
}

function fetchGatewayStatus() {
  apiFetch('/api/gateway/status')
    .then((data) => {
      restartEnabled = data.restart_enabled || false;
      updateRestartButtonVisibility();
    })
    .catch((err) => {
      console.warn('[gateway status] Failed to fetch:', err);
    });
}

// --- SSE ---

function connectSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/chat/events?token=' + encodeURIComponent(token));

  eventSource.onopen = () => {
    document.getElementById('sse-dot').classList.remove('disconnected');
    document.getElementById('sse-status').textContent = t('status.connected');

    // If we were restarting, close the modal and reset button now that server is back
    if (isRestarting) {
      const loaderEl = document.getElementById('restart-loader');
      if (loaderEl) loaderEl.style.display = 'none';
      const restartBtn = document.getElementById('restart-btn');
      const restartIcon = document.getElementById('restart-icon');
      if (restartBtn) restartBtn.disabled = false;
      if (restartIcon) restartIcon.classList.remove('spinning');
      isRestarting = false;
    }

    if (sseHasConnectedBefore && currentThreadId) {
      finalizeActivityGroup();
      loadHistory();
    }
    sseHasConnectedBefore = true;
  };

  eventSource.onerror = () => {
    document.getElementById('sse-dot').classList.add('disconnected');
    document.getElementById('sse-status').textContent = t('status.reconnecting');
  };

  eventSource.addEventListener('response', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    finalizeActivityGroup();
    addMessage('assistant', data.content);
    enableChatInput();
    // Refresh thread list so new titles appear after first message
    loadThreads();

    // Show restart modal if the response indicates restart was initiated
    if (data.content && data.content.toLowerCase().includes('restart initiated')) {
      setTimeout(() => tryShowRestartModal(), 500);
    }
  });

  eventSource.addEventListener('thinking', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    showActivityThinking(data.message);
  });

  eventSource.addEventListener('tool_started', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    addToolCard(data.name);
  });

  eventSource.addEventListener('tool_completed', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    completeToolCard(data.name, data.success, data.error, data.parameters);

    // Show restart modal only when the restart tool succeeds
    if (data.name.toLowerCase() === 'restart' && data.success) {
      setTimeout(() => tryShowRestartModal(), 500);
    }
  });

  eventSource.addEventListener('tool_result', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    setToolCardOutput(data.name, data.preview);
  });

  eventSource.addEventListener('stream_chunk', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    finalizeActivityGroup();
    appendToLastAssistant(data.content);
  });

  eventSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    // "Done" and "Awaiting approval" are terminal signals from the agent:
    // the agentic loop finished, so re-enable input as a safety net in case
    // the response SSE event is empty or lost.
    // Status text is not displayed — inline activity cards handle visual feedback.
    if (data.message === 'Done' || data.message === 'Awaiting approval') {
      finalizeActivityGroup();
      enableChatInput();
    }
  });

  eventSource.addEventListener('job_started', (e) => {
    const data = JSON.parse(e.data);
    showJobCard(data);
  });

  eventSource.addEventListener('approval_needed', (e) => {
    const data = JSON.parse(e.data);
    if (!isCurrentThread(data.thread_id)) return;
    showApproval(data);
  });

  eventSource.addEventListener('auth_required', (e) => {
    const data = JSON.parse(e.data);
    if (data.auth_url) {
      // OAuth flow: show the auth card with an OAuth button + optional token paste field.
      showAuthCard(data);
    } else {
      // Setup flow: fetch the extension's credential schema and show the multi-field
      // configure modal (the same UI used by the Extensions tab "Setup" button).
      showConfigureModal(data.extension_name);
    }
  });

  eventSource.addEventListener('auth_completed', (e) => {
    const data = JSON.parse(e.data);
    // Dismiss whichever UI path was active: auth card (OAuth) or configure modal (setup).
    removeAuthCard(data.extension_name);
    closeConfigureModal();
    showToast(data.message, data.success ? 'success' : 'error');
    // Refresh extensions list so status indicators update
    if (currentTab === 'extensions') loadExtensions();
    enableChatInput();
  });

  eventSource.addEventListener('extension_status', (e) => {
    if (currentTab === 'extensions') loadExtensions();
  });

  eventSource.addEventListener('error', (e) => {
    if (e.data) {
      const data = JSON.parse(e.data);
      if (!isCurrentThread(data.thread_id)) return;
      finalizeActivityGroup();
      addMessage('system', t('error.event_message', { message: data.message }));
      enableChatInput();
    }
  });

  // Job event listeners (activity stream for all sandbox jobs)
  const jobEventTypes = [
    'job_message', 'job_tool_use', 'job_tool_result',
    'job_status', 'job_result'
  ];
  for (const evtType of jobEventTypes) {
    eventSource.addEventListener(evtType, (e) => {
      const data = JSON.parse(e.data);
      const jobId = data.job_id;
      if (!jobId) return;
      if (!jobEvents.has(jobId)) jobEvents.set(jobId, []);
      const events = jobEvents.get(jobId);
      events.push({ type: evtType, data: data, ts: Date.now() });
      // Cap per-job events to prevent memory leak
      while (events.length > JOB_EVENTS_CAP) events.shift();
      // If the Activity tab is currently visible for this job, refresh it
      refreshActivityTab(jobId);
      // Auto-refresh job list when on jobs tab (debounced)
      if ((evtType === 'job_result' || evtType === 'job_status') && currentTab === 'jobs' && !currentJobId) {
        clearTimeout(jobListRefreshTimer);
        jobListRefreshTimer = setTimeout(loadJobs, 200);
      }
      // Clean up finished job events after a viewing window
      if (evtType === 'job_result') {
        setTimeout(() => jobEvents.delete(jobId), 60000);
      }
    });
  }
}

// Check if an SSE event belongs to the currently viewed thread.
// Events without a thread_id (legacy) are always shown.
function isCurrentThread(threadId) {
  if (!threadId) return true;
  if (!currentThreadId) return true;
  return threadId === currentThreadId;
}

// --- Chat ---

function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!currentThreadId) {
    console.warn('sendMessage: no thread selected, ignoring');
    return;
  }
  const content = input.value.trim();
  if (!content) return;

  addMessage('user', content);
  input.value = '';
  autoResizeTextarea(input);
  input.focus();

  apiFetch('/api/chat/send', {
    method: 'POST',
    body: { content, thread_id: currentThreadId || undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  }).catch((err) => {
    addMessage('system', t('error.failed_to_send', { message: err.message }));
  });
}

function enableChatInput() {
  if (currentThreadIsReadOnly) return;
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');
  if (input) {
    input.disabled = false;
    input.placeholder = t('chat.input_placeholder');
  }
  if (btn) btn.disabled = false;
}

// --- Slash Autocomplete ---

function showSlashAutocomplete(matches) {
  const el = document.getElementById('slash-autocomplete');
  if (!el || matches.length === 0) { hideSlashAutocomplete(); return; }
  _slashMatches = matches;
  _slashSelected = -1;
  el.innerHTML = '';
  matches.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'slash-ac-item';
    row.dataset.index = i;
    var cmdSpan = document.createElement('span');
    cmdSpan.className = 'slash-ac-cmd';
    cmdSpan.textContent = item.cmd;
    var descSpan = document.createElement('span');
    descSpan.className = 'slash-ac-desc';
    descSpan.textContent = item.desc;
    row.appendChild(cmdSpan);
    row.appendChild(descSpan);
    row.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur
      selectSlashItem(item.cmd);
    });
    el.appendChild(row);
  });
  el.style.display = 'block';
}

function hideSlashAutocomplete() {
  const el = document.getElementById('slash-autocomplete');
  if (el) el.style.display = 'none';
  _slashSelected = -1;
  _slashMatches = [];
}

function selectSlashItem(cmd) {
  const input = document.getElementById('chat-input');
  input.value = cmd + ' ';
  input.focus();
  hideSlashAutocomplete();
  autoResizeTextarea(input);
}

function updateSlashHighlight() {
  const items = document.querySelectorAll('#slash-autocomplete .slash-ac-item');
  items.forEach((el, i) => el.classList.toggle('selected', i === _slashSelected));
  if (_slashSelected >= 0 && items[_slashSelected]) {
    items[_slashSelected].scrollIntoView({ block: 'nearest' });
  }
}

function filterSlashCommands(value) {
  if (!value.startsWith('/')) { hideSlashAutocomplete(); return; }
  // Only show autocomplete when the input is just a slash command prefix (no spaces except /thread new)
  const lower = value.toLowerCase();
  const matches = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(lower));
  if (matches.length === 0 || (matches.length === 1 && matches[0].cmd === lower.trimEnd())) {
    hideSlashAutocomplete();
  } else {
    showSlashAutocomplete(matches);
  }
}

function formatElapsedDuration(totalSeconds) {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return '-';
  if (totalSeconds < 60) {
    const count = totalSeconds < 10 ? totalSeconds.toFixed(1) : Math.floor(totalSeconds);
    return t('jobs.duration.seconds', { count });
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes < 60) {
    return t('jobs.duration.minutes_seconds', { minutes, seconds });
  }
  const hours = Math.floor(minutes / 60);
  return t('jobs.duration.hours_minutes', { hours, minutes: minutes % 60 });
}

function sendApprovalAction(requestId, action) {
  apiFetch('/api/chat/approval', {
    method: 'POST',
    body: { request_id: requestId, action: action, thread_id: currentThreadId },
  }).catch((err) => {
    addMessage('system', t('approval.send_failed', { message: err.message }));
  });

  // Disable buttons and show confirmation on the card
  const card = document.querySelector('.approval-card[data-request-id="' + requestId + '"]');
  if (card) {
    const buttons = card.querySelectorAll('.approval-actions button');
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
    const actions = card.querySelector('.approval-actions');
    const label = document.createElement('span');
    label.className = 'approval-resolved';
    const labelText = action === 'approve'
      ? t('approval.resolved.approved')
      : action === 'always'
        ? t('approval.resolved.always_approved')
        : t('approval.resolved.denied');
    label.textContent = labelText;
    actions.appendChild(label);
    // Remove the card after showing the confirmation briefly
    setTimeout(() => { card.remove(); }, 1500);
  }
}

function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    let html = marked.parse(text);
    // Sanitize HTML output to prevent XSS from tool output or LLM responses.
    html = sanitizeRenderedHtml(html);
    // Inject copy buttons into <pre> blocks
    html = html.replace(
      /<pre>/g,
      '<pre class="code-block-wrapper"><button class="copy-btn" onclick="copyCodeBlock(this)">' + escapeHtml(t('markdown.copy')) + '</button>'
    );
    return html;
  }
  return escapeHtml(text);
}

// Strip dangerous HTML elements and attributes from rendered markdown.
// This prevents XSS from tool output or prompt injection in LLM responses.
function sanitizeRenderedHtml(html) {
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  html = html.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  html = html.replace(/<embed\b[^>]*\/?>/gi, '');
  html = html.replace(/<form\b[^>]*>[\s\S]*?<\/form>/gi, '');
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<link\b[^>]*\/?>/gi, '');
  html = html.replace(/<base\b[^>]*\/?>/gi, '');
  html = html.replace(/<meta\b[^>]*\/?>/gi, '');
  // Remove event handler attributes (onclick, onerror, onload, etc.)
  html = html.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
  // Remove javascript: and data: URLs in href/src attributes
  html = html.replace(/(href|src|action)\s*=\s*["']?\s*javascript\s*:/gi, '$1="');
  html = html.replace(/(href|src|action)\s*=\s*["']?\s*data\s*:/gi, '$1="');
  return html;
}

function copyCodeBlock(btn) {
  const pre = btn.parentElement;
  const code = pre.querySelector('code');
  const text = code ? code.textContent : pre.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = t('markdown.copied');
    setTimeout(() => { btn.textContent = t('markdown.copy'); }, 1500);
  });
}

function addMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message ' + role;
  if (role === 'user') {
    div.textContent = content;
  } else {
    div.setAttribute('data-raw', content);
    div.innerHTML = renderMarkdown(content);
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendToLastAssistant(chunk) {
  const container = document.getElementById('chat-messages');
  const messages = container.querySelectorAll('.message.assistant');
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const raw = (last.getAttribute('data-raw') || '') + chunk;
    last.setAttribute('data-raw', raw);
    last.innerHTML = renderMarkdown(raw);
    container.scrollTop = container.scrollHeight;
  } else {
    addMessage('assistant', chunk);
  }
}

// --- Inline Tool Activity Cards ---

function getOrCreateActivityGroup() {
  if (_activeGroup) return _activeGroup;
  const container = document.getElementById('chat-messages');
  const group = document.createElement('div');
  group.className = 'activity-group';
  container.appendChild(group);
  container.scrollTop = container.scrollHeight;
  _activeGroup = group;
  _activeToolCards = {};
  return group;
}

function showActivityThinking(message) {
  const group = getOrCreateActivityGroup();
  if (_activityThinking) {
    // Already exists — just update text and un-hide
    _activityThinking.style.display = '';
    _activityThinking.querySelector('.activity-thinking-text').textContent = message;
  } else {
    _activityThinking = document.createElement('div');
    _activityThinking.className = 'activity-thinking';
    _activityThinking.innerHTML =
      '<span class="activity-thinking-dots">'
      + '<span class="activity-thinking-dot"></span>'
      + '<span class="activity-thinking-dot"></span>'
      + '<span class="activity-thinking-dot"></span>'
      + '</span>'
      + '<span class="activity-thinking-text"></span>';
    group.appendChild(_activityThinking);
    _activityThinking.querySelector('.activity-thinking-text').textContent = message;
  }
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function removeActivityThinking() {
  if (_activityThinking) {
    _activityThinking.remove();
    _activityThinking = null;
  }
}

function addToolCard(name) {
  // Hide thinking instead of destroying — it may reappear between tool rounds
  if (_activityThinking) _activityThinking.style.display = 'none';
  const group = getOrCreateActivityGroup();

  const card = document.createElement('div');
  card.className = 'activity-tool-card';
  card.setAttribute('data-tool-name', name);
  card.setAttribute('data-status', 'running');

  const header = document.createElement('div');
  header.className = 'activity-tool-header';

  const icon = document.createElement('span');
  icon.className = 'activity-tool-icon';
  icon.innerHTML = '<div class="spinner"></div>';

  const toolName = document.createElement('span');
  toolName.className = 'activity-tool-name';
  toolName.textContent = name;

  const duration = document.createElement('span');
  duration.className = 'activity-tool-duration';
  duration.textContent = '';

  const chevron = document.createElement('span');
  chevron.className = 'activity-tool-chevron';
  chevron.innerHTML = '&#9656;';

  header.appendChild(icon);
  header.appendChild(toolName);
  header.appendChild(duration);
  header.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'activity-tool-body';
  body.style.display = 'none';

  const output = document.createElement('pre');
  output.className = 'activity-tool-output';
  body.appendChild(output);

  header.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    chevron.classList.toggle('expanded', !isOpen);
  });

  card.appendChild(header);
  card.appendChild(body);
  group.appendChild(card);

  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 300) { clearInterval(timerInterval); return; }
    duration.textContent = formatElapsedDuration(elapsed);
  }, 100);

  if (!_activeToolCards[name]) _activeToolCards[name] = [];
  _activeToolCards[name].push({ card, startTime, timer: timerInterval, duration, icon, finalDuration: null });

  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function completeToolCard(name, success, error, parameters) {
  const entries = _activeToolCards[name];
  if (!entries || entries.length === 0) return;
  // Find first running card
  let entry = null;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].card.getAttribute('data-status') === 'running') {
      entry = entries[i];
      break;
    }
  }
  if (!entry) entry = entries[entries.length - 1];

  clearInterval(entry.timer);
  const elapsed = (Date.now() - entry.startTime) / 1000;
  entry.finalDuration = elapsed;
  entry.duration.textContent = formatElapsedDuration(elapsed);
  entry.icon.innerHTML = success
    ? '<span class="activity-icon-success">&#10003;</span>'
    : '<span class="activity-icon-fail">&#10007;</span>';
  entry.card.setAttribute('data-status', success ? 'success' : 'fail');

  // For failed tools, populate the body with error details and auto-expand
  if (!success && (error || parameters)) {
    const output = entry.card.querySelector('.activity-tool-output');
    if (output) {
      let detail = '';
      if (parameters) {
        detail += t('activity.detail.input') + ':\n' + parameters + '\n\n';
      }
      if (error) {
        detail += t('activity.detail.error') + ':\n' + error;
      }
      output.textContent = detail;

      // Auto-expand so the error is immediately visible
      const body = entry.card.querySelector('.activity-tool-body');
      const chevron = entry.card.querySelector('.activity-tool-chevron');
      if (body) body.style.display = 'block';
      if (chevron) chevron.classList.add('expanded');
    }
  }
}

function setToolCardOutput(name, preview) {
  const entries = _activeToolCards[name];
  if (!entries || entries.length === 0) return;
  // Find first card with empty output
  let entry = null;
  for (let i = 0; i < entries.length; i++) {
    const out = entries[i].card.querySelector('.activity-tool-output');
    if (out && !out.textContent) {
      entry = entries[i];
      break;
    }
  }
  if (!entry) entry = entries[entries.length - 1];

  const output = entry.card.querySelector('.activity-tool-output');
  if (output) {
    const truncated = preview.length > 2000 ? preview.substring(0, 2000) + '\n... (truncated)' : preview;
    output.textContent = truncated;
  }
}

function finalizeActivityGroup() {
  removeActivityThinking();
  if (!_activeGroup) return;

  // Stop all timers
  for (const name in _activeToolCards) {
    const entries = _activeToolCards[name];
    for (let i = 0; i < entries.length; i++) {
      clearInterval(entries[i].timer);
    }
  }

  // Count tools and total duration
  let toolCount = 0;
  let totalDuration = 0;
  for (const tname in _activeToolCards) {
    const tentries = _activeToolCards[tname];
    for (let j = 0; j < tentries.length; j++) {
      const entry = tentries[j];
      toolCount++;
      if (entry.finalDuration !== null) {
        totalDuration += entry.finalDuration;
      } else {
        // Tool was still running when finalized
        totalDuration += (Date.now() - entry.startTime) / 1000;
      }
    }
  }

  if (toolCount === 0) {
    // No tools were used — remove the empty group
    _activeGroup.remove();
    _activeGroup = null;
    _activeToolCards = {};
    return;
  }

  // Wrap existing cards into a hidden container
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'activity-cards-container';
  cardsContainer.style.display = 'none';

  const cards = _activeGroup.querySelectorAll('.activity-tool-card');
  for (let k = 0; k < cards.length; k++) {
    cardsContainer.appendChild(cards[k]);
  }

  // Build summary line
  const durationStr = formatElapsedDuration(totalDuration);
  const summary = document.createElement('div');
  summary.className = 'activity-summary';
  summary.innerHTML = '<span class="activity-summary-chevron">&#9656;</span>'
    + '<span class="activity-summary-text">' + escapeHtml(t('activity.summary.used_tools', { count: toolCount })) + '</span>'
    + '<span class="activity-summary-duration">(' + durationStr + ')</span>';

  summary.addEventListener('click', () => {
    const isOpen = cardsContainer.style.display !== 'none';
    cardsContainer.style.display = isOpen ? 'none' : 'block';
    summary.querySelector('.activity-summary-chevron').classList.toggle('expanded', !isOpen);
  });

  // Clear group and add summary + hidden cards
  _activeGroup.innerHTML = '';
  _activeGroup.classList.add('collapsed');
  _activeGroup.appendChild(summary);
  _activeGroup.appendChild(cardsContainer);

  _activeGroup = null;
  _activeToolCards = {};
}

function showApproval(data) {
  const container = document.getElementById('chat-messages');
  const card = document.createElement('div');
  card.className = 'approval-card';
  card.setAttribute('data-request-id', data.request_id);

  const header = document.createElement('div');
  header.className = 'approval-header';
  header.textContent = t('approval.title');
  card.appendChild(header);

  const toolName = document.createElement('div');
  toolName.className = 'approval-tool-name';
  toolName.textContent = data.tool_name;
  card.appendChild(toolName);

  if (data.description) {
    const desc = document.createElement('div');
    desc.className = 'approval-description';
    desc.textContent = data.description;
    card.appendChild(desc);
  }

  if (data.parameters) {
    const paramsToggle = document.createElement('button');
    paramsToggle.className = 'approval-params-toggle';
    paramsToggle.textContent = t('approval.show_parameters');
    const paramsBlock = document.createElement('pre');
    paramsBlock.className = 'approval-params';
    paramsBlock.textContent = data.parameters;
    paramsBlock.style.display = 'none';
    paramsToggle.addEventListener('click', () => {
      const visible = paramsBlock.style.display !== 'none';
      paramsBlock.style.display = visible ? 'none' : 'block';
      paramsToggle.textContent = visible ? t('approval.show_parameters') : t('approval.hide_parameters');
    });
    card.appendChild(paramsToggle);
    card.appendChild(paramsBlock);
  }

  const actions = document.createElement('div');
  actions.className = 'approval-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'approve';
  approveBtn.textContent = t('approval.action.approve');
  approveBtn.addEventListener('click', () => sendApprovalAction(data.request_id, 'approve'));

  const alwaysBtn = document.createElement('button');
  alwaysBtn.className = 'always';
  alwaysBtn.textContent = t('approval.action.always');
  alwaysBtn.addEventListener('click', () => sendApprovalAction(data.request_id, 'always'));

  const denyBtn = document.createElement('button');
  denyBtn.className = 'deny';
  denyBtn.textContent = t('approval.action.deny');
  denyBtn.addEventListener('click', () => sendApprovalAction(data.request_id, 'deny'));

  actions.appendChild(approveBtn);
  actions.appendChild(alwaysBtn);
  actions.appendChild(denyBtn);
  card.appendChild(actions);

  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
}

function showJobCard(data) {
  const container = document.getElementById('chat-messages');
  const card = document.createElement('div');
  card.className = 'job-card';

  const icon = document.createElement('span');
  icon.className = 'job-card-icon';
  icon.textContent = '\u2692';
  card.appendChild(icon);

  const info = document.createElement('div');
  info.className = 'job-card-info';

  const title = document.createElement('div');
  title.className = 'job-card-title';
  title.textContent = data.title || t('jobs.card.default_title');
  info.appendChild(title);

  const id = document.createElement('div');
  id.className = 'job-card-id';
  id.textContent = (data.job_id || '').substring(0, 8);
  info.appendChild(id);

  card.appendChild(info);

  const viewBtn = document.createElement('button');
  viewBtn.className = 'job-card-view';
  viewBtn.textContent = t('jobs.card.view');
  viewBtn.addEventListener('click', () => {
    switchTab('jobs');
    openJobDetail(data.job_id);
  });
  card.appendChild(viewBtn);

  if (data.browse_url) {
    const browseBtn = document.createElement('a');
    browseBtn.className = 'job-card-browse';
    browseBtn.href = data.browse_url;
    browseBtn.target = '_blank';
    browseBtn.textContent = t('jobs.card.browse');
    card.appendChild(browseBtn);
  }

  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
}

// --- Auth card ---

function showAuthCard(data) {
  // Remove any existing card for this extension first
  removeAuthCard(data.extension_name);

  const container = document.getElementById('chat-messages');
  const card = document.createElement('div');
  card.className = 'auth-card';
  card.setAttribute('data-extension-name', data.extension_name);

  const header = document.createElement('div');
  header.className = 'auth-header';
  header.textContent = t('auth.card.required_for', { name: data.extension_name });
  card.appendChild(header);

  if (data.instructions) {
    const instr = document.createElement('div');
    instr.className = 'auth-instructions';
    instr.textContent = data.instructions;
    card.appendChild(instr);
  }

  const links = document.createElement('div');
  links.className = 'auth-links';

  if (data.auth_url) {
    const oauthBtn = document.createElement('button');
    oauthBtn.className = 'auth-oauth';
    oauthBtn.textContent = t('auth.card.authenticate_with', { name: data.extension_name });
    oauthBtn.addEventListener('click', () => {
      openOAuthUrl(data.auth_url);
    });
    links.appendChild(oauthBtn);
  }

  if (data.setup_url) {
    const setupLink = document.createElement('a');
    setupLink.href = data.setup_url;
    setupLink.target = '_blank';
    setupLink.textContent = t('auth.card.get_token');
    links.appendChild(setupLink);
  }

  if (links.children.length > 0) {
    card.appendChild(links);
  }

  // Token input
  const tokenRow = document.createElement('div');
  tokenRow.className = 'auth-token-input';

  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.placeholder = data.instructions || t('auth.card.token_placeholder');
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAuthToken(data.extension_name, tokenInput.value);
  });
  tokenRow.appendChild(tokenInput);
  card.appendChild(tokenRow);

  // Error display (hidden initially)
  const errorEl = document.createElement('div');
  errorEl.className = 'auth-error';
  errorEl.style.display = 'none';
  card.appendChild(errorEl);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'auth-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'auth-submit';
  submitBtn.textContent = t('auth.card.submit');
  submitBtn.addEventListener('click', () => submitAuthToken(data.extension_name, tokenInput.value));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'auth-cancel';
  cancelBtn.textContent = t('auth.card.cancel');
  cancelBtn.addEventListener('click', () => cancelAuth(data.extension_name));

  actions.appendChild(submitBtn);
  actions.appendChild(cancelBtn);
  card.appendChild(actions);

  container.appendChild(card);
  container.scrollTop = container.scrollHeight;
  tokenInput.focus();
}

function removeAuthCard(extensionName) {
  const card = document.querySelector('.auth-card[data-extension-name="' + extensionName + '"]');
  if (card) card.remove();
}

function submitAuthToken(extensionName, tokenValue) {
  if (!tokenValue || !tokenValue.trim()) return;

  // Disable submit button while in flight
  const card = document.querySelector('.auth-card[data-extension-name="' + extensionName + '"]');
  if (card) {
    const btns = card.querySelectorAll('button');
    btns.forEach((b) => { b.disabled = true; });
  }

  apiFetch('/api/chat/auth-token', {
    method: 'POST',
    body: { extension_name: extensionName, token: tokenValue.trim() },
  }).then((result) => {
    if (result.success) {
      removeAuthCard(extensionName);
      addMessage('system', result.message);
    } else {
      showAuthCardError(extensionName, result.message);
    }
  }).catch((err) => {
    showAuthCardError(extensionName, t('auth.card.submit_failed', { message: err.message }));
  });
}

function cancelAuth(extensionName) {
  apiFetch('/api/chat/auth-cancel', {
    method: 'POST',
    body: { extension_name: extensionName },
  }).catch(() => {});
  removeAuthCard(extensionName);
  enableChatInput();
}

function showAuthCardError(extensionName, message) {
  const card = document.querySelector('.auth-card[data-extension-name="' + extensionName + '"]');
  if (!card) return;
  // Re-enable buttons
  const btns = card.querySelectorAll('button');
  btns.forEach((b) => { b.disabled = false; });
  // Show error
  const errorEl = card.querySelector('.auth-error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

function loadHistory(before) {
  let historyUrl = '/api/chat/history?limit=50';
  if (currentThreadId) {
    historyUrl += '&thread_id=' + encodeURIComponent(currentThreadId);
  }
  if (before) {
    historyUrl += '&before=' + encodeURIComponent(before);
  }

  const isPaginating = !!before;
  if (isPaginating) loadingOlder = true;

  apiFetch(historyUrl).then((data) => {
    const container = document.getElementById('chat-messages');

    if (!isPaginating) {
      // Fresh load: clear and render
      container.innerHTML = '';
      for (const turn of data.turns) {
        addMessage('user', turn.user_input);
        if (turn.tool_calls && turn.tool_calls.length > 0) {
          addToolCallsSummary(turn.tool_calls);
        }
        if (turn.response) {
          addMessage('assistant', turn.response);
        }
      }
      // Show processing indicator if the last turn is still in-progress
      var lastTurn = data.turns.length > 0 ? data.turns[data.turns.length - 1] : null;
      if (lastTurn && !lastTurn.response && lastTurn.state === 'Processing') {
        showActivityThinking(t('chat.processing'));
      }
      // Re-render pending approval card if the thread is awaiting approval
      if (data.pending_approval) {
        showApproval(data.pending_approval);
      }
    } else {
      // Pagination: prepend older messages
      const savedHeight = container.scrollHeight;
      const fragment = document.createDocumentFragment();
      for (const turn of data.turns) {
        const userDiv = createMessageElement('user', turn.user_input);
        fragment.appendChild(userDiv);
        if (turn.tool_calls && turn.tool_calls.length > 0) {
          fragment.appendChild(createToolCallsSummaryElement(turn.tool_calls));
        }
        if (turn.response) {
          const assistantDiv = createMessageElement('assistant', turn.response);
          fragment.appendChild(assistantDiv);
        }
      }
      container.insertBefore(fragment, container.firstChild);
      // Restore scroll position so the user doesn't jump
      container.scrollTop = container.scrollHeight - savedHeight;
    }

    hasMore = data.has_more || false;
    oldestTimestamp = data.oldest_timestamp || null;
  }).catch(() => {
    // No history or no active thread
  }).finally(() => {
    loadingOlder = false;
    removeScrollSpinner();
  });
}

// Create a message DOM element without appending it (for prepend operations)
function createMessageElement(role, content) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  if (role === 'user') {
    div.textContent = content;
  } else {
    div.setAttribute('data-raw', content);
    div.innerHTML = renderMarkdown(content);
  }
  return div;
}

function addToolCallsSummary(toolCalls) {
  const container = document.getElementById('chat-messages');
  container.appendChild(createToolCallsSummaryElement(toolCalls));
  container.scrollTop = container.scrollHeight;
}

function createToolCallsSummaryElement(toolCalls) {
  const div = document.createElement('div');
  div.className = 'tool-calls-summary';

  const header = document.createElement('div');
  header.className = 'tool-calls-header';
  header.textContent = t('activity.summary.used_tools', { count: toolCalls.length });
  div.appendChild(header);

  const list = document.createElement('div');
  list.className = 'tool-calls-list';

  for (const tc of toolCalls) {
    const item = document.createElement('div');
    item.className = 'tool-call-item' + (tc.has_error ? ' tool-error' : '');

    const icon = tc.has_error ? '\u2717' : '\u2713';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tool-call-name';
    nameSpan.textContent = icon + ' ' + tc.name;
    item.appendChild(nameSpan);

    if (tc.result_preview) {
      const preview = document.createElement('div');
      preview.className = 'tool-call-preview';
      preview.textContent = tc.result_preview;
      item.appendChild(preview);
    }
    if (tc.error) {
      const errDiv = document.createElement('div');
      errDiv.className = 'tool-call-error-text';
      errDiv.textContent = tc.error;
      item.appendChild(errDiv);
    }

    list.appendChild(item);
  }

  div.appendChild(list);

  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    list.classList.toggle('expanded');
    header.classList.toggle('expanded');
  });

  return div;
}

function removeScrollSpinner() {
  const spinner = document.getElementById('scroll-load-spinner');
  if (spinner) spinner.remove();
}

// --- Threads ---

function threadTitle(thread) {
  if (thread.title) return thread.title;
  const ch = thread.channel || 'gateway';
  if (thread.thread_type === 'heartbeat') return t('thread.title.heartbeat');
  if (thread.thread_type === 'routine') return t('thread.title.routine');
  if (ch !== 'gateway') return ch.charAt(0).toUpperCase() + ch.slice(1);
  if (thread.turn_count === 0) return t('thread.title.new_chat');
  return thread.id.substring(0, 8);
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('thread.relative.now');
  if (mins < 60) return t('thread.relative.minutes_ago', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('thread.relative.hours_ago', { count: hrs });
  const days = Math.floor(hrs / 24);
  return t('thread.relative.days_ago', { count: days });
}

function isReadOnlyChannel(channel) {
  return channel && channel !== 'gateway' && channel !== 'routine' && channel !== 'heartbeat';
}

function debouncedLoadThreads() {
  if (_loadThreadsTimer) clearTimeout(_loadThreadsTimer);
  _loadThreadsTimer = setTimeout(() => { _loadThreadsTimer = null; loadThreads(); }, 500);
}
function loadThreads() {
  apiFetch('/api/chat/threads').then((data) => {
    // Pinned assistant thread
    if (data.assistant_thread) {
      assistantThreadId = data.assistant_thread.id;
      const el = document.getElementById('assistant-thread');
      const isActive = currentThreadId === assistantThreadId;
      el.className = 'assistant-item' + (isActive ? ' active' : '');
      const labelEl = document.getElementById('assistant-label');
      if (labelEl) {
        labelEl.textContent = t('chat.assistant');
      }
      const meta = document.getElementById('assistant-meta');
      meta.textContent = relativeTime(data.assistant_thread.updated_at);
    }

    // Regular threads
    const list = document.getElementById('thread-list');
    list.innerHTML = '';
    const threads = data.threads || [];
    for (const thread of threads) {
      const item = document.createElement('div');
      const isActive = thread.id === currentThreadId;
      item.className = 'thread-item' + (isActive ? ' active' : '');

      const ch = thread.channel || 'gateway';
      if (ch !== 'gateway') {
        const badge = document.createElement('span');
        badge.className = 'thread-badge thread-badge-' + ch;
        badge.textContent = ch;
        item.appendChild(badge);
      }

      const label = document.createElement('span');
      label.className = 'thread-label';
      label.textContent = threadTitle(thread);
      label.title = (thread.title || '') + ' (' + thread.id + ')';
      item.appendChild(label);
      const meta = document.createElement('span');
      meta.className = 'thread-meta';
      meta.textContent = relativeTime(thread.updated_at);
      item.appendChild(meta);

      const unread = unreadThreads.get(thread.id) || 0;
      if (unread > 0 && !isActive) {
        const dot = document.createElement('span');
        dot.className = 'thread-unread';
        dot.textContent = unread > 9 ? '9+' : String(unread);
        item.appendChild(dot);
      }

      item.addEventListener('click', () => switchThread(thread.id));
      list.appendChild(item);
    }

    // Default to assistant thread on first load if no thread selected
    if (!currentThreadId && assistantThreadId) {
      switchToAssistant();
    }

    // Enable/disable chat input based on channel type
    if (currentThreadId) {
      const currentThread = threads.find(t => t.id === currentThreadId);
      const ch = currentThread ? currentThread.channel : 'gateway';
      currentThreadIsReadOnly = isReadOnlyChannel(ch);
      if (currentThreadIsReadOnly) {
        disableChatInputReadOnly();
      } else {
        enableChatInput();
      }
    }
  }).catch(() => {});
}

function disableChatInputReadOnly() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');
  if (input) {
    input.disabled = true;
    input.placeholder = t('chat.readonly_placeholder');
  }
  if (btn) btn.disabled = true;
}
function switchToAssistant() {
  if (!assistantThreadId) return;
  finalizeActivityGroup();
  currentThreadId = assistantThreadId;
  currentThreadIsReadOnly = false;
  unreadThreads.delete(assistantThreadId);
  hasMore = false;
  oldestTimestamp = null;
  loadHistory();
  loadThreads();
}

function switchThread(threadId) {
  finalizeActivityGroup();
  currentThreadId = threadId;
  unreadThreads.delete(threadId);
  hasMore = false;
  oldestTimestamp = null;
  loadHistory();
  loadThreads();
}

function createNewThread() {
  apiFetch('/api/chat/thread/new', { method: 'POST' }).then((data) => {
    currentThreadId = data.id || null;
    document.getElementById('chat-messages').innerHTML = '';
    loadThreads();
  }).catch((err) => {
    showToast(t('error.failed_to_create_thread', { message: err.message }), 'error');
  });
}

function toggleThreadSidebar() {
  const sidebar = document.getElementById('thread-sidebar');
  sidebar.classList.toggle('collapsed');
  const btn = document.getElementById('thread-toggle-btn');
  btn.innerHTML = sidebar.classList.contains('collapsed') ? '&raquo;' : '&laquo;';
}

// Chat input auto-resize and keyboard handling
const chatInput = document.getElementById('chat-input');
chatInput.addEventListener('keydown', (e) => {
  const acEl = document.getElementById('slash-autocomplete');
  const acVisible = acEl && acEl.style.display !== 'none';

  if (acVisible) {
    const items = acEl.querySelectorAll('.slash-ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _slashSelected = Math.min(_slashSelected + 1, items.length - 1);
      updateSlashHighlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      _slashSelected = Math.max(_slashSelected - 1, -1);
      updateSlashHighlight();
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const pick = _slashSelected >= 0 ? _slashMatches[_slashSelected] : _slashMatches[0];
      if (pick) selectSlashItem(pick.cmd);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashAutocomplete();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    hideSlashAutocomplete();
    sendMessage();
  }
});
chatInput.addEventListener('input', () => {
  autoResizeTextarea(chatInput);
  filterSlashCommands(chatInput.value);
});
chatInput.addEventListener('blur', () => {
  // Small delay so mousedown on autocomplete item fires first
  setTimeout(hideSlashAutocomplete, 150);
});

// Infinite scroll: load older messages when scrolled near the top
document.getElementById('chat-messages').addEventListener('scroll', function () {
  if (this.scrollTop < 100 && hasMore && !loadingOlder) {
    loadingOlder = true;
    // Show spinner at top
    const spinner = document.createElement('div');
    spinner.id = 'scroll-load-spinner';
    spinner.className = 'scroll-load-spinner';
    spinner.innerHTML = '<div class="spinner"></div> ' + escapeHtml(t('chat.loading_older'));
    this.insertBefore(spinner, this.firstChild);
    loadHistory(oldestTimestamp);
  }
});

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// --- Tabs ---

document.querySelectorAll('.tab-bar button[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab');
    switchTab(tab);
  });
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-bar button[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'tab-' + tab);
  });

  if (tab === 'memory') loadMemoryTree();
  if (tab === 'jobs') loadJobs();
  if (tab === 'routines') loadRoutines();
  if (tab === 'logs') applyLogFilters();
  if (tab === 'extensions') {
    loadExtensions();
    startPairingPoll();
  } else {
    stopPairingPoll();
  }
  if (tab === 'skills') loadSkills();
}

// --- Memory (filesystem tree) ---

let memorySearchTimeout = null;
let currentMemoryPath = null;
let currentMemoryContent = null;
// Tree state: nested nodes persisted across renders
// { name, path, is_dir, children: [] | null, expanded: bool, loaded: bool }
let memoryTreeState = null;

document.getElementById('memory-search').addEventListener('input', (e) => {
  clearTimeout(memorySearchTimeout);
  const query = e.target.value.trim();
  if (!query) {
    loadMemoryTree();
    return;
  }
  memorySearchTimeout = setTimeout(() => searchMemory(query), 300);
});

function loadMemoryTree() {
  // Only load top-level on first load (or refresh)
  apiFetch('/api/memory/list?path=').then((data) => {
    memoryTreeState = data.entries.map((e) => ({
      name: e.name,
      path: e.path,
      is_dir: e.is_dir,
      children: e.is_dir ? null : undefined,
      expanded: false,
      loaded: false,
    }));
    renderTree();
  }).catch(() => {});
}

function renderTree() {
  const container = document.getElementById('memory-tree');
  container.innerHTML = '';
  if (!memoryTreeState || memoryTreeState.length === 0) {
    container.innerHTML = '<div class="tree-item" style="color:var(--text-secondary)">' + escapeHtml(t('memory.empty_no_files')) + '</div>';
    return;
  }
  renderNodes(memoryTreeState, container, 0);
}

function renderNodes(nodes, container, depth) {
  for (const node of nodes) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = (depth * 16 + 8) + 'px';

    if (node.is_dir) {
      const arrow = document.createElement('span');
      arrow.className = 'expand-arrow' + (node.expanded ? ' expanded' : '');
      arrow.textContent = '\u25B6';
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpand(node);
      });
      row.appendChild(arrow);

      const label = document.createElement('span');
      label.className = 'tree-label dir';
      label.textContent = node.name;
      label.addEventListener('click', () => toggleExpand(node));
      row.appendChild(label);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'expand-arrow-spacer';
      row.appendChild(spacer);

      const label = document.createElement('span');
      label.className = 'tree-label file';
      label.textContent = node.name;
      label.addEventListener('click', () => readMemoryFile(node.path));
      row.appendChild(label);
    }

    container.appendChild(row);

    if (node.is_dir && node.expanded && node.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      renderNodes(node.children, childContainer, depth + 1);
      container.appendChild(childContainer);
    }
  }
}

function toggleExpand(node) {
  if (node.expanded) {
    node.expanded = false;
    renderTree();
    return;
  }

  if (node.loaded) {
    node.expanded = true;
    renderTree();
    return;
  }

  // Lazy-load children
  apiFetch('/api/memory/list?path=' + encodeURIComponent(node.path)).then((data) => {
    node.children = data.entries.map((e) => ({
      name: e.name,
      path: e.path,
      is_dir: e.is_dir,
      children: e.is_dir ? null : undefined,
      expanded: false,
      loaded: false,
    }));
    node.loaded = true;
    node.expanded = true;
    renderTree();
  }).catch(() => {});
}

function readMemoryFile(path) {
  currentMemoryPath = path;
  // Update breadcrumb
  document.getElementById('memory-breadcrumb-path').innerHTML = buildBreadcrumb(path);
  document.getElementById('memory-edit-btn').style.display = 'inline-block';

  // Exit edit mode if active
  cancelMemoryEdit();

  apiFetch('/api/memory/read?path=' + encodeURIComponent(path)).then((data) => {
    currentMemoryContent = data.content;
    const viewer = document.getElementById('memory-viewer');
    // Render markdown if it's a .md file
    if (path.endsWith('.md')) {
      viewer.innerHTML = '<div class="memory-rendered">' + renderMarkdown(data.content) + '</div>';
      viewer.classList.add('rendered');
    } else {
      viewer.textContent = data.content;
      viewer.classList.remove('rendered');
    }
  }).catch((err) => {
    currentMemoryContent = null;
    document.getElementById('memory-viewer').innerHTML = '<div class="empty">' + escapeHtml(t('memory.read_error', { message: err.message })) + '</div>';
  });
}

function startMemoryEdit() {
  if (!currentMemoryPath || currentMemoryContent === null) return;
  document.getElementById('memory-viewer').style.display = 'none';
  const editor = document.getElementById('memory-editor');
  editor.style.display = 'flex';
  const textarea = document.getElementById('memory-edit-textarea');
  textarea.value = currentMemoryContent;
  textarea.focus();
}

function cancelMemoryEdit() {
  document.getElementById('memory-viewer').style.display = '';
  document.getElementById('memory-editor').style.display = 'none';
}

function saveMemoryEdit() {
  if (!currentMemoryPath) return;
  const content = document.getElementById('memory-edit-textarea').value;
  apiFetch('/api/memory/write', {
    method: 'POST',
    body: { path: currentMemoryPath, content: content },
  }).then(() => {
    showToast(t('memory.saved', { path: currentMemoryPath }), 'success');
    cancelMemoryEdit();
    readMemoryFile(currentMemoryPath);
  }).catch((err) => {
    showToast(t('memory.save_failed', { message: err.message }), 'error');
  });
}

function buildBreadcrumb(path) {
  const parts = path.split('/');
  let html = '<a onclick="loadMemoryTree()">' + escapeHtml(t('memory.workspace_root_link')) + '</a>';
  let current = '';
  for (const part of parts) {
    current += (current ? '/' : '') + part;
    // Store the path in data-path (HTML-escaped) and read it back via this.dataset.path
    // to avoid single-quote injection in inline JS string literals.
    html += ' / <a onclick="readMemoryFile(this.dataset.path)" data-path="' + escapeHtml(current) + '">' + escapeHtml(part) + '</a>';
  }
  return html;
}

function searchMemory(query) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return;

  apiFetch('/api/memory/search', {
    method: 'POST',
    body: { query: normalizedQuery, limit: 20 },
  }).then((data) => {
    const tree = document.getElementById('memory-tree');
    tree.innerHTML = '';
    if (data.results.length === 0) {
      tree.innerHTML = '<div class="tree-item" style="color:var(--text-secondary)">' + escapeHtml(t('memory.no_results')) + '</div>';
      return;
    }
    for (const result of data.results) {
      const item = document.createElement('div');
      item.className = 'search-result';
      const snippet = snippetAround(result.content, normalizedQuery, 120);
      item.innerHTML = '<div class="path">' + escapeHtml(result.path) + '</div>'
        + '<div class="snippet">' + highlightQuery(snippet, normalizedQuery) + '</div>';
      item.addEventListener('click', () => readMemoryFile(result.path));
      tree.appendChild(item);
    }
  }).catch(() => {});
}

function normalizeSearchQuery(query) {
  return (typeof query === 'string' ? query : '').slice(0, MEMORY_SEARCH_QUERY_MAX_LENGTH);
}

function snippetAround(text, query, len) {
  const normalizedQuery = normalizeSearchQuery(query);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(normalizedQuery.toLowerCase());
  if (idx < 0) return text.substring(0, len);
  const start = Math.max(0, idx - Math.floor(len / 2));
  const end = Math.min(text.length, start + len);
  let s = text.substring(start, end);
  if (start > 0) s = '...' + s;
  if (end < text.length) s = s + '...';
  return s;
}

function highlightQuery(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const normalizedQuery = normalizeSearchQuery(query);
  const queryEscaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + queryEscaped + ')', 'gi');
  return escaped.replace(re, '<mark>$1</mark>');
}
// --- Logs ---

const LOG_MAX_ENTRIES = 2000;
let logsPaused = false;
let logBuffer = []; // buffer while paused

function connectLogSSE() {
  if (logEventSource) logEventSource.close();

  logEventSource = new EventSource('/api/logs/events?token=' + encodeURIComponent(token));

  logEventSource.addEventListener('log', (e) => {
    const entry = JSON.parse(e.data);
    if (logsPaused) {
      logBuffer.push(entry);
      return;
    }
    prependLogEntry(entry);
  });

  logEventSource.onerror = () => {
    // Silent reconnect
  };
}

function prependLogEntry(entry) {
  const output = document.getElementById('logs-output');

  // Level filter
  const levelFilter = document.getElementById('logs-level-filter').value;
  const targetFilter = document.getElementById('logs-target-filter').value.trim().toLowerCase();

  const div = document.createElement('div');
  div.className = 'log-entry level-' + entry.level;
  div.setAttribute('data-level', entry.level);
  div.setAttribute('data-target', entry.target);

  const ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = entry.timestamp.substring(11, 23);
  div.appendChild(ts);

  const lvl = document.createElement('span');
  lvl.className = 'log-level';
  lvl.textContent = entry.level.padEnd(5);
  div.appendChild(lvl);

  const tgt = document.createElement('span');
  tgt.className = 'log-target';
  tgt.textContent = entry.target;
  div.appendChild(tgt);

  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = entry.message;
  div.appendChild(msg);

  div.addEventListener('click', () => div.classList.toggle('expanded'));

  // Apply current filters as visibility
  const matchesLevel = levelFilter === 'all' || entry.level === levelFilter;
  const matchesTarget = !targetFilter || entry.target.toLowerCase().includes(targetFilter);
  if (!matchesLevel || !matchesTarget) {
    div.style.display = 'none';
  }

  output.prepend(div);

  // Cap entries (remove oldest at the bottom)
  while (output.children.length > LOG_MAX_ENTRIES) {
    output.removeChild(output.lastChild);
  }

  // Auto-scroll to top (newest entries are at the top)
  if (document.getElementById('logs-autoscroll').checked) {
    output.scrollTop = 0;
  }
}

function toggleLogsPause() {
  logsPaused = !logsPaused;
  const btn = document.getElementById('logs-pause-btn');
  btn.textContent = logsPaused ? t('logs.resume') : t('logs.pause');

  if (!logsPaused) {
    // Flush buffer: oldest-first + prepend naturally puts newest at top
    for (const entry of logBuffer) {
      prependLogEntry(entry);
    }
    logBuffer = [];
  }
}

function clearLogs() {
  if (!confirm(t('logs.clear_confirm'))) return;
  document.getElementById('logs-output').innerHTML = '';
  logBuffer = [];
}

// Re-apply filters when level or target changes
document.getElementById('logs-level-filter').addEventListener('change', applyLogFilters);
document.getElementById('logs-target-filter').addEventListener('input', applyLogFilters);

function applyLogFilters() {
  const levelFilter = document.getElementById('logs-level-filter').value;
  const targetFilter = document.getElementById('logs-target-filter').value.trim().toLowerCase();
  const entries = document.querySelectorAll('#logs-output .log-entry');
  for (const el of entries) {
    const matchesLevel = levelFilter === 'all' || el.getAttribute('data-level') === levelFilter;
    const matchesTarget = !targetFilter || el.getAttribute('data-target').toLowerCase().includes(targetFilter);
    el.style.display = (matchesLevel && matchesTarget) ? '' : 'none';
  }
}

// --- Server-side log level control ---

function setServerLogLevel(level) {
  apiFetch('/api/logs/level', {
    method: 'PUT',
    body: { level },
  })
    .then(data => {
      document.getElementById('logs-server-level').value = data.level;
    })
    .catch(err => console.error('Failed to set server log level:', err));
}

function loadServerLogLevel() {
  apiFetch('/api/logs/level')
    .then(data => {
      document.getElementById('logs-server-level').value = data.level;
    })
    .catch(() => {}); // ignore if not available
}

// --- Extensions ---

function extensionKindLabel(kind) {
  const key = {
    wasm_channel: 'extensions.kind.channel',
    wasm_tool: 'extensions.kind.tool',
    mcp_server: 'extensions.kind.mcp',
  }[kind];
  return key ? t(key) : kind;
}

function setExtensionsLoadedState(isLoaded) {
  const panel = document.getElementById('tab-extensions');
  if (!panel) return;
  panel.dataset.loaded = isLoaded ? 'true' : 'false';
}

function loadExtensions() {
  const extList = document.getElementById('extensions-list');
  const wasmList = document.getElementById('available-wasm-list');
  const mcpList = document.getElementById('mcp-servers-list');
  const toolsTbody = document.getElementById('tools-tbody');
  const toolsEmpty = document.getElementById('tools-empty');

  setExtensionsLoadedState(false);

  // Fetch all three in parallel
  Promise.all([
    apiFetch('/api/extensions').catch(() => ({ extensions: [] })),
    apiFetch('/api/extensions/tools').catch(() => ({ tools: [] })),
    apiFetch('/api/extensions/registry').catch(function(err) { console.warn('registry fetch failed:', err); return { entries: [] }; }),
  ]).then(([extData, toolData, registryData]) => {
    // Render installed extensions
    if (extData.extensions.length === 0) {
      extList.innerHTML = '<div class="empty-state">' + escapeHtml(t('extensions.empty.installed')) + '</div>';
    } else {
      extList.innerHTML = '';
      for (const ext of extData.extensions) {
        extList.appendChild(renderExtensionCard(ext));
      }
    }

    // Split registry entries by kind
    var wasmEntries = registryData.entries.filter(function(e) { return e.kind !== 'mcp_server' && !e.installed; });
    var mcpEntries = registryData.entries.filter(function(e) { return e.kind === 'mcp_server'; });

    // Available WASM extensions
    if (wasmEntries.length === 0) {
      wasmList.innerHTML = '<div class="empty-state">' + escapeHtml(t('extensions.empty.available_wasm')) + '</div>';
    } else {
      wasmList.innerHTML = '';
      for (const entry of wasmEntries) {
        wasmList.appendChild(renderAvailableExtensionCard(entry));
      }
    }

    // MCP servers (show both installed and uninstalled)
    if (mcpEntries.length === 0) {
      mcpList.innerHTML = '<div class="empty-state">' + escapeHtml(t('extensions.empty.mcp')) + '</div>';
    } else {
      mcpList.innerHTML = '';
      for (const entry of mcpEntries) {
        var installedExt = extData.extensions.find(function(e) { return e.name === entry.name; });
        mcpList.appendChild(renderMcpServerCard(entry, installedExt));
      }
    }

    // Render tools
    if (toolData.tools.length === 0) {
      toolsTbody.innerHTML = '';
      toolsEmpty.style.display = 'block';
    } else {
      toolsEmpty.style.display = 'none';
      toolsTbody.innerHTML = toolData.tools.map((t) =>
        '<tr><td>' + escapeHtml(t.name) + '</td><td>' + escapeHtml(t.description) + '</td></tr>'
      ).join('');
    }
  }).finally(() => {
    setExtensionsLoadedState(true);
  });
}

function renderAvailableExtensionCard(entry) {
  const card = document.createElement('div');
  card.className = 'ext-card ext-available';

  const header = document.createElement('div');
  header.className = 'ext-header';

  const name = document.createElement('span');
  name.className = 'ext-name';
  name.textContent = entry.display_name;
  header.appendChild(name);

  const kind = document.createElement('span');
  kind.className = 'ext-kind kind-' + entry.kind;
  kind.textContent = extensionKindLabel(entry.kind);
  header.appendChild(kind);

  card.appendChild(header);

  const desc = document.createElement('div');
  desc.className = 'ext-desc';
  desc.textContent = entry.description;
  card.appendChild(desc);

  if (entry.keywords && entry.keywords.length > 0) {
    const kw = document.createElement('div');
    kw.className = 'ext-keywords';
    kw.textContent = entry.keywords.join(', ');
    card.appendChild(kw);
  }

  const actions = document.createElement('div');
  actions.className = 'ext-actions';

  const installBtn = document.createElement('button');
  installBtn.className = 'btn-ext install';
  installBtn.textContent = t('extensions.action.install');
  installBtn.addEventListener('click', function() {
    installBtn.disabled = true;
    installBtn.textContent = t('extensions.action.installing');
    apiFetch('/api/extensions/install', {
      method: 'POST',
      body: { name: entry.name, kind: entry.kind },
    }).then(function(res) {
      if (res.success) {
        showToast(t('extensions.toast.installed', { name: entry.display_name }), 'success');
        // OAuth popup if auth started during install (builtin creds)
        if (res.auth_url) {
          showToast(t('extensions.toast.opening_auth', { name: entry.display_name }), 'info');
          openOAuthUrl(res.auth_url);
        }
        loadExtensions();
        // Auto-open configure for WASM channels
        if (entry.kind === 'wasm_channel') {
          showConfigureModal(entry.name);
        }
      } else {
        showToast(t('extensions.toast.install_failed', { message: res.message || t('extensions.unknown_error') }), 'error');
        loadExtensions();
      }
    }).catch(function(err) {
      showToast(t('extensions.toast.install_failed', { message: err.message }), 'error');
      loadExtensions();
    });
  });
  actions.appendChild(installBtn);

  card.appendChild(actions);
  return card;
}

function renderMcpServerCard(entry, installedExt) {
  var card = document.createElement('div');
  card.className = 'ext-card' + (installedExt ? '' : ' ext-available');

  var header = document.createElement('div');
  header.className = 'ext-header';

  var name = document.createElement('span');
  name.className = 'ext-name';
  name.textContent = entry.display_name;
  header.appendChild(name);

  var kind = document.createElement('span');
  kind.className = 'ext-kind kind-mcp_server';
  kind.textContent = extensionKindLabel('mcp_server');
  header.appendChild(kind);

  if (installedExt) {
    var authDot = document.createElement('span');
    authDot.className = 'ext-auth-dot ' + (installedExt.authenticated ? 'authed' : 'unauthed');
    authDot.title = installedExt.authenticated ? t('extensions.auth.authenticated') : t('extensions.auth.not_authenticated');
    header.appendChild(authDot);
  }

  card.appendChild(header);

  var desc = document.createElement('div');
  desc.className = 'ext-desc';
  desc.textContent = entry.description;
  card.appendChild(desc);

  var actions = document.createElement('div');
  actions.className = 'ext-actions';

  if (installedExt) {
    if (!installedExt.active) {
      var activateBtn = document.createElement('button');
      activateBtn.className = 'btn-ext activate';
      activateBtn.textContent = t('extensions.action.activate');
      activateBtn.addEventListener('click', function() { activateExtension(installedExt.name); });
      actions.appendChild(activateBtn);
    } else {
      var activeLabel = document.createElement('span');
      activeLabel.className = 'ext-active-label';
      activeLabel.textContent = t('extensions.status.active');
      actions.appendChild(activeLabel);
    }
    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn-ext remove';
    removeBtn.textContent = t('extensions.action.remove');
    removeBtn.addEventListener('click', function() { removeExtension(installedExt.name); });
    actions.appendChild(removeBtn);
  } else {
    var installBtn = document.createElement('button');
    installBtn.className = 'btn-ext install';
    installBtn.textContent = t('extensions.action.install');
    installBtn.addEventListener('click', function() {
      installBtn.disabled = true;
      installBtn.textContent = t('extensions.action.installing');
      apiFetch('/api/extensions/install', {
        method: 'POST',
        body: { name: entry.name, kind: entry.kind },
      }).then(function(res) {
        if (res.success) {
          showToast(t('extensions.toast.installed', { name: entry.display_name }), 'success');
        } else {
          showToast(t('extensions.toast.install_failed', { message: res.message || t('extensions.unknown_error') }), 'error');
        }
        loadExtensions();
      }).catch(function(err) {
        showToast(t('extensions.toast.install_failed', { message: err.message }), 'error');
        loadExtensions();
      });
    });
    actions.appendChild(installBtn);
  }

  card.appendChild(actions);
  return card;
}

function createReconfigureButton(extName) {
  var btn = document.createElement('button');
  btn.className = 'btn-ext configure';
  btn.textContent = t('extensions.action.reconfigure');
  btn.addEventListener('click', function() { showConfigureModal(extName); });
  return btn;
}

function renderExtensionCard(ext) {
  const card = document.createElement('div');
  card.className = 'ext-card';

  const header = document.createElement('div');
  header.className = 'ext-header';

  const name = document.createElement('span');
  name.className = 'ext-name';
  name.textContent = ext.display_name || ext.name;
  header.appendChild(name);

  const kind = document.createElement('span');
  kind.className = 'ext-kind kind-' + ext.kind;
  kind.textContent = extensionKindLabel(ext.kind);
  header.appendChild(kind);

  // Auth dot only for non-WASM-channel extensions (channels use the stepper instead)
  if (ext.kind !== 'wasm_channel') {
    const authDot = document.createElement('span');
    authDot.className = 'ext-auth-dot ' + (ext.authenticated ? 'authed' : 'unauthed');
    authDot.title = ext.authenticated ? t('extensions.auth.authenticated') : t('extensions.auth.not_authenticated');
    header.appendChild(authDot);
  }

  card.appendChild(header);

  // WASM channels get a progress stepper
  if (ext.kind === 'wasm_channel') {
    card.appendChild(renderWasmChannelStepper(ext));
  }

  if (ext.description) {
    const desc = document.createElement('div');
    desc.className = 'ext-desc';
    desc.textContent = ext.description;
    card.appendChild(desc);
  }

  if (ext.url) {
    const url = document.createElement('div');
    url.className = 'ext-url';
    url.textContent = ext.url;
    url.title = ext.url;
    card.appendChild(url);
  }

  if (ext.tools && ext.tools.length > 0) {
    const tools = document.createElement('div');
    tools.className = 'ext-tools';
    tools.textContent = t('extensions.tools.label', { tools: ext.tools.join(', ') });
    card.appendChild(tools);
  }

  // Show activation error for WASM channels
  if (ext.kind === 'wasm_channel' && ext.activation_error) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'ext-error';
    errorDiv.textContent = ext.activation_error;
    card.appendChild(errorDiv);
  }


  const actions = document.createElement('div');
  actions.className = 'ext-actions';

  if (ext.kind === 'wasm_channel') {
    // WASM channels: state-based buttons (no generic Activate)
    var status = ext.activation_status || 'installed';
    if (status === 'active') {
      var activeLabel = document.createElement('span');
      activeLabel.className = 'ext-active-label';
      activeLabel.textContent = t('extensions.status.active');
      actions.appendChild(activeLabel);
      actions.appendChild(createReconfigureButton(ext.name));
    } else if (status === 'pairing') {
      var pairingLabel = document.createElement('span');
      pairingLabel.className = 'ext-pairing-label';
      pairingLabel.textContent = t('extensions.status.awaiting_pairing');
      actions.appendChild(pairingLabel);
      actions.appendChild(createReconfigureButton(ext.name));
    } else if (status === 'failed') {
      actions.appendChild(createReconfigureButton(ext.name));
    } else {
      // installed or configured: show Setup button
      var setupBtn = document.createElement('button');
      setupBtn.className = 'btn-ext configure';
      setupBtn.textContent = t('extensions.action.setup');
      setupBtn.addEventListener('click', function() { showConfigureModal(ext.name); });
      actions.appendChild(setupBtn);
    }
  } else {
    // WASM tools / MCP servers
    const activeLabel = document.createElement('span');
    activeLabel.className = 'ext-active-label';
    activeLabel.textContent = ext.active ? t('extensions.status.active') : t('extensions.status.installed');
    actions.appendChild(activeLabel);

    // MCP servers may be installed but inactive — show Activate button
    if (ext.kind === 'mcp_server' && !ext.active) {
      const activateBtn = document.createElement('button');
      activateBtn.className = 'btn-ext activate';
      activateBtn.textContent = t('extensions.action.activate');
      activateBtn.addEventListener('click', () => activateExtension(ext.name));
      actions.appendChild(activateBtn);
    }

    // Show Configure/Reconfigure button when there are secrets to enter.
    // Skip when has_auth is true but needs_setup is false and not yet authenticated —
    // this means OAuth credentials resolve automatically (builtin/env) and the user
    // just needs to complete the OAuth flow, not fill in a config form.
    if (ext.needs_setup || (ext.has_auth && ext.authenticated)) {
      const configBtn = document.createElement('button');
      configBtn.className = 'btn-ext configure';
      configBtn.textContent = ext.authenticated ? t('extensions.action.reconfigure') : t('extensions.action.configure');
      configBtn.addEventListener('click', () => showConfigureModal(ext.name));
      actions.appendChild(configBtn);
    }
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-ext remove';
  removeBtn.textContent = t('extensions.action.remove');
  removeBtn.addEventListener('click', () => removeExtension(ext.name));
  actions.appendChild(removeBtn);

  card.appendChild(actions);

  // For WASM channels, check for pending pairing requests.
  if (ext.kind === 'wasm_channel') {
    const pairingSection = document.createElement('div');
    pairingSection.className = 'ext-pairing';
    pairingSection.setAttribute('data-channel', ext.name);
    card.appendChild(pairingSection);
    loadPairingRequests(ext.name, pairingSection);
  }

  return card;
}

function activateExtension(name) {
  apiFetch('/api/extensions/' + encodeURIComponent(name) + '/activate', { method: 'POST' })
    .then((res) => {
      if (res.success) {
        // Even on success, the tool may need OAuth (e.g., WASM loaded but no token yet)
        if (res.auth_url) {
          showToast(t('extensions.toast.opening_auth', { name }), 'info');
          openOAuthUrl(res.auth_url);
        }
        loadExtensions();
        return;
      }

      if (res.auth_url) {
        showToast(t('extensions.toast.opening_auth', { name }), 'info');
        openOAuthUrl(res.auth_url);
      } else if (res.awaiting_token) {
        showConfigureModal(name);
      } else {
        showToast(t('extensions.toast.activate_failed', { message: res.message }), 'error');
      }
      loadExtensions();
    })
    .catch((err) => showToast(t('extensions.toast.activate_failed', { message: err.message }), 'error'));
}

function removeExtension(name) {
  if (!confirm(t('extensions.confirm.remove', { name }))) return;
  apiFetch('/api/extensions/' + encodeURIComponent(name) + '/remove', { method: 'POST' })
    .then((res) => {
      if (!res.success) {
        showToast(t('extensions.toast.remove_failed', { message: res.message }), 'error');
      } else {
        showToast(t('extensions.toast.removed', { name }), 'success');
      }
      loadExtensions();
    })
    .catch((err) => showToast(t('extensions.toast.remove_failed', { message: err.message }), 'error'));
}

function showConfigureModal(name) {
  apiFetch('/api/extensions/' + encodeURIComponent(name) + '/setup')
    .then((setup) => {
      if (!setup.secrets || setup.secrets.length === 0) {
        showToast(t('extensions.toast.no_configuration_needed', { name }), 'info');
        return;
      }
      renderConfigureModal(name, setup.secrets);
    })
    .catch((err) => showToast(t('extensions.toast.load_setup_failed', { message: err.message }), 'error'));
}

function renderConfigureModal(name, secrets) {
  closeConfigureModal();
  const overlay = document.createElement('div');
  overlay.className = 'configure-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeConfigureModal();
  });

  const modal = document.createElement('div');
  modal.className = 'configure-modal';

  const header = document.createElement('h3');
  header.textContent = t('extensions.configure.title', { name });
  modal.appendChild(header);

  const form = document.createElement('div');
  form.className = 'configure-form';

  const fields = [];
  for (const secret of secrets) {
    const field = document.createElement('div');
    field.className = 'configure-field';

    const label = document.createElement('label');
    label.textContent = secret.prompt;
    if (secret.optional) {
      const opt = document.createElement('span');
      opt.className = 'field-optional';
      opt.textContent = t('extensions.configure.optional_suffix');
      label.appendChild(opt);
    }
    field.appendChild(label);

    const inputRow = document.createElement('div');
    inputRow.className = 'configure-input-row';

    const input = document.createElement('input');
    input.type = 'password';
    input.name = secret.name;
    input.placeholder = secret.provided ? t('extensions.configure.already_set_placeholder') : '';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitConfigureModal(name, fields);
    });
    inputRow.appendChild(input);

    if (secret.provided) {
      const badge = document.createElement('span');
      badge.className = 'field-provided';
      badge.textContent = '\u2713';
      badge.title = t('extensions.configure.already_configured');
      inputRow.appendChild(badge);
    }
    if (secret.auto_generate && !secret.provided) {
      const hint = document.createElement('span');
      hint.className = 'field-autogen';
      hint.textContent = t('extensions.configure.auto_generated_if_empty');
      inputRow.appendChild(hint);
    }

    field.appendChild(inputRow);
    form.appendChild(field);
    fields.push({ name: secret.name, input: input });
  }

  modal.appendChild(form);

  const actions = document.createElement('div');
  actions.className = 'configure-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn-ext activate';
  submitBtn.textContent = t('common.save');
  submitBtn.addEventListener('click', () => submitConfigureModal(name, fields));
  actions.appendChild(submitBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-ext remove';
  cancelBtn.textContent = t('common.cancel');
  cancelBtn.addEventListener('click', closeConfigureModal);
  actions.appendChild(cancelBtn);

  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  if (fields.length > 0) fields[0].input.focus();
}

function submitConfigureModal(name, fields) {
  const secrets = {};
  for (const f of fields) {
    if (f.input.value.trim()) {
      secrets[f.name] = f.input.value.trim();
    }
  }

  // Disable buttons to prevent double-submit
  var btns = document.querySelectorAll('.configure-actions button');
  btns.forEach(function(b) { b.disabled = true; });

  apiFetch('/api/extensions/' + encodeURIComponent(name) + '/setup', {
    method: 'POST',
    body: { secrets },
  })
    .then((res) => {
      if (res.success) {
        closeConfigureModal();
        if (res.auth_url) {
          // OAuth flow started — open consent popup. The auth_completed SSE will
          // not arrive immediately (it fires after OAuth callback), so show a toast now.
          showToast(t('extensions.toast.opening_oauth', { name }), 'info');
          openOAuthUrl(res.auth_url);
          loadExtensions();
        }
        // For non-OAuth success: the server always broadcasts auth_completed SSE,
        // which will show the toast and refresh extensions — no need to do it here too.
      } else {
        // Keep modal open so the user can correct their input and retry.
        btns.forEach(function(b) { b.disabled = false; });
        showToast(res.message || t('extensions.toast.configuration_failed_generic'), 'error');
      }
    })
    .catch((err) => {
      btns.forEach(function(b) { b.disabled = false; });
      showToast(t('extensions.toast.configuration_failed', { message: err.message }), 'error');
    });
}

function closeConfigureModal() {
  const existing = document.querySelector('.configure-overlay');
  if (existing) existing.remove();
}

// Validate that a server-supplied OAuth URL is HTTPS before opening a popup.
// Rejects javascript:, data:, and other non-HTTPS schemes to prevent URL-injection.
// Uses the URL constructor to safely parse and validate the scheme, which also
// handles non-string values (objects, null, etc.) that would throw on .startsWith().
function openOAuthUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('non-HTTPS protocol: ' + parsed.protocol);
    }
  } catch (e) {
    console.warn('Blocked invalid/non-HTTPS OAuth URL:', url, e.message);
    showToast(t('extensions.toast.invalid_oauth_url'), 'error');
    return;
  }
  window.open(parsed.href, '_blank', 'width=600,height=700');
}

// --- Pairing ---

function loadPairingRequests(channel, container) {
  apiFetch('/api/pairing/' + encodeURIComponent(channel))
    .then(data => {
      container.innerHTML = '';
      if (!data.requests || data.requests.length === 0) return;

      const heading = document.createElement('div');
      heading.className = 'pairing-heading';
      heading.textContent = t('extensions.pairing.pending_requests');
      container.appendChild(heading);

      data.requests.forEach(req => {
        const row = document.createElement('div');
        row.className = 'pairing-row';

        const code = document.createElement('span');
        code.className = 'pairing-code';
        code.textContent = req.code;
        row.appendChild(code);

        const sender = document.createElement('span');
        sender.className = 'pairing-sender';
        sender.textContent = t('extensions.pairing.from_sender', { sender: req.sender_id });
        row.appendChild(sender);

        const btn = document.createElement('button');
        btn.className = 'btn-ext activate';
        btn.textContent = t('extensions.pairing.approve');
        btn.addEventListener('click', () => approvePairing(channel, req.code, container));
        row.appendChild(btn);

        container.appendChild(row);
      });
    })
    .catch(() => {});
}

function approvePairing(channel, code, container) {
  apiFetch('/api/pairing/' + encodeURIComponent(channel) + '/approve', {
    method: 'POST',
    body: { code },
  }).then(res => {
    if (res.success) {
      showToast(t('extensions.toast.pairing_approved'), 'success');
      loadExtensions();
    } else {
      showToast(res.message || t('extensions.toast.approve_failed_generic'), 'error');
    }
  }).catch(err => showToast(t('extensions.toast.error', { message: err.message }), 'error'));
}

function startPairingPoll() {
  stopPairingPoll();
  pairingPollInterval = setInterval(function() {
    document.querySelectorAll('.ext-pairing[data-channel]').forEach(function(el) {
      loadPairingRequests(el.getAttribute('data-channel'), el);
    });
  }, 10000);
}

function stopPairingPoll() {
  if (pairingPollInterval) {
    clearInterval(pairingPollInterval);
    pairingPollInterval = null;
  }
}

// --- WASM channel stepper ---

function renderWasmChannelStepper(ext) {
  var stepper = document.createElement('div');
  stepper.className = 'ext-stepper';

  var status = ext.activation_status || 'installed';

  var steps = [
    { label: t('extensions.step.installed'), key: 'installed' },
    { label: t('extensions.step.configured'), key: 'configured' },
    { label: status === 'pairing' ? t('extensions.step.awaiting_pairing') : t('extensions.step.active'), key: 'active' },
  ];

  var reachedIdx;
  if (status === 'active') reachedIdx = 2;
  else if (status === 'pairing') reachedIdx = 2;
  else if (status === 'failed') reachedIdx = 2;
  else if (status === 'configured') reachedIdx = 1;
  else reachedIdx = 0;

  for (var i = 0; i < steps.length; i++) {
    if (i > 0) {
      var connector = document.createElement('div');
      connector.className = 'stepper-connector' + (i <= reachedIdx ? ' completed' : '');
      stepper.appendChild(connector);
    }

    var step = document.createElement('div');
    var stepState;
    if (i < reachedIdx) {
      stepState = 'completed';
    } else if (i === reachedIdx) {
      if (status === 'failed') {
        stepState = 'failed';
      } else if (status === 'pairing') {
        stepState = 'in-progress';
      } else if (status === 'active' || status === 'configured' || status === 'installed') {
        stepState = 'completed';
      } else {
        stepState = 'pending';
      }
    } else {
      stepState = 'pending';
    }
    step.className = 'stepper-step ' + stepState;

    var circle = document.createElement('span');
    circle.className = 'stepper-circle';
    if (stepState === 'completed') circle.textContent = '\u2713';
    else if (stepState === 'failed') circle.textContent = '\u2717';
    step.appendChild(circle);

    var label = document.createElement('span');
    label.className = 'stepper-label';
    label.textContent = steps[i].label;
    step.appendChild(label);

    stepper.appendChild(step);
  }

  return stepper;
}

// --- Jobs ---

let currentJobId = null;
let currentJobSubTab = 'overview';
let jobFilesTreeState = null;

function humanizeIdentifier(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatJobStateLabel(state) {
  const normalized = String(state || '').trim();
  if (!normalized) return '-';
  const key = 'jobs.state.' + normalized.replace(/\s+/g, '_');
  const translated = t(key);
  return translated !== key ? translated : humanizeIdentifier(normalized);
}

function formatJobDuration(secs) {
  if (secs == null) return '-';
  if (secs < 60) return t('jobs.duration.seconds', { count: secs });
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  if (minutes < 60) {
    return t('jobs.duration.minutes_seconds', { minutes, seconds });
  }
  const hours = Math.floor(minutes / 60);
  return t('jobs.duration.hours_minutes', { hours, minutes: minutes % 60 });
}

function formatActivityRole(role) {
  const normalized = String(role || 'assistant').trim().toLowerCase();
  const key = 'jobs.activity.role.' + normalized;
  const translated = t(key);
  return translated !== key ? translated : normalized;
}

function loadJobs() {
  currentJobId = null;
  jobFilesTreeState = null;

  // Rebuild DOM if renderJobDetail() destroyed it (it wipes .jobs-container innerHTML).
  const container = document.querySelector('.jobs-container');
  if (!document.getElementById('jobs-summary')) {
    container.innerHTML =
      '<div class="jobs-summary" id="jobs-summary"></div>'
      + '<table class="jobs-table" id="jobs-table"><thead><tr>'
      + '<th>' + escapeHtml(t('jobs.table.id')) + '</th>'
      + '<th>' + escapeHtml(t('jobs.table.title')) + '</th>'
      + '<th>' + escapeHtml(t('jobs.table.status')) + '</th>'
      + '<th>' + escapeHtml(t('jobs.table.created')) + '</th>'
      + '<th>' + escapeHtml(t('jobs.table.actions')) + '</th>'
      + '</tr></thead><tbody id="jobs-tbody"></tbody></table>'
      + '<div class="empty-state" id="jobs-empty" style="display:none">' + escapeHtml(t('jobs.empty')) + '</div>';
  }

  Promise.all([
    apiFetch('/api/jobs/summary'),
    apiFetch('/api/jobs'),
  ]).then(([summary, jobList]) => {
    renderJobsSummary(summary);
    renderJobsList(jobList.jobs);
  }).catch(() => {});
}

function renderJobsSummary(s) {
  document.getElementById('jobs-summary').innerHTML = ''
    + summaryCard(t('jobs.summary.total'), s.total, '')
    + summaryCard(t('jobs.summary.in_progress'), s.in_progress, 'active')
    + summaryCard(t('jobs.summary.completed'), s.completed, 'completed')
    + summaryCard(t('jobs.summary.failed'), s.failed, 'failed')
    + summaryCard(t('jobs.summary.stuck'), s.stuck, 'stuck');
}

function summaryCard(label, count, cls) {
  return '<div class="summary-card ' + cls + '">'
    + '<div class="count">' + count + '</div>'
    + '<div class="label">' + label + '</div>'
    + '</div>';
}

function renderJobsList(jobs) {
  const tbody = document.getElementById('jobs-tbody');
  const empty = document.getElementById('jobs-empty');

  if (jobs.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = jobs.map((job) => {
    const shortId = job.id.substring(0, 8);
    const stateClass = job.state.replace(' ', '_');

    let actionBtns = '';
    if (job.state === 'pending' || job.state === 'in_progress') {
      actionBtns = '<button class="btn-cancel" onclick="event.stopPropagation(); cancelJob(\'' + job.id + '\')">' + escapeHtml(t('jobs.action.cancel')) + '</button>';
    }
    // Retry is only shown in the detail view where can_restart is available.

    return '<tr class="job-row" onclick="openJobDetail(\'' + job.id + '\')">'
      + '<td title="' + escapeHtml(job.id) + '">' + shortId + '</td>'
      + '<td>' + escapeHtml(job.title) + '</td>'
      + '<td><span class="badge ' + stateClass + '">' + escapeHtml(formatJobStateLabel(job.state)) + '</span></td>'
      + '<td>' + formatDate(job.created_at) + '</td>'
      + '<td>' + actionBtns + '</td>'
      + '</tr>';
  }).join('');
}

function cancelJob(jobId) {
  if (!confirm(t('jobs.confirm_cancel'))) return;
  apiFetch('/api/jobs/' + jobId + '/cancel', { method: 'POST' })
    .then(() => {
      showToast(t('jobs.cancelled'), 'success');
      if (currentJobId) openJobDetail(currentJobId);
      else loadJobs();
    })
    .catch((err) => {
      showToast(t('jobs.cancel_failed', { message: err.message }), 'error');
    });
}

function restartJob(jobId) {
  apiFetch('/api/jobs/' + jobId + '/restart', { method: 'POST' })
    .then((res) => {
      showToast(t('jobs.restarted_as', { id: (res.new_job_id || '').substring(0, 8) }), 'success');
    })
    .catch((err) => {
      showToast(t('jobs.restart_failed', { message: err.message }), 'error');
    })
    .finally(() => {
      loadJobs();
    });
}

function openJobDetail(jobId) {
  currentJobId = jobId;
  currentJobSubTab = 'activity';
  apiFetch('/api/jobs/' + jobId).then((job) => {
    renderJobDetail(job);
  }).catch((err) => {
    addMessage('system', t('jobs.load_failed', { message: err.message }));
    closeJobDetail();
  });
}

function closeJobDetail() {
  currentJobId = null;
  jobFilesTreeState = null;
  loadJobs();
}

function renderJobDetail(job) {
  const container = document.querySelector('.jobs-container');
  const stateClass = job.state.replace(' ', '_');

  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'job-detail-header';

  let headerHtml = '<button class="btn-back" onclick="closeJobDetail()">&larr; ' + escapeHtml(t('jobs.back')) + '</button>'
    + '<h2>' + escapeHtml(job.title) + '</h2>'
    + '<span class="badge ' + stateClass + '">' + escapeHtml(formatJobStateLabel(job.state)) + '</span>';

  if ((job.state === 'failed' || job.state === 'interrupted') && job.can_restart === true) {
    headerHtml += '<button class="btn-restart" onclick="restartJob(\'' + job.id + '\')">' + escapeHtml(t('jobs.action.retry')) + '</button>';
  }
  if (job.browse_url) {
    headerHtml += '<a class="btn-browse" href="' + escapeHtml(job.browse_url) + '" target="_blank">' + escapeHtml(t('jobs.action.browse_files')) + '</a>';
  }

  header.innerHTML = headerHtml;
  container.appendChild(header);

  // Sub-tab bar
  const tabs = document.createElement('div');
  tabs.className = 'job-detail-tabs';
  const subtabs = ['overview', 'activity', 'files'];
  for (const st of subtabs) {
    const btn = document.createElement('button');
    btn.textContent = t('jobs.subtab.' + st);
    btn.className = st === currentJobSubTab ? 'active' : '';
    btn.addEventListener('click', () => {
      currentJobSubTab = st;
      renderJobDetail(job);
    });
    tabs.appendChild(btn);
  }
  container.appendChild(tabs);

  // Content
  const content = document.createElement('div');
  content.className = 'job-detail-content';
  container.appendChild(content);

  switch (currentJobSubTab) {
    case 'overview': renderJobOverview(content, job); break;
    case 'files': renderJobFiles(content, job); break;
    case 'activity': renderJobActivity(content, job); break;
  }
}

function metaItem(label, value) {
  return '<div class="meta-item"><div class="meta-label">' + escapeHtml(label)
    + '</div><div class="meta-value">' + escapeHtml(String(value != null ? value : '-'))
    + '</div></div>';
}

function renderJobOverview(container, job) {
  // Metadata grid
  const grid = document.createElement('div');
  grid.className = 'job-meta-grid';
  grid.innerHTML = metaItem(t('jobs.meta.id'), job.id)
    + metaItem(t('jobs.meta.state'), formatJobStateLabel(job.state))
    + metaItem(t('jobs.meta.created'), formatDate(job.created_at))
    + metaItem(t('jobs.meta.started'), formatDate(job.started_at))
    + metaItem(t('jobs.meta.completed'), formatDate(job.completed_at))
    + metaItem(t('jobs.meta.duration'), formatJobDuration(job.elapsed_secs))
    + (job.job_mode ? metaItem(t('jobs.meta.mode'), job.job_mode) : '');
  container.appendChild(grid);

  // Description
  if (job.description) {
    const descSection = document.createElement('div');
    descSection.className = 'job-description';
    const descHeader = document.createElement('h3');
    descHeader.textContent = t('jobs.section.description');
    descSection.appendChild(descHeader);
    const descBody = document.createElement('div');
    descBody.className = 'job-description-body';
    descBody.innerHTML = renderMarkdown(job.description);
    descSection.appendChild(descBody);
    container.appendChild(descSection);
  }

  // State transitions timeline
  if (job.transitions.length > 0) {
    const timelineSection = document.createElement('div');
    timelineSection.className = 'job-timeline-section';
    const tlHeader = document.createElement('h3');
    tlHeader.textContent = t('jobs.section.state_transitions');
    timelineSection.appendChild(tlHeader);

    const timeline = document.createElement('div');
    timeline.className = 'timeline';
    for (const t of job.transitions) {
      const entry = document.createElement('div');
      entry.className = 'timeline-entry';
      const dot = document.createElement('div');
      dot.className = 'timeline-dot';
      entry.appendChild(dot);
      const info = document.createElement('div');
      info.className = 'timeline-info';
      info.innerHTML = '<span class="badge ' + t.from.replace(' ', '_') + '">' + escapeHtml(formatJobStateLabel(t.from)) + '</span>'
        + ' &rarr; '
        + '<span class="badge ' + t.to.replace(' ', '_') + '">' + escapeHtml(formatJobStateLabel(t.to)) + '</span>'
        + '<span class="timeline-time">' + formatDate(t.timestamp) + '</span>'
        + (t.reason ? '<div class="timeline-reason">' + escapeHtml(t.reason) + '</div>' : '');
      entry.appendChild(info);
      timeline.appendChild(entry);
    }
    timelineSection.appendChild(timeline);
    container.appendChild(timelineSection);
  }
}

function renderJobFiles(container, job) {
  container.innerHTML = '<div class="job-files">'
    + '<div class="job-files-sidebar"><div class="job-files-tree"></div></div>'
    + '<div class="job-files-viewer"><div class="empty-state">' + escapeHtml(t('jobs.files.select')) + '</div></div>'
    + '</div>';

  container._jobId = job ? job.id : null;

  apiFetch('/api/jobs/' + job.id + '/files/list?path=').then((data) => {
    jobFilesTreeState = data.entries.map((e) => ({
      name: e.name,
      path: e.path,
      is_dir: e.is_dir,
      children: e.is_dir ? null : undefined,
      expanded: false,
      loaded: false,
    }));
    renderJobFilesTree();
  }).catch(() => {
    const treeContainer = document.querySelector('.job-files-tree');
    if (treeContainer) {
      treeContainer.innerHTML = '<div class="tree-item" style="color:var(--text-secondary)">' + escapeHtml(t('jobs.files.no_project_files')) + '</div>';
    }
  });
}

function renderJobFilesTree() {
  const treeContainer = document.querySelector('.job-files-tree');
  if (!treeContainer) return;
  treeContainer.innerHTML = '';
  if (!jobFilesTreeState || jobFilesTreeState.length === 0) {
    treeContainer.innerHTML = '<div class="tree-item" style="color:var(--text-secondary)">' + escapeHtml(t('jobs.files.no_workspace_files')) + '</div>';
    return;
  }
  renderJobFileNodes(jobFilesTreeState, treeContainer, 0);
}

function renderJobFileNodes(nodes, container, depth) {
  for (const node of nodes) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = (depth * 16 + 8) + 'px';

    if (node.is_dir) {
      const arrow = document.createElement('span');
      arrow.className = 'expand-arrow' + (node.expanded ? ' expanded' : '');
      arrow.textContent = '\u25B6';
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleJobFileExpand(node);
      });
      row.appendChild(arrow);

      const label = document.createElement('span');
      label.className = 'tree-label dir';
      label.textContent = node.name;
      label.addEventListener('click', () => toggleJobFileExpand(node));
      row.appendChild(label);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'expand-arrow-spacer';
      row.appendChild(spacer);

      const label = document.createElement('span');
      label.className = 'tree-label file';
      label.textContent = node.name;
      label.addEventListener('click', () => readJobFile(node.path));
      row.appendChild(label);
    }

    container.appendChild(row);

    if (node.is_dir && node.expanded && node.children) {
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children';
      renderJobFileNodes(node.children, childContainer, depth + 1);
      container.appendChild(childContainer);
    }
  }
}

function getJobId() {
  const container = document.querySelector('.job-detail-content');
  return (container && container._jobId) || null;
}

function toggleJobFileExpand(node) {
  if (node.expanded) {
    node.expanded = false;
    renderJobFilesTree();
    return;
  }
  if (node.loaded) {
    node.expanded = true;
    renderJobFilesTree();
    return;
  }
  const jobId = getJobId();
  apiFetch('/api/jobs/' + jobId + '/files/list?path=' + encodeURIComponent(node.path)).then((data) => {
    node.children = data.entries.map((e) => ({
      name: e.name,
      path: e.path,
      is_dir: e.is_dir,
      children: e.is_dir ? null : undefined,
      expanded: false,
      loaded: false,
    }));
    node.loaded = true;
    node.expanded = true;
    renderJobFilesTree();
  }).catch(() => {});
}

function readJobFile(path) {
  const viewer = document.querySelector('.job-files-viewer');
  if (!viewer) return;
  const jobId = getJobId();
  apiFetch('/api/jobs/' + jobId + '/files/read?path=' + encodeURIComponent(path)).then((data) => {
    viewer.innerHTML = '<div class="job-files-path">' + escapeHtml(path) + '</div>'
      + '<pre class="job-files-content">' + escapeHtml(data.content) + '</pre>';
  }).catch((err) => {
    viewer.innerHTML = '<div class="empty-state">' + escapeHtml(t('jobs.files.read_error', { message: err.message })) + '</div>';
  });
}

// --- Activity tab (unified for all sandbox jobs) ---

let activityCurrentJobId = null;
// Track how many live SSE events we've already rendered so refreshActivityTab
// only appends new ones (avoids duplicates on each SSE tick).
let activityRenderedLiveIndex = 0;

function renderJobActivity(container, job) {
  activityCurrentJobId = job ? job.id : null;
  activityRenderedLiveIndex = 0;

  let html = '<div class="activity-toolbar">'
    + '<select id="activity-type-filter">'
    + '<option value="all">' + escapeHtml(t('jobs.activity.filter.all')) + '</option>'
    + '<option value="message">' + escapeHtml(t('jobs.activity.filter.messages')) + '</option>'
    + '<option value="tool_use">' + escapeHtml(t('jobs.activity.filter.tool_calls')) + '</option>'
    + '<option value="tool_result">' + escapeHtml(t('jobs.activity.filter.results')) + '</option>'
    + '</select>'
    + '<label class="logs-checkbox"><input type="checkbox" id="activity-autoscroll" checked> ' + escapeHtml(t('jobs.activity.autoscroll')) + '</label>'
    + '</div>'
    + '<div class="activity-terminal" id="activity-terminal"></div>';

  if (job && job.can_prompt === true) {
    html += '<div class="activity-input-bar" id="activity-input-bar">'
      + '<input type="text" id="activity-prompt-input" placeholder="' + escapeHtml(t('jobs.activity.followup_placeholder')) + '" />'
      + '<button id="activity-send-btn">' + escapeHtml(t('jobs.activity.send')) + '</button>'
      + '<button id="activity-done-btn" title="' + escapeHtml(t('jobs.activity.done_title')) + '">' + escapeHtml(t('jobs.activity.done')) + '</button>'
      + '</div>';
  }

  container.innerHTML = html;

  document.getElementById('activity-type-filter').addEventListener('change', applyActivityFilter);

  const terminal = document.getElementById('activity-terminal');
  const input = document.getElementById('activity-prompt-input');
  const sendBtn = document.getElementById('activity-send-btn');
  const doneBtn = document.getElementById('activity-done-btn');

  if (sendBtn) sendBtn.addEventListener('click', () => sendJobPrompt(job.id, false));
  if (doneBtn) doneBtn.addEventListener('click', () => sendJobPrompt(job.id, true));
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendJobPrompt(job.id, false);
  });

  // Load persisted events from DB, then catch up with any live SSE events
  apiFetch('/api/jobs/' + job.id + '/events').then((data) => {
    if (data.events && data.events.length > 0) {
      for (const evt of data.events) {
        appendActivityEvent(terminal, evt.event_type, evt.data);
      }
    }
    appendNewLiveEvents(terminal, job.id);
  }).catch(() => {
    appendNewLiveEvents(terminal, job.id);
  });
}

function appendNewLiveEvents(terminal, jobId) {
  const live = jobEvents.get(jobId) || [];
  for (let i = activityRenderedLiveIndex; i < live.length; i++) {
    const evt = live[i];
    appendActivityEvent(terminal, evt.type.replace('job_', ''), evt.data);
  }
  activityRenderedLiveIndex = live.length;
  const autoScroll = document.getElementById('activity-autoscroll');
  if (!autoScroll || autoScroll.checked) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function applyActivityFilter() {
  const filter = document.getElementById('activity-type-filter').value;
  const events = document.querySelectorAll('#activity-terminal .activity-event');
  for (const el of events) {
    if (filter === 'all') {
      el.style.display = '';
    } else {
      el.style.display = el.getAttribute('data-event-type') === filter ? '' : 'none';
    }
  }
}

function appendActivityEvent(terminal, eventType, data) {
  if (!terminal) return;
  const el = document.createElement('div');
  el.className = 'activity-event activity-event-' + eventType;
  el.setAttribute('data-event-type', eventType);

  // Respect current filter
  const filterEl = document.getElementById('activity-type-filter');
  if (filterEl && filterEl.value !== 'all' && filterEl.value !== eventType) {
    el.style.display = 'none';
  }

  switch (eventType) {
    case 'message':
      el.innerHTML = '<span class="activity-role">' + escapeHtml(formatActivityRole(data.role || 'assistant')) + '</span> '
        + '<span class="activity-content">' + escapeHtml(data.content || '') + '</span>';
      break;
    case 'tool_use':
      el.innerHTML = '<details class="activity-tool-block"><summary>'
        + '<span class="activity-tool-icon">&#9881;</span> '
        + escapeHtml(data.tool_name || t('jobs.activity.tool_default'))
        + '</summary><pre class="activity-tool-input">'
        + escapeHtml(typeof data.input === 'string' ? data.input : JSON.stringify(data.input, null, 2))
        + '</pre></details>';
      break;
    case 'tool_result': {
      const trSuccess = data.success !== false;
      const trIcon = trSuccess ? '&#10003;' : '&#10007;';
      const trOutput = data.output || data.error || '';
      const trClass = 'activity-tool-block activity-tool-result'
        + (trSuccess ? '' : ' activity-tool-error');
      el.innerHTML = '<details class="' + trClass + '"><summary>'
        + '<span class="activity-tool-icon">' + trIcon + '</span> '
        + escapeHtml(data.tool_name || t('jobs.activity.result_default'))
        + '</summary><pre class="activity-tool-output">'
        + escapeHtml(trOutput)
        + '</pre></details>';
      break;
    }
    case 'status':
      el.innerHTML = '<span class="activity-status">' + escapeHtml(data.message || '') + '</span>';
      break;
    case 'result':
      el.className += ' activity-final';
      const success = data.success !== false;
      el.innerHTML = '<span class="activity-result-status" data-success="' + success + '">'
        + escapeHtml(data.message || data.error || data.status || t('jobs.activity.result_done')) + '</span>';
      if (data.session_id) {
        el.innerHTML += ' <span class="activity-session-id">' + escapeHtml(t('jobs.activity.session', { id: data.session_id })) + '</span>';
      }
      break;
    default:
      el.innerHTML = '<span class="activity-status">' + escapeHtml(JSON.stringify(data)) + '</span>';
  }

  terminal.appendChild(el);
}

function refreshActivityTab(jobId) {
  if (activityCurrentJobId !== jobId) return;
  if (currentJobSubTab !== 'activity') return;
  const terminal = document.getElementById('activity-terminal');
  if (!terminal) return;
  appendNewLiveEvents(terminal, jobId);
}

function sendJobPrompt(jobId, done) {
  const input = document.getElementById('activity-prompt-input');
  const content = input ? input.value.trim() : '';
  if (!content && !done) return;

  apiFetch('/api/jobs/' + jobId + '/prompt', {
    method: 'POST',
    body: { content: content || '(done)', done: done },
  }).then(() => {
    if (input) input.value = '';
    if (done) {
      const bar = document.getElementById('activity-input-bar');
      if (bar) bar.innerHTML = '<span class="activity-status">' + escapeHtml(t('jobs.activity.done_sent')) + '</span>';
    }
  }).catch((err) => {
    const terminal = document.getElementById('activity-terminal');
    if (terminal) {
      appendActivityEvent(terminal, 'status', { message: t('jobs.activity.failed_send', { message: err.message }) });
    }
  });
}

// --- Routines ---

let currentRoutineId = null;

function formatRoutineStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return '-';
  const key = 'routines.status.' + normalized.replace(/\s+/g, '_');
  const translated = t(key);
  return translated !== key ? translated : humanizeIdentifier(normalized);
}

function formatRoutineRunStatusLabel(status) {
  const normalized = String(status || '').trim();
  if (!normalized) return '-';
  const key = 'routines.run_status.' + normalized.toLowerCase().replace(/\s+/g, '_');
  const translated = t(key);
  return translated !== key ? translated : humanizeIdentifier(normalized);
}

function loadRoutines() {
  currentRoutineId = null;

  // Restore list view if detail was open
  const detail = document.getElementById('routine-detail');
  if (detail) detail.style.display = 'none';
  const table = document.getElementById('routines-table');
  if (table) table.style.display = '';

  Promise.all([
    apiFetch('/api/routines/summary'),
    apiFetch('/api/routines'),
  ]).then(([summary, listData]) => {
    renderRoutinesSummary(summary);
    renderRoutinesList(listData.routines);
  }).catch(() => {});
}

function renderRoutinesSummary(s) {
  document.getElementById('routines-summary').innerHTML = ''
    + summaryCard(t('routines.summary.total'), s.total, '')
    + summaryCard(t('routines.summary.enabled'), s.enabled, 'active')
    + summaryCard(t('routines.summary.disabled'), s.disabled, '')
    + summaryCard(t('routines.summary.failing'), s.failing, 'failed')
    + summaryCard(t('routines.summary.runs_today'), s.runs_today, 'completed');
}

function renderRoutinesList(routines) {
  const tbody = document.getElementById('routines-tbody');
  const empty = document.getElementById('routines-empty');

  if (!routines || routines.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = routines.map((r) => {
    const statusClass = r.status === 'active' ? 'completed'
      : r.status === 'failing' ? 'failed'
      : 'pending';

    const toggleLabel = r.enabled ? t('routines.action.disable') : t('routines.action.enable');
    const toggleClass = r.enabled ? 'btn-cancel' : 'btn-restart';

    return '<tr class="routine-row" onclick="openRoutineDetail(\'' + r.id + '\')">'
      + '<td>' + escapeHtml(r.name) + '</td>'
      + '<td>' + escapeHtml(r.trigger_summary) + '</td>'
      + '<td>' + escapeHtml(r.action_type) + '</td>'
      + '<td>' + formatRelativeTime(r.last_run_at) + '</td>'
      + '<td>' + formatRelativeTime(r.next_fire_at) + '</td>'
      + '<td>' + r.run_count + '</td>'
      + '<td><span class="badge ' + statusClass + '">' + escapeHtml(formatRoutineStatusLabel(r.status)) + '</span></td>'
      + '<td>'
      + '<button class="' + toggleClass + '" onclick="event.stopPropagation(); toggleRoutine(\'' + r.id + '\')">' + toggleLabel + '</button> '
      + '<button class="btn-restart" onclick="event.stopPropagation(); triggerRoutine(\'' + r.id + '\')">' + escapeHtml(t('routines.action.run')) + '</button> '
      + '<button class="btn-cancel" onclick="event.stopPropagation(); deleteRoutine(\'' + r.id + '\', \'' + escapeHtml(r.name) + '\')">' + escapeHtml(t('routines.action.delete')) + '</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

function openRoutineDetail(id) {
  currentRoutineId = id;
  apiFetch('/api/routines/' + id).then((routine) => {
    renderRoutineDetail(routine);
  }).catch((err) => {
    showToast(t('routines.load_failed', { message: err.message }), 'error');
  });
}

function closeRoutineDetail() {
  currentRoutineId = null;
  loadRoutines();
}

function renderRoutineDetail(routine) {
  const table = document.getElementById('routines-table');
  if (table) table.style.display = 'none';
  document.getElementById('routines-empty').style.display = 'none';

  const detail = document.getElementById('routine-detail');
  detail.style.display = 'block';

  const statusClass = !routine.enabled ? 'pending'
    : routine.consecutive_failures > 0 ? 'failed'
    : 'completed';
  const statusLabel = !routine.enabled ? 'disabled'
    : routine.consecutive_failures > 0 ? 'failing'
    : 'active';

  let html = '<div class="job-detail-header">'
    + '<button class="btn-back" onclick="closeRoutineDetail()">&larr; ' + escapeHtml(t('routines.back')) + '</button>'
    + '<h2>' + escapeHtml(routine.name) + '</h2>'
    + '<span class="badge ' + statusClass + '">' + escapeHtml(formatRoutineStatusLabel(statusLabel)) + '</span>'
    + '</div>';

  // Metadata grid
  html += '<div class="job-meta-grid">'
    + metaItem(t('routines.meta.id'), routine.id)
    + metaItem(t('routines.meta.enabled'), routine.enabled ? t('routines.meta.yes') : t('routines.meta.no'))
    + metaItem(t('routines.meta.run_count'), routine.run_count)
    + metaItem(t('routines.meta.failures'), routine.consecutive_failures)
    + metaItem(t('routines.meta.last_run'), formatDate(routine.last_run_at))
    + metaItem(t('routines.meta.next_fire'), formatDate(routine.next_fire_at))
    + metaItem(t('routines.meta.created'), formatDate(routine.created_at))
    + '</div>';

  // Description
  if (routine.description) {
    html += '<div class="job-description"><h3>' + escapeHtml(t('routines.section.description')) + '</h3>'
      + '<div class="job-description-body">' + escapeHtml(routine.description) + '</div></div>';
  }

  // Trigger config
  html += '<div class="job-description"><h3>' + escapeHtml(t('routines.section.trigger')) + '</h3>'
    + '<pre class="action-json">' + escapeHtml(JSON.stringify(routine.trigger, null, 2)) + '</pre></div>';

  // Action config
  html += '<div class="job-description"><h3>' + escapeHtml(t('routines.section.action')) + '</h3>'
    + '<pre class="action-json">' + escapeHtml(JSON.stringify(routine.action, null, 2)) + '</pre></div>';

  // Recent runs
  if (routine.recent_runs && routine.recent_runs.length > 0) {
    html += '<div class="job-timeline-section"><h3>' + escapeHtml(t('routines.section.recent_runs')) + '</h3>'
      + '<table class="routines-table"><thead><tr>'
      + '<th>' + escapeHtml(t('routines.recent.trigger')) + '</th>'
      + '<th>' + escapeHtml(t('routines.recent.started')) + '</th>'
      + '<th>' + escapeHtml(t('routines.recent.completed')) + '</th>'
      + '<th>' + escapeHtml(t('routines.recent.status')) + '</th>'
      + '<th>' + escapeHtml(t('routines.recent.summary')) + '</th>'
      + '<th>' + escapeHtml(t('routines.recent.tokens')) + '</th>'
      + '</tr></thead><tbody>';
    for (const run of routine.recent_runs) {
      const runStatusClass = run.status === 'Ok' ? 'completed'
        : run.status === 'Failed' ? 'failed'
        : run.status === 'Attention' ? 'stuck'
        : 'in_progress';
      html += '<tr>'
        + '<td>' + escapeHtml(run.trigger_type) + '</td>'
        + '<td>' + formatDate(run.started_at) + '</td>'
        + '<td>' + formatDate(run.completed_at) + '</td>'
        + '<td><span class="badge ' + runStatusClass + '">' + escapeHtml(formatRoutineRunStatusLabel(run.status)) + '</span></td>'
        + '<td>' + escapeHtml(run.result_summary || '-')
          + (run.job_id ? ' <a href="#" onclick="event.preventDefault(); switchTab(\'jobs\'); openJobDetail(\'' + run.job_id + '\')">[' + escapeHtml(t('routines.view_job')) + ']</a>' : '')
          + '</td>'
        + '<td>' + (run.tokens_used != null ? run.tokens_used : '-') + '</td>'
        + '</tr>';
    }
    html += '</tbody></table></div>';
  }

  detail.innerHTML = html;
}

function triggerRoutine(id) {
  apiFetch('/api/routines/' + id + '/trigger', { method: 'POST' })
    .then(() => {
      showToast(t('routines.triggered'), 'success');
      if (currentRoutineId === id) openRoutineDetail(id);
      else loadRoutines();
    })
    .catch((err) => showToast(t('routines.trigger_failed', { message: err.message }), 'error'));
}

function toggleRoutine(id) {
  apiFetch('/api/routines/' + id + '/toggle', { method: 'POST' })
    .then((res) => {
      showToast(t('routines.toggled', { status: formatRoutineStatusLabel(res.status || 'toggled') }), 'success');
      if (currentRoutineId) openRoutineDetail(currentRoutineId);
      else loadRoutines();
    })
    .catch((err) => showToast(t('routines.toggle_failed', { message: err.message }), 'error'));
}

function deleteRoutine(id, name) {
  if (!confirm(t('routines.delete_confirm', { name }))) return;
  apiFetch('/api/routines/' + id, { method: 'DELETE' })
    .then(() => {
      showToast(t('routines.deleted'), 'success');
      if (currentRoutineId === id) closeRoutineDetail();
      else loadRoutines();
    })
    .catch((err) => showToast(t('routines.delete_failed', { message: err.message }), 'error'));
}

function formatRelativeTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const absDiff = Math.abs(diffMs);
  const future = diffMs < 0;

  if (absDiff < 60000) return future ? t('routines.relative.in_less_than_minute') : t('routines.relative.less_than_minute_ago');
  if (absDiff < 3600000) {
    const m = Math.floor(absDiff / 60000);
    return future ? t('routines.relative.in_minutes', { count: m }) : t('routines.relative.minutes_ago', { count: m });
  }
  if (absDiff < 86400000) {
    const h = Math.floor(absDiff / 3600000);
    return future ? t('routines.relative.in_hours', { count: h }) : t('routines.relative.hours_ago', { count: h });
  }
  const days = Math.floor(absDiff / 86400000);
  return future ? t('routines.relative.in_days', { count: days }) : t('routines.relative.days_ago', { count: days });
}

// --- Gateway status widget ---

let gatewayStatusInterval = null;

function startGatewayStatusPolling() {
  fetchGatewayStatus();
  gatewayStatusInterval = setInterval(fetchGatewayStatus, 30000);
}

function formatTokenCount(n) {
  if (n == null || n === 0) return '0';
  try {
    return new Intl.NumberFormat(activeLocale(), {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(n);
  } catch (_) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return '' + n;
  }
}

function formatCost(costStr) {
  if (!costStr) return '$0.00';
  var n = parseFloat(costStr);
  try {
    return new Intl.NumberFormat(activeLocale(), {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: n < 0.01 ? 4 : 2,
      maximumFractionDigits: n < 0.01 ? 4 : 2,
    }).format(n);
  } catch (_) {
    if (n < 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
  }
}

function formatGatewayDuration(secs) {
  if (secs == null) return '-';
  if (secs < 60) return t('gateway.duration.seconds', { count: secs });
  var minutes = Math.floor(secs / 60);
  var seconds = secs % 60;
  if (minutes < 60) return t('gateway.duration.minutes_seconds', { minutes, seconds });
  var hours = Math.floor(minutes / 60);
  return t('gateway.duration.hours_minutes', { hours, minutes: minutes % 60 });
}

function shortModelName(model) {
  // Strip provider prefix and shorten common model names
  var m = model.indexOf('/') >= 0 ? model.split('/').pop() : model;
  // Shorten dated suffixes
  m = m.replace(/-20\d{6}$/, '');
  return m;
}

function fetchGatewayStatus() {
  apiFetch('/api/gateway/status').then(function(data) {
    var popover = document.getElementById('gateway-popover');
    var html = '';

    // Connection info
    html += '<div class="gw-section-label">' + escapeHtml(t('gateway.section.connections')) + '</div>';
    html += '<div class="gw-stat"><span>' + escapeHtml(t('gateway.stat.sse')) + '</span><span>' + (data.sse_connections || 0) + '</span></div>';
    html += '<div class="gw-stat"><span>' + escapeHtml(t('gateway.stat.websocket')) + '</span><span>' + (data.ws_connections || 0) + '</span></div>';
    html += '<div class="gw-stat"><span>' + escapeHtml(t('gateway.stat.uptime')) + '</span><span>' + escapeHtml(formatGatewayDuration(data.uptime_secs)) + '</span></div>';

    // Cost tracker
    if (data.daily_cost != null) {
      html += '<div class="gw-divider"></div>';
      html += '<div class="gw-section-label">' + escapeHtml(t('gateway.section.cost_today')) + '</div>';
      html += '<div class="gw-stat"><span>' + escapeHtml(t('gateway.stat.spent')) + '</span><span>' + formatCost(data.daily_cost) + '</span></div>';
      if (data.actions_this_hour != null) {
        html += '<div class="gw-stat"><span>' + escapeHtml(t('gateway.stat.actions_per_hour')) + '</span><span>' + data.actions_this_hour + '</span></div>';
      }
    }

    // Per-model token usage
    if (data.model_usage && data.model_usage.length > 0) {
      html += '<div class="gw-divider"></div>';
      html += '<div class="gw-section-label">' + escapeHtml(t('gateway.section.token_usage')) + '</div>';
      data.model_usage.sort(function(a, b) {
        return (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens);
      });
      for (var i = 0; i < data.model_usage.length; i++) {
        var m = data.model_usage[i];
        var name = escapeHtml(shortModelName(m.model));
        html += '<div class="gw-model-row">'
          + '<span class="gw-model-name">' + name + '</span>'
          + '<span class="gw-model-cost">' + escapeHtml(formatCost(m.cost)) + '</span>'
          + '</div>';
        html += '<div class="gw-token-detail">'
          + '<span>' + escapeHtml(t('gateway.token.in', { count: formatTokenCount(m.input_tokens) })) + '</span>'
          + '<span>' + escapeHtml(t('gateway.token.out', { count: formatTokenCount(m.output_tokens) })) + '</span>'
          + '</div>';
      }
    }

    popover.innerHTML = html;
  }).catch(function() {});
}

// Show/hide popover on hover
document.getElementById('gateway-status-trigger').addEventListener('mouseenter', () => {
  document.getElementById('gateway-popover').classList.add('visible');
});
document.getElementById('gateway-status-trigger').addEventListener('mouseleave', () => {
  document.getElementById('gateway-popover').classList.remove('visible');
});

// --- TEE attestation ---

let teeInfo = null;
let teeReportCache = null;
let teeReportLoading = false;

function teeApiBase() {
  var parts = window.location.hostname.split('.');
  if (parts.length < 2) return null;
  var domain = parts.slice(1).join('.');
  return window.location.protocol + '//api.' + domain;
}

function teeInstanceName() {
  return window.location.hostname.split('.')[0];
}

function checkTeeStatus() {
  var base = teeApiBase();
  if (!base) return;
  var name = teeInstanceName();
  fetch(base + '/instances/' + encodeURIComponent(name) + '/attestation').then(function(res) {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }).then(function(data) {
    teeInfo = data;
    document.getElementById('tee-shield').style.display = 'flex';
  }).catch(function() {});
}

function fetchTeeReport() {
  if (teeReportCache) {
    renderTeePopover(teeReportCache);
    return;
  }
  if (teeReportLoading) return;
  teeReportLoading = true;
  var base = teeApiBase();
  if (!base) return;
  var popover = document.getElementById('tee-popover');
  popover.innerHTML = '<div class="tee-popover-loading">' + escapeHtml(t('tee.loading_report')) + '</div>';
  fetch(base + '/attestation/report').then(function(res) {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }).then(function(data) {
    teeReportCache = data;
    renderTeePopover(data);
  }).catch(function() {
    popover.innerHTML = '<div class="tee-popover-loading">' + escapeHtml(t('tee.load_failed')) + '</div>';
  }).finally(function() {
    teeReportLoading = false;
  });
}

function renderTeePopover(report) {
  var popover = document.getElementById('tee-popover');
  var digest = (teeInfo && teeInfo.image_digest) || 'N/A';
  var fingerprint = report.tls_certificate_fingerprint || 'N/A';
  var reportData = report.report_data || '';
  var vmConfig = report.vm_config || 'N/A';
  var truncated = reportData.length > 32 ? reportData.slice(0, 32) + '...' : reportData;
  popover.innerHTML = '<div class="tee-popover-title">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
    + escapeHtml(t('tee.title')) + '</div>'
    + '<div class="tee-field"><div class="tee-field-label">' + escapeHtml(t('tee.image_digest')) + '</div>'
    + '<div class="tee-field-value">' + escapeHtml(digest) + '</div></div>'
    + '<div class="tee-field"><div class="tee-field-label">' + escapeHtml(t('tee.tls_fingerprint')) + '</div>'
    + '<div class="tee-field-value">' + escapeHtml(fingerprint) + '</div></div>'
    + '<div class="tee-field"><div class="tee-field-label">' + escapeHtml(t('tee.report_data')) + '</div>'
    + '<div class="tee-field-value">' + escapeHtml(truncated) + '</div></div>'
    + '<div class="tee-field"><div class="tee-field-label">' + escapeHtml(t('tee.vm_config')) + '</div>'
    + '<div class="tee-field-value">' + escapeHtml(vmConfig) + '</div></div>'
    + '<div class="tee-popover-actions">'
    + '<button class="tee-btn-copy" onclick="copyTeeReport()">' + escapeHtml(t('tee.copy_full_report')) + '</button></div>';
}

function copyTeeReport() {
  if (!teeReportCache) return;
  var combined = Object.assign({}, teeReportCache, teeInfo || {});
  navigator.clipboard.writeText(JSON.stringify(combined, null, 2)).then(function() {
    showToast(t('tee.report_copied'), 'success');
  }).catch(function() {
    showToast(t('tee.copy_failed'), 'error');
  });
}

document.getElementById('tee-shield').addEventListener('mouseenter', function() {
  fetchTeeReport();
  document.getElementById('tee-popover').classList.add('visible');
});
document.getElementById('tee-shield').addEventListener('mouseleave', function() {
  document.getElementById('tee-popover').classList.remove('visible');
});

// --- Extension install ---

function installWasmExtension() {
  var name = document.getElementById('wasm-install-name').value.trim();
  if (!name) {
    showToast(t('extensions.toast.extension_name_required'), 'error');
    return;
  }
  var url = document.getElementById('wasm-install-url').value.trim();
  if (!url) {
    showToast(t('extensions.toast.wasm_url_required'), 'error');
    return;
  }

  apiFetch('/api/extensions/install', {
    method: 'POST',
    body: { name: name, url: url, kind: 'wasm_tool' },
  }).then(function(res) {
    if (res.success) {
      showToast(t('extensions.toast.installed', { name }), 'success');
      document.getElementById('wasm-install-name').value = '';
      document.getElementById('wasm-install-url').value = '';
      loadExtensions();
    } else {
      showToast(t('extensions.toast.install_failed', { message: res.message || t('extensions.unknown_error') }), 'error');
    }
  }).catch(function(err) {
    showToast(t('extensions.toast.install_failed', { message: err.message }), 'error');
  });
}

function addMcpServer() {
  var name = document.getElementById('mcp-install-name').value.trim();
  if (!name) {
    showToast(t('extensions.toast.server_name_required'), 'error');
    return;
  }
  var url = document.getElementById('mcp-install-url').value.trim();
  if (!url) {
    showToast(t('extensions.toast.mcp_url_required'), 'error');
    return;
  }

  apiFetch('/api/extensions/install', {
    method: 'POST',
    body: { name: name, url: url, kind: 'mcp_server' },
  }).then(function(res) {
    if (res.success) {
      showToast(t('extensions.toast.mcp_added', { name }), 'success');
      document.getElementById('mcp-install-name').value = '';
      document.getElementById('mcp-install-url').value = '';
      loadExtensions();
    } else {
      showToast(t('extensions.toast.add_mcp_failed', { message: res.message || t('extensions.unknown_error') }), 'error');
    }
  }).catch(function(err) {
    showToast(t('extensions.toast.add_mcp_failed', { message: err.message }), 'error');
  });
}

// --- Skills ---

function loadSkills() {
  var skillsList = document.getElementById('skills-list');
  apiFetch('/api/skills').then(function(data) {
    if (!data.skills || data.skills.length === 0) {
      skillsList.innerHTML = '<div class="empty-state">' + escapeHtml(t('skills.empty.installed')) + '</div>';
      return;
    }
    skillsList.innerHTML = '';
    for (var i = 0; i < data.skills.length; i++) {
      skillsList.appendChild(renderSkillCard(data.skills[i]));
    }
  }).catch(function(err) {
    skillsList.innerHTML = '<div class="empty-state">' + escapeHtml(t('skills.error.load', { message: err.message })) + '</div>';
  });
}

function formatSkillTrustLabel(trust) {
  const normalized = String(trust || '').trim().toLowerCase();
  const key = 'skills.trust.' + normalized;
  const translated = t(key);
  return translated !== key ? translated : humanizeIdentifier(normalized);
}

function renderSkillCard(skill) {
  var card = document.createElement('div');
  card.className = 'ext-card';

  var header = document.createElement('div');
  header.className = 'ext-header';

  var name = document.createElement('span');
  name.className = 'ext-name';
  name.textContent = skill.name;
  header.appendChild(name);

  var trust = document.createElement('span');
  var trustClass = skill.trust.toLowerCase() === 'trusted' ? 'trust-trusted' : 'trust-installed';
  trust.className = 'skill-trust ' + trustClass;
  trust.textContent = formatSkillTrustLabel(skill.trust);
  header.appendChild(trust);

  var version = document.createElement('span');
  version.className = 'skill-version';
  version.textContent = 'v' + skill.version;
  header.appendChild(version);

  card.appendChild(header);

  var desc = document.createElement('div');
  desc.className = 'ext-desc';
  desc.textContent = skill.description;
  card.appendChild(desc);

  if (skill.keywords && skill.keywords.length > 0) {
    var kw = document.createElement('div');
    kw.className = 'ext-keywords';
    kw.textContent = t('skills.activates_on', { keywords: skill.keywords.join(', ') });
    card.appendChild(kw);
  }

  var actions = document.createElement('div');
  actions.className = 'ext-actions';

  // Only show Remove for registry-installed skills, not user-placed trusted skills
  if (skill.trust.toLowerCase() !== 'trusted') {
    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn-ext remove';
    removeBtn.textContent = t('skills.action.remove');
    removeBtn.addEventListener('click', function() { removeSkill(skill.name); });
    actions.appendChild(removeBtn);
  }

  card.appendChild(actions);
  return card;
}

function searchClawHub() {
  var input = document.getElementById('skill-search-input');
  var query = input.value.trim();
  if (!query) return;

  var resultsDiv = document.getElementById('skill-search-results');
  resultsDiv.innerHTML = '<div class="empty-state">' + escapeHtml(t('skills.search.searching')) + '</div>';

  apiFetch('/api/skills/search', {
    method: 'POST',
    body: { query: query },
  }).then(function(data) {
    resultsDiv.innerHTML = '';

    // Show registry error as a warning banner if present
    if (data.catalog_error) {
      var warning = document.createElement('div');
      warning.className = 'empty-state';
      warning.style.color = '#f0ad4e';
      warning.style.borderLeft = '3px solid #f0ad4e';
      warning.style.paddingLeft = '12px';
      warning.style.marginBottom = '16px';
      warning.textContent = t('skills.search.registry_unreachable', { message: data.catalog_error });
      resultsDiv.appendChild(warning);
    }

    // Show catalog results
    if (data.catalog && data.catalog.length > 0) {
      // Build a set of installed skill names for quick lookup
      var installedNames = {};
      if (data.installed) {
        for (var j = 0; j < data.installed.length; j++) {
          installedNames[data.installed[j].name] = true;
        }
      }

      for (var i = 0; i < data.catalog.length; i++) {
        var card = renderCatalogSkillCard(data.catalog[i], installedNames);
        card.style.animationDelay = (i * 0.06) + 's';
        resultsDiv.appendChild(card);
      }
    }

    // Show matching installed skills too
    if (data.installed && data.installed.length > 0) {
      for (var k = 0; k < data.installed.length; k++) {
        var installedCard = renderSkillCard(data.installed[k]);
        installedCard.style.animationDelay = ((data.catalog ? data.catalog.length : 0) + k) * 0.06 + 's';
        installedCard.classList.add('skill-search-result');
        resultsDiv.appendChild(installedCard);
      }
    }

    if (resultsDiv.children.length === 0) {
      resultsDiv.innerHTML = '<div class="empty-state">' + escapeHtml(t('skills.search.no_results', { query })) + '</div>';
    }
  }).catch(function(err) {
    resultsDiv.innerHTML = '<div class="empty-state">' + escapeHtml(t('skills.search.failed', { message: err.message })) + '</div>';
  });
}

function renderCatalogSkillCard(entry, installedNames) {
  var card = document.createElement('div');
  card.className = 'ext-card ext-available skill-search-result';

  var header = document.createElement('div');
  header.className = 'ext-header';

  var name = document.createElement('a');
  name.className = 'ext-name';
  name.textContent = entry.name || entry.slug;
  name.href = 'https://clawhub.ai/skills/' + encodeURIComponent(entry.slug);
  name.target = '_blank';
  name.rel = 'noopener';
  name.style.textDecoration = 'none';
  name.style.color = 'inherit';
  name.title = t('skills.meta.view_on_clawhub');
  header.appendChild(name);

  if (entry.version) {
    var version = document.createElement('span');
    version.className = 'skill-version';
    version.textContent = 'v' + entry.version;
    header.appendChild(version);
  }

  card.appendChild(header);

  if (entry.description) {
    var desc = document.createElement('div');
    desc.className = 'ext-desc';
    desc.textContent = entry.description;
    card.appendChild(desc);
  }

  // Metadata row: owner, stars, downloads, recency
  var meta = document.createElement('div');
  meta.className = 'ext-meta';
  meta.style.fontSize = '11px';
  meta.style.color = '#888';
  meta.style.marginTop = '6px';

  function addMetaSep() {
    if (meta.children.length > 0) {
      meta.appendChild(document.createTextNode(' \u00b7 '));
    }
  }

  if (entry.owner) {
    var ownerSpan = document.createElement('span');
    ownerSpan.textContent = t('skills.meta.by_owner', { owner: entry.owner });
    meta.appendChild(ownerSpan);
  }

  if (entry.stars != null) {
    addMetaSep();
    var starsSpan = document.createElement('span');
    starsSpan.textContent = t('skills.meta.stars', { count: entry.stars });
    meta.appendChild(starsSpan);
  }

  if (entry.downloads != null) {
    addMetaSep();
    var dlSpan = document.createElement('span');
    dlSpan.textContent = t('skills.meta.downloads', { count: formatCompactNumber(entry.downloads) });
    meta.appendChild(dlSpan);
  }

  if (entry.updatedAt) {
    var ago = formatTimeAgo(entry.updatedAt);
    if (ago) {
      addMetaSep();
      var updatedSpan = document.createElement('span');
      updatedSpan.textContent = t('skills.meta.updated', { ago });
      meta.appendChild(updatedSpan);
    }
  }

  if (meta.children.length > 0) {
    card.appendChild(meta);
  }

  var actions = document.createElement('div');
  actions.className = 'ext-actions';

  var slug = entry.slug || entry.name;
  var isInstalled = installedNames[entry.name] || installedNames[slug];

  if (isInstalled) {
    var label = document.createElement('span');
    label.className = 'ext-active-label';
    label.textContent = t('skills.status.installed');
    actions.appendChild(label);
  } else {
    var installBtn = document.createElement('button');
    installBtn.className = 'btn-ext install';
    installBtn.textContent = t('skills.action.install');
    installBtn.addEventListener('click', (function(s, btn) {
      return function() {
        if (!confirm(t('skills.confirm.install_from_catalog', { name: s }))) return;
        btn.disabled = true;
        btn.textContent = t('skills.action.installing');
        installSkill(s, null, btn);
      };
    })(slug, installBtn));
    actions.appendChild(installBtn);
  }

  card.appendChild(actions);
  return card;
}

function formatCompactNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return '' + n;
}

function formatTimeAgo(epochMs) {
  var now = Date.now();
  var diff = now - epochMs;
  if (diff < 0) return null;
  var minutes = Math.floor(diff / 60000);
  if (minutes < 60) return minutes <= 1 ? t('skills.time.just_now') : t('skills.time.minutes_ago', { count: minutes });
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return t('skills.time.hours_ago', { count: hours });
  var days = Math.floor(hours / 24);
  if (days < 30) return t('skills.time.days_ago', { count: days });
  var months = Math.floor(days / 30);
  if (months < 12) return t('skills.time.months_ago', { count: months });
  return t('skills.time.years_ago', { count: Math.floor(months / 12) });
}

function installSkill(nameOrSlug, url, btn) {
  var body = { name: nameOrSlug, slug: nameOrSlug };
  if (url) body.url = url;

  apiFetch('/api/skills/install', {
    method: 'POST',
    headers: { 'X-Confirm-Action': 'true' },
    body: body,
  }).then(function(res) {
    if (res.success) {
      showToast(t('skills.toast.installed', { name: nameOrSlug }), 'success');
    } else {
      showToast(t('skills.toast.install_failed', { message: res.message || t('skills.unknown_error') }), 'error');
    }
    loadSkills();
    if (btn) { btn.disabled = false; btn.textContent = t('skills.action.install'); }
  }).catch(function(err) {
    showToast(t('skills.toast.install_failed', { message: err.message }), 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('skills.action.install'); }
  });
}

function removeSkill(name) {
  if (!confirm(t('skills.confirm.remove', { name }))) return;
  apiFetch('/api/skills/' + encodeURIComponent(name), {
    method: 'DELETE',
    headers: { 'X-Confirm-Action': 'true' },
  }).then(function(res) {
    if (res.success) {
      showToast(t('skills.toast.removed', { name }), 'success');
    } else {
      showToast(t('skills.toast.remove_failed', { message: res.message || t('skills.unknown_error') }), 'error');
    }
    loadSkills();
  }).catch(function(err) {
    showToast(t('skills.toast.remove_failed', { message: err.message }), 'error');
  });
}

function installSkillFromForm() {
  var name = document.getElementById('skill-install-name').value.trim();
  if (!name) { showToast(t('skills.toast.name_required'), 'error'); return; }
  var url = document.getElementById('skill-install-url').value.trim() || null;
  if (url && !url.startsWith('https://')) {
    showToast(t('skills.toast.https_required'), 'error');
    return;
  }
  if (!confirm(t('skills.confirm.install', { name }))) return;
  installSkill(name, url, null);
  document.getElementById('skill-install-name').value = '';
  document.getElementById('skill-install-url').value = '';
}

// Wire up Enter key on search input
document.getElementById('skill-search-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') searchClawHub();
});

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const tag = (e.target.tagName || '').toLowerCase();
  const inInput = tag === 'input' || tag === 'textarea';

  // Mod+1-6: switch tabs
  if (mod && e.key >= '1' && e.key <= '6') {
    e.preventDefault();
    const tabs = ['chat', 'memory', 'jobs', 'routines', 'extensions', 'skills'];
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) switchTab(tabs[idx]);
    return;
  }

  // Mod+K: focus chat input or memory search
  if (mod && e.key === 'k') {
    e.preventDefault();
    if (currentTab === 'memory') {
      document.getElementById('memory-search').focus();
    } else {
      document.getElementById('chat-input').focus();
    }
    return;
  }

  // Mod+N: new thread
  if (mod && e.key === 'n' && currentTab === 'chat') {
    e.preventDefault();
    createNewThread();
    return;
  }

  // Escape: close autocomplete, job detail, or blur input
  if (e.key === 'Escape') {
    const acEl = document.getElementById('slash-autocomplete');
    if (acEl && acEl.style.display !== 'none') {
      hideSlashAutocomplete();
      return;
    }
    if (currentJobId) {
      closeJobDetail();
    } else if (inInput) {
      e.target.blur();
    }
    return;
  }
});

// --- Toasts ---

function showToast(message, type) {
  const container = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'info');
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger slide-in
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 4000);
}

// --- Utilities ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString();
}
