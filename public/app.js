const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const api = async (path, options = {}) => {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || '요청 실패');
  return payload;
};

const state = {
  posts: [],
  comments: [],
  settings: {},
  sync: {},
  adminOpen: false,
  adminVerified: false,
  parsedImportPosts: [],
  commentDrafts: {}
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function adminPin() {
  return $('#adminPin').value.trim() || localStorage.getItem('daesupAdminPin') || '';
}

function savePin() {
  const pin = $('#adminPin').value.trim();
  if (pin) localStorage.setItem('daesupAdminPin', pin);
}

function showStatus(message, isError = false) {
  const el = $('#status');
  el.textContent = message;
  el.style.color = isError ? '#d94141' : '';
  el.classList.remove('hidden');
}

function updateAdminGate() {
  const tools = $('#adminTools');
  const help = $('#adminLoginHelp');
  const loginButton = $('#adminRefresh');
  if (!tools) return;
  tools.classList.toggle('hidden', !state.adminVerified);
  if (help) {
    help.textContent = state.adminVerified
      ? '관리자 로그인 완료! 이제 나영이만 관리 도구를 볼 수 있어.'
      : 'PIN이 맞아야 설정, 글 등록, 숨김 처리, 구글시트 반영 버튼이 열려.';
  }
  if (loginButton) loginButton.textContent = state.adminVerified ? '관리자 새로고침' : '관리자 로그인';
}

function applySettings() {
  const settings = state.settings || {};
  $('#appTitle').textContent = settings.appTitle || '대나무숲';
  $('#appSubtitle').textContent = settings.appSubtitle || '익명으로 남긴 속마음 · 건의 · 칭찬';
  $('#notice').textContent = settings.notice || '서로 불편하지 않게, 선 넘는 내용은 운영진이 정리할 수 있어요.';
  document.title = settings.appTitle || '대나무숲 댓글앱';
  $('#settingTitle').value = settings.appTitle || '';
  $('#settingSubtitle').value = settings.appSubtitle || '';
  $('#settingNotice').value = settings.notice || '';
}

function updateCategoryFilter() {
  const current = $('#categoryFilter').value;
  const categories = [...new Set(state.posts.map(post => post.category || '속마음'))].sort();
  $('#categoryFilter').innerHTML = '<option value="all">전체</option>';
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    $('#categoryFilter').append(option);
  }
  $('#categoryFilter').value = categories.includes(current) ? current : 'all';
}

function timeValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function commentsFor(postId) {
  return state.comments
    .filter(comment => comment.postId === postId)
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
}

function captureVisibleCommentDrafts() {
  $$('.comment-form').forEach(form => {
    const card = form.closest('.post-card');
    const postId = card?.dataset.postId;
    if (!postId) return;
    const nickname = String(form.elements.nickname?.value || '').trim();
    const content = String(form.elements.content?.value || '');
    if (nickname || content.trim()) {
      state.commentDrafts[postId] = { nickname, content };
    } else {
      delete state.commentDrafts[postId];
    }
  });
}

function isTypingOrHasDraft() {
  captureVisibleCommentDrafts();
  const active = document.activeElement;
  const activeTag = active?.tagName || '';
  const editingNow = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag);
  const hasDraft = Object.values(state.commentDrafts).some(draft =>
    String(draft?.content || '').trim() || String(draft?.nickname || '').trim()
  );
  return Boolean(editingNow || hasDraft);
}

async function autoRefreshFeed() {
  if (isTypingOrHasDraft()) return;
  await loadFeed({ silent: true });
}

function renderComment(comment, commentsBox) {
  const wrapper = document.createElement('div');
  wrapper.className = 'comment';

  const name = document.createElement('strong');
  name.textContent = comment.nickname || '익명';

  const text = document.createElement('span');
  text.textContent = ` ${comment.content}`;

  const meta = document.createElement('small');
  meta.textContent = formatDate(comment.createdAt);

  wrapper.append(name, text, meta);


  if (state.adminVerified) {
    const del = document.createElement('button');
    del.className = 'danger-text';
    del.type = 'button';
    del.textContent = '관리자: 댓글 숨김';
    del.addEventListener('click', () => deleteComment(comment.id));
    wrapper.append(del);
  }

  commentsBox.append(wrapper);
}

