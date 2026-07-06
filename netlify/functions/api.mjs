import { getStore } from '@netlify/blobs';

const STORE_NAME = 'daesup-comment-app';
const DATA_KEY = 'data';
const DEFAULT_ADMIN_PIN = '1234';

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function nowISO() {
  return new Date().toISOString();
}

function makeId(prefix) {
  const id = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${id}`;
}

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function defaultData() {
  return {
    version: 1,
    settings: {
      appTitle: '대나무숲',
      appSubtitle: '익명으로 남긴 속마음 · 건의 · 칭찬',
      notice: '서로 불편하지 않게, 선 넘는 내용은 운영진이 정리할 수 있어요.'
    },
    posts: [
      {
        id: 'post_sample_1',
        createdAt: nowISO(),
        category: '건의',
        nickname: '익명',
        content: '방탈출 끝나고 단톡방 정리 규칙을 다시 공지해주면 좋겠어요.',
        status: '게시'
      },
      {
        id: 'post_sample_2',
        createdAt: nowISO(),
        category: '칭찬',
        nickname: '익명',
        content: '운영진 고생 많아요! 첫 정모 기대됩니다.',
        status: '게시'
      }
    ],
    comments: []
  };
}

async function getData() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const data = await store.get(DATA_KEY, { type: 'json', consistency: 'strong' });
  if (!data || typeof data !== 'object') {
    const seed = defaultData();
    await store.setJSON(DATA_KEY, seed);
    return seed;
  }
  return {
    ...defaultData(),
    ...data,
    settings: { ...defaultData().settings, ...(data.settings || {}) },
    posts: Array.isArray(data.posts) ? data.posts : [],
    comments: Array.isArray(data.comments) ? data.comments : []
  };
}

async function saveData(data) {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  data.updatedAt = nowISO();
  await store.setJSON(DATA_KEY, data);
  return data;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function adminPin() {
  return process.env.ADMIN_PIN || DEFAULT_ADMIN_PIN;
}

function isAdmin(req, body, url) {
  const received = req.headers.get('x-admin-pin') || body?.adminPin || url.searchParams.get('pin');
  return Boolean(received) && received === adminPin();
}

function getAction(url) {
  const fromQuery = url.searchParams.get('action');
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split('/').filter(Boolean);
  const apiIndex = parts.lastIndexOf('api');
  if (apiIndex >= 0 && parts[apiIndex + 1]) return parts[apiIndex + 1];
  return 'feed';
}

function publicData(data) {
  const posts = data.posts
    .filter(post => post.status !== '숨김')
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const visiblePostIds = new Set(posts.map(post => post.id));
  const comments = data.comments
    .filter(comment => comment.status !== '숨김' && visiblePostIds.has(comment.postId))
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return { settings: data.settings, posts, comments, adminDefaultPin: !process.env.ADMIN_PIN };
}

function normalizePost(input = {}) {
  return {
    id: cleanText(input.id, 80) || makeId('post'),
    createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : nowISO(),
    category: cleanText(input.category || '속마음', 20) || '속마음',
    nickname: cleanText(input.nickname || '익명', 20) || '익명',
    content: cleanText(input.content, 1600),
    status: cleanText(input.status || '게시', 10) || '게시'
  };
}

function normalizeComment(input = {}) {
  return {
    id: makeId('comment'),
    postId: cleanText(input.postId, 100),
    createdAt: nowISO(),
    nickname: cleanText(input.nickname || '익명', 20) || '익명',
    content: cleanText(input.content, 600),
    status: '게시'
  };
}

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  try {
    const action = getAction(url);
    const data = await getData();

    if (req.method === 'GET') {
      if (action === 'feed') return json(publicData(data));
      if (action === 'admin-export') {
        if (!isAdmin(req, {}, url)) return json({ error: '관리자 PIN이 맞지 않아요.' }, 401);
        return json(data);
      }
      return json({ error: '없는 API예요.' }, 404);
    }

    const body = await readBody(req);

    if (req.method === 'POST' && action === 'comment') {
      const comment = normalizeComment(body);
      if (!comment.postId || !comment.content) return json({ error: '댓글 내용을 입력해 주세요.' }, 400);
      const target = data.posts.find(post => post.id === comment.postId && post.status !== '숨김');
      if (!target) return json({ error: '글을 찾을 수 없어요.' }, 404);
      data.comments.push(comment);
      await saveData(data);
      return json({ ok: true, comment, feed: publicData(data) });
    }

    const adminActions = ['post', 'import-posts', 'delete-post', 'delete-comment', 'settings', 'reset-sample'];
    if (adminActions.includes(action) && !isAdmin(req, body, url)) {
      return json({ error: '관리자 PIN이 맞지 않아요.' }, 401);
    }

    if (req.method === 'POST' && action === 'post') {
      const post = normalizePost(body);
      if (!post.content) return json({ error: '게시글 내용을 입력해 주세요.' }, 400);
      data.posts.unshift(post);
      await saveData(data);
      return json({ ok: true, post, feed: publicData(data) });
    }

    if (req.method === 'POST' && action === 'import-posts') {
      const posts = Array.isArray(body.posts) ? body.posts.map(normalizePost).filter(post => post.content) : [];
      if (!posts.length) return json({ error: '가져올 글이 없어요. content 컬럼이 필요해요.' }, 400);
      const mode = body.mode === 'replace' ? 'replace' : 'append';
      data.posts = mode === 'replace' ? posts : [...posts, ...data.posts];
      if (mode === 'replace') data.comments = [];
      await saveData(data);
      return json({ ok: true, count: posts.length, feed: publicData(data) });
    }

    if (req.method === 'POST' && action === 'delete-post') {
      const postId = cleanText(body.postId, 100);
      const post = data.posts.find(item => item.id === postId);
      if (!post) return json({ error: '글을 찾을 수 없어요.' }, 404);
      post.status = '숨김';
      await saveData(data);
      return json({ ok: true, feed: publicData(data) });
    }

    if (req.method === 'POST' && action === 'delete-comment') {
      const commentId = cleanText(body.commentId, 100);
      const comment = data.comments.find(item => item.id === commentId);
      if (!comment) return json({ error: '댓글을 찾을 수 없어요.' }, 404);
      comment.status = '숨김';
      await saveData(data);
      return json({ ok: true, feed: publicData(data) });
    }

    if (req.method === 'POST' && action === 'settings') {
      data.settings = {
        ...data.settings,
        appTitle: cleanText(body.appTitle || data.settings.appTitle, 60),
        appSubtitle: cleanText(body.appSubtitle || data.settings.appSubtitle, 120),
        notice: cleanText(body.notice || data.settings.notice, 200)
      };
      await saveData(data);
      return json({ ok: true, settings: data.settings, feed: publicData(data) });
    }

    if (req.method === 'POST' && action === 'reset-sample') {
      const seed = defaultData();
      await saveData(seed);
      return json({ ok: true, feed: publicData(seed) });
    }

    return json({ error: '요청을 처리할 수 없어요.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: '서버 오류가 났어요.', detail: error?.message || String(error) }, 500);
  }
};
