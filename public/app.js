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
  adminOpen: false,
  parsedImportPosts: []
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

function commentsFor(postId) {
  return state.comments.filter(comment => comment.postId === postId);
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

  if (state.adminOpen) {
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
    $('.category', node).textContent = post.category || '속마음';
    $('.date', node).textContent = formatDate(post.createdAt);
    $('.post-content', node).textContent = post.content || '';

    const commentsBox = $('.comments', node);
    const postComments = commentsFor(post.id);
    if (postComments.length) {
      postComments.forEach(comment => renderComment(comment, commentsBox));
    } else {
      const empty = document.createElement('p');
      empty.className = 'help';
      empty.textContent = '아직 댓글이 없어. 첫 댓글을 남겨줘!';
      commentsBox.append(empty);
    }

    const form = $('.comment-form', node);
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
        updateStateFromFeed(result.feed);
        form.reset();
      } catch (error) {
        alert(error.message);
      } finally {
        form.querySelector('button').disabled = false;
      }
    });

    const delPost = $('.delete-post', node);
    if (state.adminOpen) {
      delPost.classList.remove('hidden');
      delPost.addEventListener('click', () => deletePost(post.id));
    }

    list.append(card);
  }
}

function updateStateFromFeed(feed) {
  state.posts = feed.posts || [];
  state.comments = feed.comments || [];
  state.settings = feed.settings || {};
  $('#pinWarning').classList.toggle('hidden', !feed.adminDefaultPin);
  applySettings();
  updateCategoryFilter();
  renderPosts();
}

async function loadFeed() {
  showStatus('불러오는 중...');
  try {
    const feed = await api('feed');
    updateStateFromFeed(feed);
  } catch (error) {
    showStatus(`서버 연결이 안 됐어: ${error.message}`, true);
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

function parseRows(rows) {
  return rows.map((row, index) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[String(key).trim().toLowerCase()] = value;
    }
    return {
      id: normalized.id || '',
      content: normalized.content || normalized.내용 || normalized['글내용'] || normalized['제보내용'] || '',
      category: normalized.category || normalized.카테고리 || normalized.분류 || '속마음',
      nickname: normalized.nickname || normalized.닉네임 || normalized.작성자 || '익명',
      status: normalized.status || normalized.상태 || '게시',
      createdAt: normalized.createdat || normalized.created_at || normalized.작성일 || ''
    };
  }).filter(post => String(post.content || '').trim());
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
    renderPosts();
    $('#adminPanel').scrollIntoView({ block: 'start' });
  });

  $('#closeAdmin').addEventListener('click', () => {
    state.adminOpen = false;
    $('#adminPanel').classList.add('hidden');
    renderPosts();
  });

  $('#refreshBtn').addEventListener('click', loadFeed);
  $('#searchInput').addEventListener('input', renderPosts);
  $('#categoryFilter').addEventListener('change', renderPosts);
  $('#adminPin').addEventListener('change', savePin);

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
loadFeed();