function renderPosts() {
  captureVisibleCommentDrafts();
  const list = $('#postList');
  const template = $('#postTemplate');
  const keyword = $('#searchInput').value.trim().toLowerCase();
  const category = $('#categoryFilter').value;

  list.innerHTML = '';
  const filtered = state.posts.filter(post => {
    const matchesKeyword = !keyword || String(post.content || '').toLowerCase().includes(keyword);
    const matchesCategory = category === 'all' || post.category === category;
    return matchesKeyword && matchesCategory;
  });

  if (!filtered.length) {
    showStatus('아직 보여줄 글이 없거나 검색 결과가 없어.', false);
    return;
  }
  $('#status').classList.add('hidden');

  for (const post of filtered) {
    const node = template.content.cloneNode(true);
    const card = $('.post-card', node);
    card.dataset.postId = post.id;
    $('.category', node).textContent = post.category || '속마음';
    const nicknameEl = $('.post-nickname', node);
    nicknameEl.textContent = post.nickname || '익명';
    nicknameEl.classList.toggle('admin-visible', Boolean(post.writerAdminOnly && state.adminOpen));
    $('.date', node).textContent = formatDate(post.createdAt);
    $('.post-content', node).textContent = post.content || '';
    const commentsBox = $('.comments', node);
    const postComments = commentsFor(post.id);
    if (postComments.length) {
      postComments.forEach(comment => renderComment(comment, commentsBox));
    }

    const form = $('.comment-form', node);
    const draft = state.commentDrafts[post.id];
    if (draft) {
      form.elements.nickname.value = draft.nickname || '';
      form.elements.content.value = draft.content || '';
    }
    form.addEventListener('input', () => {
      const nickname = String(form.elements.nickname?.value || '').trim();
      const content = String(form.elements.content?.value || '');
      if (nickname || content.trim()) {
        state.commentDrafts[post.id] = { nickname, content };
      } else {
        delete state.commentDrafts[post.id];
      }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(form);
      const content = String(formData.get('content') || '').trim();
      const nickname = String(formData.get('nickname') || '익명').trim();
      if (!content) return;
      try {
        form.querySelector('button').disabled = true;
        const result = await api('comment', {
          method: 'POST',
          body: JSON.stringify({ postId: post.id, nickname, content })
        });
        delete state.commentDrafts[post.id];
        updateStateFromFeed(result.feed);
      } catch (error) {
        alert(error.message);
      } finally {
        form.querySelector('button').disabled = false;
      }
    });

    const delPost = $('.delete-post', node);
    if (state.adminVerified) {
      delPost.classList.remove('hidden');
      delPost.addEventListener('click', () => deletePost(post.id));
    }

    list.append(card);
  }
}


function updateSyncStatus() {
  const el = $('#sheetSyncStatus');
  if (!el) return;
  const sync = state.sync || {};
  if (sync.lastError) {
    el.textContent = `구글시트 연동 오류: ${sync.lastError}`;
    el.classList.add('error');
    return;
  }
  const count = Number(sync.lastCount || 0);
  const time = sync.lastSuccess ? formatDate(sync.lastSuccess) : '아직 없음';
  el.textContent = `구글시트 자동연동 ON · ${count}개 글 · 마지막 반영 ${time}`;
  el.classList.remove('error');
}

function updateStateFromFeed(feed) {
  if (Object.prototype.hasOwnProperty.call(feed, 'adminView')) state.adminVerified = Boolean(feed.adminView);
  state.posts = feed.posts || [];
  state.comments = feed.comments || [];
  state.settings = feed.settings || {};
  state.sync = feed.sync || {};
  updateSyncStatus();
  $('#pinWarning').classList.toggle('hidden', !feed.adminDefaultPin);
  updateAdminGate();
  applySettings();
  updateCategoryFilter();
  renderPosts();
}

async function loadFeed({ silent = false } = {}) {
  if (!silent) showStatus('불러오는 중...');
  if (state.adminOpen && adminPin()) {
    const ok = await loadAdminFeed({ silent: true });
    if (ok) return;
  }
  try {
    const feed = await api('feed');
    state.adminVerified = false;
    updateStateFromFeed(feed);
  } catch (error) {
    showStatus(`서버 연결이 안 됐어: ${error.message}`, true);
  }
}

