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
  adminPin: '',
  hiddenPosts: [],
  hiddenComments: [],
  commentDrafts: {},
  expandedPosts: new Set()
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
  // 입력창 값 우선, 없으면 로그인 때 메모리에 담아둔 PIN 사용
  // (localStorage에 저장 안 함 → 새로고침하면 로그인 풀림)
  return $('#adminPin').value.trim() || state.adminPin || '';
}

function showStatus(message, isError = false) {
  const el = $('#status');
  el.textContent = message;
  el.style.color = isError ? '#d94141' : '';
  el.classList.remove('hidden');
}

function updateAdminGate() {
  const tools = $('#adminTools');
  const loginBox = $('#adminLoginBox');
  if (!tools) return;
  // 로그인 전에는 PIN 입력창, 로그인 후에는 관리 도구만 보이게
  tools.classList.toggle('hidden', !state.adminVerified);
  if (loginBox) loginBox.classList.toggle('hidden', state.adminVerified);
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

function postContentById(postId) {
  const post = state.posts.find(item => item.id === postId);
  return post ? (post.content || '') : '(숨김 처리되었거나 사라진 글)';
}

function createModal(titleText) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h3');
  title.textContent = titleText;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ghost-btn';
  closeBtn.type = 'button';
  closeBtn.textContent = '닫기';
  head.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  modal.append(head, body);
  overlay.append(modal);
  document.body.append(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };
  function onEsc(event) {
    if (event.key === 'Escape') close();
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onEsc);

  return { body, close };
}

function openFingerprintPopup(ipHash) {
  const posts = state.posts.filter(post => post.ipHash === ipHash);
  const comments = state.comments.filter(comment => comment.ipHash === ipHash);
  const items = [
    ...posts.map(post => ({ kind: '글', nickname: post.nickname, createdAt: post.createdAt, content: post.content, sub: '' })),
    ...comments.map(comment => ({ kind: '댓글', nickname: comment.nickname, createdAt: comment.createdAt, content: comment.content, sub: `↳ 원글: ${postContentById(comment.postId).slice(0, 60)}` }))
  ].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));

  const { body } = createModal(`지문 #${ipHash} · 글 ${posts.length} · 댓글 ${comments.length}`);
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'help';
    empty.textContent = '이 지문으로 보이는 글/댓글이 없어요.';
    body.append(empty);
    return;
  }
  for (const it of items) {
    const item = document.createElement('div');
    item.className = 'modal-comment';

    const meta = document.createElement('div');
    meta.className = 'modal-comment-meta';
    meta.textContent = `[${it.kind}] ${it.nickname || '익명'} · ${formatDate(it.createdAt)}`;

    const text = document.createElement('p');
    text.className = 'modal-comment-text';
    text.textContent = it.content || '';

    item.append(meta, text);
    if (it.sub) {
      const sub = document.createElement('p');
      sub.className = 'modal-comment-post';
      sub.textContent = it.sub;
      item.append(sub);
    }
    body.append(item);
  }
}

