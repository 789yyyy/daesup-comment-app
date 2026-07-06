import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const STORE_NAME = 'daesup-comment-app';
const DATA_KEY = 'data';
const DEFAULT_ADMIN_PIN = '1234';

// 나영이 대숲 구글시트 기본 연결값
const DEFAULT_GOOGLE_SHEET_ID = '1o34hf9cyjC15hfbvJ2GH8RPLkRiDbQpxcVw9F2w4RW8';
const DEFAULT_GOOGLE_SHEET_GID = '1754398081';

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

function hash(value) {
  return createHash('sha1').update(String(value ?? '')).digest('hex');
}

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function compactKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\n\r\t_\-()[\]{}.,:;!?"'“”‘’·/\\|]+/g, '');
}

function defaultData() {
  return {
    version: 2,
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
      }
    ],
    comments: [],
    sync: {
      enabled: true,
      source: 'google-sheet',
      sheetId: googleSheetId(),
      gid: googleSheetGid(),
      lastSuccess: '',
      lastError: '',
      lastCount: 0
    }
  };
}

async function getData() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const data = await store.get(DATA_KEY, { type: 'json', consistency: 'strong' });
  const seed = defaultData();
  if (!data || typeof data !== 'object') {
    await store.setJSON(DATA_KEY, seed);
    return seed;
  }
  return {
    ...seed,
    ...data,
    settings: { ...seed.settings, ...(data.settings || {}) },
    posts: Array.isArray(data.posts) ? data.posts : [],
    comments: Array.isArray(data.comments) ? data.comments : [],
    sync: { ...seed.sync, ...(data.sync || {}) }
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

function googleSheetId() {
  return process.env.GOOGLE_SHEET_ID || DEFAULT_GOOGLE_SHEET_ID;
}

function googleSheetGid() {
  return process.env.GOOGLE_SHEET_GID || DEFAULT_GOOGLE_SHEET_GID;
}

function googleSheetCsvUrl() {
  if (process.env.GOOGLE_SHEET_CSV_URL) return process.env.GOOGLE_SHEET_CSV_URL;
  const id = googleSheetId();
  const gid = googleSheetGid();
  if (!id) return '';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => String(value).trim() !== '')) rows.push(row);
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(value => String(value ?? '').trim());
  return rows.slice(1).map((values, index) => {
    const object = { __rowNumber: index + 2 };
    header.forEach((key, i) => {
      object[key] = values[i] ?? '';
    });
    return object;
  });
}

const FIELD_ALIASES = {
  content: [
    'content', '내용', '글내용', '제보내용', '대숲내용', '대나무숲', '대나무숲내용', '대나무숲글', '익명제보', '제보', '본문', '메시지', 'message', 'answer', '답변',
    '대나무숲에남기고싶은말을적어주세요', '대나무숲에남기고싶은말', '남기고싶은말', '하고싶은말', '익명으로남기고싶은말', '속마음', '건의칭찬내용'
  ],
  category: ['category', '카테고리', '분류', '종류', '유형', '구분', '말머리', '게시판'],
  nickname: ['nickname', '닉네임', '별명', '작성자', '이름', '작성자명', '본인닉네임', '본인이쓴닉네임', '닉네임을입력해주세요', '닉네임기본익명', '표시이름'],
  status: ['status', '상태', '공개여부', '게시여부', '승인', '공개', '관리자확인'],
  createdAt: ['createdat', 'created_at', '작성일', '작성일시', '제출일', '제출시간', '타임스탬프', 'timestamp', '날짜', '일시', '시간']
};

function findValue(row, field) {
  const entries = Object.entries(row).filter(([key]) => key !== '__rowNumber');
  const aliases = (FIELD_ALIASES[field] || []).map(compactKey);

  for (const [key, value] of entries) {
    if (aliases.includes(compactKey(key))) return value;
  }

  // 구글폼 질문 문장처럼 길게 들어온 경우까지 넓게 잡기
  if (field === 'content') {
    const metaKeys = new Set([
      ...FIELD_ALIASES.category.map(compactKey),
      ...FIELD_ALIASES.nickname.map(compactKey),
      ...FIELD_ALIASES.status.map(compactKey),
      ...FIELD_ALIASES.createdAt.map(compactKey)
    ]);
    const candidates = entries
      .filter(([key, value]) => !metaKeys.has(compactKey(key)) && String(value ?? '').trim())
      .sort((a, b) => String(b[1]).length - String(a[1]).length);
    return candidates[0]?.[1] || '';
  }

  return '';
}