async function loadAdminFeed({ silent = false } = {}) {
  savePin();
  try {
    const result = await adminRequest('admin-feed', {});
    updateStateFromFeed(result.feed);
    if (!silent) alert('관리자 로그인 완료! 이제 관리 도구가 열려.');
    return true;
  } catch (error) {
    state.adminVerified = false;
    updateAdminGate();
    if (!silent) alert(error.message);
    return false;
  }
}

async function adminRequest(path, body) {
  savePin();
  return api(path, {
    method: 'POST',
    headers: { 'x-admin-pin': adminPin() },
    body: JSON.stringify({ ...body, adminPin: adminPin() })
  });
}

async function deletePost(postId) {
  if (!confirm('이 글을 화면에서 숨길까?')) return;
  try {
    const result = await adminRequest('delete-post', { postId });
    updateStateFromFeed(result.feed);
  } catch (error) {
    alert(error.message);
  }
}

async function deleteComment(commentId) {
  if (!confirm('이 댓글을 화면에서 숨길까?')) return;
  try {
    const result = await adminRequest('delete-comment', { commentId });
    updateStateFromFeed(result.feed);
  } catch (error) {
    alert(error.message);
  }
}

function compactKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\n\r\t_\-()[\]{}.,:;!?"'“”‘’·/\\|]+/g, '');
}

const importAliases = {
  content: [
    'content', '내용', '글내용', '제보내용', '대숲내용', '대나무숲', '대나무숲내용', '익명제보', '제보', '본문', '메시지', 'message', 'answer', '답변',
    '대나무숲에남기고싶은말을적어주세요', '대나무숲에남기고싶은말', '남기고싶은말', '하고싶은말', '익명으로남기고싶은말', '속마음', '건의칭찬내용'
  ],
  category: ['category', '카테고리', '분류', '종류', '유형', '구분', '말머리', '게시판'],
  nickname: ['nickname', '닉네임', '별명', '작성자', '이름', '작성자명', '본인닉네임', '본인이쓴닉네임', '닉네임을입력해주세요', '닉네임기본익명', '표시이름'],
  status: ['status', '상태', '공개여부', '게시여부', '승인', '공개', '관리자확인'],
  createdAt: ['createdat', 'created_at', '작성일', '작성일시', '제출일', '제출시간', '타임스탬프', 'timestamp', '날짜', '일시', '시간']
};

function getRowValue(row, field) {
  const entries = Object.entries(row);
  const aliases = (importAliases[field] || []).map(compactKey);
  for (const [key, value] of entries) {
    if (aliases.includes(compactKey(key))) return value;
  }
  if (field === 'content') {
    const metaKeys = new Set([
      ...importAliases.category.map(compactKey),
      ...importAliases.nickname.map(compactKey),
      ...importAliases.status.map(compactKey),
      ...importAliases.createdAt.map(compactKey)
    ]);
    const candidates = entries
      .filter(([key, value]) => !metaKeys.has(compactKey(key)) && String(value ?? '').trim())
      .sort((a, b) => String(b[1]).length - String(a[1]).length);
    return candidates[0]?.[1] || '';
  }
  return '';
}

function parseRows(rows) {
  return rows.map((row, index) => ({
    id: String(getRowValue(row, 'id') || '').trim(),
    content: String(getRowValue(row, 'content') || '').trim(),
    category: String(getRowValue(row, 'category') || '속마음').trim(),
    nickname: String(getRowValue(row, 'nickname') || '익명').trim(),
    status: String(getRowValue(row, 'status') || '게시').trim(),
    createdAt: String(getRowValue(row, 'createdAt') || '').trim()
  })).filter(post => String(post.content || '').trim());
}