function openWriteModal() {
  const { body, close } = createModal('글쓰기');

  const form = document.createElement('form');
  form.className = 'modal-form';

  // 카테고리 select (기본 3종 + 기존 글에 있는 카테고리)
  const catField = document.createElement('label');
  catField.className = 'field';
  const catSpan = document.createElement('span');
  catSpan.textContent = '카테고리';
  const catSelect = document.createElement('select');
  catSelect.name = 'category';
  const categories = [...new Set(['속마음', '건의', '칭찬', ...state.posts.map(post => post.category).filter(Boolean)])];
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    catSelect.append(option);
  }
  catField.append(catSpan, catSelect);

  const otherFields = document.createElement('div');
  otherFields.innerHTML = `
    <label class="field"><span>닉네임</span><input name="nickname" type="text" placeholder="익명" maxlength="20" /></label>
    <label class="field"><span>내용</span><textarea name="content" rows="5" placeholder="하고 싶은 말을 적어줘" maxlength="2000" required></textarea></label>
  `;

  const submit = document.createElement('button');
  submit.className = 'primary-btn';
  submit.type = 'submit';
  submit.textContent = '등록';

  form.append(catField, ...otherFields.children, submit);
  body.append(form);
  setTimeout(() => form.elements.content?.focus(), 0);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const content = String(form.elements.content.value || '').trim();
    const category = String(form.elements.category.value || '').trim() || '속마음';
    const nickname = String(form.elements.nickname.value || '').trim() || '익명';
    if (!content) return;
    try {
      submit.disabled = true;
      const result = await api('create-post', {
        method: 'POST',
        body: JSON.stringify({ category, nickname, content })
      });
      updateStateFromFeed(result.feed);
      close();
    } catch (error) {
      alert(error.message);
    } finally {
      submit.disabled = false;
    }
  });
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
    if (comment.ipHash) {
      const fp = document.createElement('button');
      fp.type = 'button';
      fp.className = 'ip-fingerprint';
      fp.textContent = `#${comment.ipHash}`;
      fp.title = '이 지문을 누르면 같은 작성자가 쓴 댓글을 모아 볼 수 있어요. (IP 해시 앞 8자리, 원본 IP는 저장 안 함)';
      fp.addEventListener('click', () => openFingerprintPopup(comment.ipHash));
      wrapper.append(fp);
    }

    const del = document.createElement('button');
    del.className = 'danger-text';
    del.type = 'button';
    del.textContent = '댓글 숨김';
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
  const searchType = $('#searchType')?.value || 'content';
  const category = $('#categoryFilter').value;

  list.innerHTML = '';
  const filtered = state.posts.filter(post => {
    const field = searchType === 'nickname' ? post.nickname : post.content;
    const matchesKeyword = !keyword || String(field || '').toLowerCase().includes(keyword);
    const matchesCategory = category === 'all' || post.category === category;
    return matchesKeyword && matchesCategory;
  }).sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));

  if (!filtered.length) {
    showStatus('검색 결과가 없습니다.', false);
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
    if (state.adminVerified && post.ipHash) {
      const fp = document.createElement('button');
      fp.type = 'button';
      fp.className = 'ip-fingerprint';
      fp.textContent = `#${post.ipHash}`;
      fp.title = '이 지문을 누르면 같은 작성자의 글·댓글을 모아 볼 수 있어요. (IP 해시 앞 8자리, 원본 IP는 저장 안 함)';
      fp.addEventListener('click', () => openFingerprintPopup(post.ipHash));
      $('.post-left-meta', node).append(fp);
    }
    $('.date', node).textContent = formatDate(post.createdAt);
    $('.post-content', node).textContent = post.content || '';
    const commentsBox = $('.comments', node);
    const postComments = commentsFor(post.id);
    if (postComments.length) {
      postComments.forEach(comment => renderComment(comment, commentsBox));
    }

    // 댓글/입력창은 기본 접힘. 댓글 개수를 누르면 펼쳐짐 (펼침 상태는 유지)
    const countLabel = postComments.length ? `💬 댓글 ${postComments.length}개` : '💬 아직 댓글이 없어요';
    const commentCount = $('.comment-count', node);
    const isOpen = state.expandedPosts.has(post.id) || Boolean(state.commentDrafts[post.id]);
    card.classList.toggle('comments-open', isOpen);
    const paintCount = () => {
      commentCount.textContent = `${countLabel}  ${card.classList.contains('comments-open') ? '▾' : '▸'}`;
    };
    paintCount();
    commentCount.addEventListener('click', () => {
      const open = !card.classList.contains('comments-open');
      card.classList.toggle('comments-open', open);
      if (open) state.expandedPosts.add(post.id);
      else state.expandedPosts.delete(post.id);
      paintCount();
    });

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
        form.reset();
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
  if (Object.prototype.hasOwnProperty.call(feed, 'hiddenPosts')) state.hiddenPosts = feed.hiddenPosts || [];
  if (Object.prototype.hasOwnProperty.call(feed, 'hiddenComments')) state.hiddenComments = feed.hiddenComments || [];
  updateSyncStatus();
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
    showStatus(`서버 연결 오류: ${error.message}`, true);
  }
}

async function loadAdminFeed({ silent = false } = {}) {
  try {
    const result = await adminRequest('admin-feed', {});
    state.adminPin = adminPin();   // 로그인 성공 → PIN을 메모리에 보관
    $('#adminPin').value = '';      // 입력창은 비우기 (아까 댓글처럼)
    updateStateFromFeed(result.feed);
    if (!silent) alert('관리자 로그인 완료!');
    return true;
  } catch (error) {
    state.adminVerified = false;
    updateAdminGate();
    if (!silent) alert(error.message);
    return false;
  }
}

async function adminRequest(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'x-admin-pin': adminPin() },
    body: JSON.stringify({ ...body, adminPin: adminPin() })
  });
}

async function deletePost(postId) {
  if (!confirm('해당 글을 숨기시겠습니까?')) return;
  try {
    const result = await adminRequest('delete-post', { postId });
    updateStateFromFeed(result.feed);
  } catch (error) {
    alert(error.message);
  }
}

async function deleteComment(commentId) {
  if (!confirm('해당 댓글을 숨기시겠습니까?')) return;
  try {
    const result = await adminRequest('delete-comment', { commentId });
    updateStateFromFeed(result.feed);
  } catch (error) {
    alert(error.message);
  }
}