function parseMaybeDate(value) {
  const raw = cleanText(value, 80);
  if (!raw) return '';
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const normalized = raw
    .replace(/오전/g, 'AM')
    .replace(/오후/g, 'PM')
    .replace(/년|월/g, '-')
    .replace(/일/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return raw;
}

function normalizeStatus(value) {
  const raw = cleanText(value, 20);
  const key = compactKey(raw);
  if (!raw) return '게시';
  if (['숨김', '비공개', '미게시', '삭제', '제외', 'no', 'false', 'x', '비승인'].some(word => key.includes(compactKey(word)))) return '숨김';
  return '게시';
}

function normalizePost(input = {}) {
  const createdAt = input.createdAt ? parseMaybeDate(input.createdAt) : nowISO();
  return {
    id: cleanText(input.id, 100) || makeId('post'),
    createdAt,
    category: cleanText(input.category || '속마음', 30) || '속마음',
    nickname: cleanText(input.nickname || '익명', 30) || '익명',
    content: cleanText(input.content, 2000),
    status: normalizeStatus(input.status || '게시'),
    source: cleanText(input.source || 'manual', 40) || 'manual'
  };
}

function normalizeSheetPost(row) {
  const content = cleanText(findValue(row, 'content'), 2000);
  if (!content) return null;
  const rowNumber = Number(row.__rowNumber || 0) || 0;
  const createdAt = parseMaybeDate(findValue(row, 'createdAt')) || nowISO();
  const nickname = cleanText(findValue(row, 'nickname') || '익명', 30) || '익명';
  const category = cleanText(findValue(row, 'category') || '속마음', 30) || '속마음';
  const status = normalizeStatus(findValue(row, 'status') || '게시');

  return {
    id: cleanText(row.id, 100) || `sheet_row_${rowNumber || hash(`${createdAt}|${nickname}|${content}`).slice(0, 10)}`,
    createdAt,
    category,
    nickname,
    content,
    status,
    source: 'google-sheet'
  };
}

function normalizeComment(input = {}) {
  return {
    id: makeId('comment'),
    postId: cleanText(input.postId, 100),
    createdAt: nowISO(),
    nickname: cleanText(input.nickname || '익명', 30) || '익명',
    content: cleanText(input.content, 600),
    status: '게시'
  };
}

async function fetchSheetPosts() {
  const url = googleSheetCsvUrl();
  if (!url) return { posts: [], error: 'GOOGLE_SHEET_ID 또는 GOOGLE_SHEET_CSV_URL이 없어요.' };

  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
    headers: { 'user-agent': 'daesup-comment-app/1.0' }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`구글시트 응답 오류 ${response.status}`);
  if (/<!doctype html|<html/i.test(text.slice(0, 200))) {
    throw new Error('구글시트가 공개 상태가 아니거나 CSV로 받을 수 없어요. 공유를 “링크가 있는 모든 사용자 보기”로 바꿔줘.');
  }

  const rows = csvToObjects(text);
  const posts = rows.map(normalizeSheetPost).filter(Boolean);
  return { posts, error: '' };
}

async function syncGoogleSheet(data, { force = false } = {}) {
  const enabled = process.env.SYNC_GOOGLE_SHEET !== 'false';
  if (!enabled && !force) return data;

  try {
    const { posts } = await fetchSheetPosts();
    const localPosts = data.posts.filter(post => {
      const id = String(post.id || '');
      return post.source !== 'google-sheet' && !id.startsWith('sheet_row_') && !id.startsWith('post_sample_');
    });

    data.posts = [...posts, ...localPosts];
    data.sync = {
      enabled: true,
      source: 'google-sheet',
      sheetId: googleSheetId(),
      gid: googleSheetGid(),
      lastSuccess: nowISO(),
      lastError: '',
      lastCount: posts.length
    };
    await saveData(data);
    return data;
  } catch (error) {
    data.sync = {
      ...(data.sync || {}),
      enabled: true,
      source: 'google-sheet',
      sheetId: googleSheetId(),
      gid: googleSheetGid(),
      lastError: error?.message || String(error)
    };
    await saveData(data);
    return data;
  }
}

function timeValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function publicData(data, { admin = false } = {}) {
  const posts = data.posts
    .filter(post => post.status !== '숨김')
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .map(post => ({
      ...post,
      // 일반 이용자에게는 작성자 닉네임을 절대 내려주지 않음.
      // 관리자 PIN으로 확인한 화면에서만 실제 닉네임 표시.
      nickname: admin ? (post.nickname || '익명') : '익명',
      writerAdminOnly: Boolean(admin && post.nickname && post.nickname !== '익명')
    }));
  const visiblePostIds = new Set(posts.map(post => post.id));
  const comments = data.comments
    .filter(comment => comment.status !== '숨김' && visiblePostIds.has(comment.postId))
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  return {
    settings: data.settings,
    posts,
    comments,
    sync: data.sync,
    adminDefaultPin: !process.env.ADMIN_PIN,
    adminView: admin
  };
}

export default async (req) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  try {
    const action = getAction(url);
    let data = await getData();

    if (req.method === 'GET') {
      if (action === 'feed') {
        data = await syncGoogleSheet(data);
        return json(publicData(data));
      }
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

    const adminActions = ['admin-feed', 'post', 'import-posts', 'delete-post', 'delete-comment', 'settings', 'reset-sample', 'sync-now'];
    if (adminActions.includes(action) && !isAdmin(req, body, url)) {
      return json({ error: '관리자 PIN이 맞지 않아요.' }, 401);
    }

    if (req.method === 'POST' && action === 'admin-feed') {
      data = await syncGoogleSheet(data);
      return json({ ok: true, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'sync-now') {
      data = await syncGoogleSheet(data, { force: true });
      return json({ ok: true, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'post') {
      const post = normalizePost({ ...body, source: 'manual' });
      if (!post.content) return json({ error: '게시글 내용을 입력해 주세요.' }, 400);
      data.posts.unshift(post);
      await saveData(data);
      return json({ ok: true, post, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'import-posts') {
      const posts = Array.isArray(body.posts) ? body.posts.map(item => normalizePost({ ...item, source: 'import' })).filter(post => post.content) : [];
      if (!posts.length) return json({ error: '가져올 글이 없어요. content 컬럼이 필요해요.' }, 400);
      const mode = body.mode === 'replace' ? 'replace' : 'append';
      data.posts = mode === 'replace' ? posts : [...posts, ...data.posts];
      if (mode === 'replace') data.comments = [];
      await saveData(data);
      return json({ ok: true, count: posts.length, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'delete-post') {
      const postId = cleanText(body.postId, 100);
      const post = data.posts.find(item => item.id === postId);
      if (!post) return json({ error: '글을 찾을 수 없어요.' }, 404);
      post.status = '숨김';
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'delete-comment') {
      const commentId = cleanText(body.commentId, 100);
      const comment = data.comments.find(item => item.id === commentId);
      if (!comment) return json({ error: '댓글을 찾을 수 없어요.' }, 404);
      comment.status = '숨김';
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'settings') {
      data.settings = {
        ...data.settings,
        appTitle: cleanText(body.appTitle || data.settings.appTitle, 60),
        appSubtitle: cleanText(body.appSubtitle || data.settings.appSubtitle, 120),
        notice: cleanText(body.notice || data.settings.notice, 200)
      };
      await saveData(data);
      return json({ ok: true, settings: data.settings, feed: publicData(data, { admin: true }) });
    }

    if (req.method === 'POST' && action === 'reset-sample') {
      const seed = defaultData();
      await saveData(seed);
      return json({ ok: true, feed: publicData(seed, { admin: true }) });
    }

    return json({ error: '요청을 처리할 수 없어요.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: '서버 오류가 났어요.', detail: error?.message || String(error) }, 500);
  }
};