async function readImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const text = await file.text();
    const workbook = XLSX.read(text, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return parseRows(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return parseRows(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
}

async function importPosts(mode) {
  if (!state.parsedImportPosts.length) {
    alert('먼저 엑셀/CSV 파일을 선택해줘.');
    return;
  }
  const message = mode === 'replace'
    ? '기존 글과 댓글을 지우고 이 파일로 전체 교체할까?'
    : '이 파일의 글을 기존 글에 추가할까?';
  if (!confirm(message)) return;
  try {
    const result = await adminRequest('import-posts', { mode, posts: state.parsedImportPosts });
    updateStateFromFeed(result.feed);
    alert(`${result.count}개 글을 올렸어!`);
  } catch (error) {
    alert(error.message);
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $('#adminToggle').addEventListener('click', () => {
    state.adminOpen = true;
    $('#adminPanel').classList.remove('hidden');
    $('#adminPin').value = localStorage.getItem('daesupAdminPin') || '';
    updateAdminGate();
    if (adminPin()) loadAdminFeed({ silent: true });
    renderPosts();
    $('#adminPanel').scrollIntoView({ block: 'start' });
  });

  $('#closeAdmin').addEventListener('click', () => {
    state.adminOpen = false;
    state.adminVerified = false;
    updateAdminGate();
    $('#adminPanel').classList.add('hidden');
    loadFeed();
  });

  $('#refreshBtn').addEventListener('click', loadFeed);
  $('#searchInput').addEventListener('input', renderPosts);
  $('#categoryFilter').addEventListener('change', renderPosts);
  $('#adminPin').addEventListener('input', () => {
    savePin();
  });
  $('#adminPin').addEventListener('keydown', event => {
    if (event.key === 'Enter') loadAdminFeed();
  });

  const adminRefreshButton = $('#adminRefresh');
  if (adminRefreshButton) {
    adminRefreshButton.addEventListener('click', () => loadAdminFeed());
  }

  $('#settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const result = await adminRequest('settings', {
        appTitle: $('#settingTitle').value,
        appSubtitle: $('#settingSubtitle').value,
        notice: $('#settingNotice').value
      });
      updateStateFromFeed(result.feed);
      alert('문구 저장 완료!');
    } catch (error) {
      alert(error.message);
    }
  });

  $('#postForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const result = await adminRequest('post', {
        category: $('#newCategory').value || '속마음',
        nickname: $('#newNickname').value || '익명',
        content: $('#newContent').value
      });
      updateStateFromFeed(result.feed);
      event.target.reset();
      alert('글 등록 완료!');
    } catch (error) {
      alert(error.message);
    }
  });

  $('#fileInput').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const posts = await readImportFile(file);
      state.parsedImportPosts = posts;
      $('#importPreview').textContent = `${posts.length}개 글을 읽었어. 이제 추가/교체 버튼을 눌러줘.`;
    } catch (error) {
      state.parsedImportPosts = [];
      $('#importPreview').textContent = '파일을 읽지 못했어. 엑셀 첫 번째 줄 컬럼명을 확인해줘.';
      console.error(error);
    }
  });

  $('#appendImport').addEventListener('click', () => importPosts('append'));
  $('#replaceImport').addEventListener('click', () => importPosts('replace'));

  const syncNowButton = $('#syncNow');
  if (syncNowButton) {
    syncNowButton.addEventListener('click', async () => {
      try {
        syncNowButton.disabled = true;
        const result = await adminRequest('sync-now', {});
        updateStateFromFeed(result.feed);
        alert('구글시트 새 내용 반영 완료!');
      } catch (error) {
        alert(error.message);
      } finally {
        syncNowButton.disabled = false;
      }
    });
  }

  $('#exportData').addEventListener('click', async () => {
    savePin();
    try {
      const response = await fetch(`/api/admin-export?pin=${encodeURIComponent(adminPin())}`, {
        headers: { 'x-admin-pin': adminPin() }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '백업 실패');
      downloadJson(`daesup-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
    } catch (error) {
      alert(error.message);
    }
  });

  $('#resetSample').addEventListener('click', async () => {
    if (!confirm('정말 샘플 데이터로 초기화할까? 기존 글/댓글이 사라져.')) return;
    try {
      const result = await adminRequest('reset-sample', {});
      updateStateFromFeed(result.feed);
      alert('초기화 완료!');
    } catch (error) {
      alert(error.message);
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.warn));
}

bindEvents();
updateAdminGate();
loadFeed();
setInterval(autoRefreshFeed, 60000);