async function restoreComment(commentId) {
  try {
    const result = await adminRequest('restore-comment', { commentId });
    updateStateFromFeed(result.feed);
    openHiddenCommentsModal();
  } catch (error) {
    alert(error.message);
  }
}

async function restorePost(postId) {
  try {
    const result = await adminRequest('restore-post', { postId });
    updateStateFromFeed(result.feed);
    openHiddenPostsModal();
  } catch (error) {
    alert(error.message);
  }
}

function openHiddenPostsModal() {
  document.querySelector('.modal-overlay')?.remove();
  const hidden = (state.hiddenPosts || [])
    .slice()
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));

  const { body } = createModal(`숨긴 글 · ${hidden.length}개`);
  if (!hidden.length) {
    const empty = document.createElement('p');
    empty.className = 'help';
    empty.textContent = '숨긴 글이 없어요.';
    body.append(empty);
    return;
  }
  for (const post of hidden) {
    const item = document.createElement('div');
    item.className = 'modal-comment';

    const meta = document.createElement('div');
    meta.className = 'modal-comment-meta';
    meta.textContent = `[${post.category || '속마음'}] ${post.nickname || '익명'} · ${formatDate(post.createdAt)}`;

    const text = document.createElement('p');
    text.className = 'modal-comment-text';
    text.textContent = post.content || '';

    const restore = document.createElement('button');
    restore.className = 'secondary-btn';
    restore.type = 'button';
    restore.textContent = '복원';
    restore.style.marginTop = '10px';
    restore.addEventListener('click', () => restorePost(post.id));

    item.append(meta, text, restore);
    body.append(item);
  }
}

function openHiddenCommentsModal() {
  document.querySelector('.modal-overlay')?.remove();
  const hidden = (state.hiddenComments || [])
    .slice()
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));

  const { body } = createModal(`숨긴 댓글 · ${hidden.length}개`);
  if (!hidden.length) {
    const empty = document.createElement('p');
    empty.className = 'help';
    empty.textContent = '숨긴 댓글이 없어요.';
    body.append(empty);
    return;
  }
  for (const comment of hidden) {
    const item = document.createElement('div');
    item.className = 'modal-comment';

    const meta = document.createElement('div');
    meta.className = 'modal-comment-meta';
    meta.textContent = `${comment.nickname || '익명'} · ${formatDate(comment.createdAt)}`;

    const text = document.createElement('p');
    text.className = 'modal-comment-text';
    text.textContent = comment.content || '';

    const onPost = document.createElement('p');
    onPost.className = 'modal-comment-post';
    onPost.textContent = `↳ 원글: ${postContentById(comment.postId).slice(0, 60)}`;

    const restore = document.createElement('button');
    restore.className = 'secondary-btn';
    restore.type = 'button';
    restore.textContent = '복원';
    restore.style.marginTop = '10px';
    restore.addEventListener('click', () => restoreComment(comment.id));

    item.append(meta, text, onPost, restore);
    body.append(item);
  }
}

function bindEvents() {
  $('#adminToggle').addEventListener('click', () => {
    state.adminOpen = true;
    $('#adminPanel').classList.remove('hidden');
    updateAdminGate();
    if (adminPin()) loadAdminFeed({ silent: true });
    renderPosts();
    $('#adminPanel').scrollIntoView({ block: 'start' });
  });

  $('#closeAdmin').addEventListener('click', () => {
    state.adminOpen = false;
    state.adminVerified = false;
    state.adminPin = '';
    updateAdminGate();
    $('#adminPanel').classList.add('hidden');
    loadFeed();
  });

  $('#writeBtn').addEventListener('click', openWriteModal);
  $('#refreshBtn').addEventListener('click', loadFeed);
  $('#searchInput').addEventListener('input', renderPosts);
  $('#searchType').addEventListener('change', () => {
    const type = $('#searchType').value;
    $('#searchInput').placeholder = type === 'nickname' ? '닉네임 검색' : '내용 검색';
    renderPosts();
  });
  $('#categoryFilter').addEventListener('change', renderPosts);
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

  const showHiddenPostsButton = $('#showHiddenPosts');
  if (showHiddenPostsButton) {
    showHiddenPostsButton.addEventListener('click', openHiddenPostsModal);
  }

  const showHiddenButton = $('#showHiddenComments');
  if (showHiddenButton) {
    showHiddenButton.addEventListener('click', openHiddenCommentsModal);
  }

  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('daesupTheme', next);
    applyTheme(next);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem('daesupTheme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.warn));
}

initTheme();
bindEvents();
updateAdminGate();
loadFeed();
