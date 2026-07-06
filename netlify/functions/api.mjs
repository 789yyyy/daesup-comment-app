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

// 원본 IP는 저장하지 않고, 해시 지문만 만들기 위한 클라이언트 IP 추출
function clientIp(req, context) {
  const raw =
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for') ||
    req.headers.get('client-ip') ||
    '';
  const first = String(raw).split(',')[0].trim();
  return first || context?.ip || '';
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
    // 투표는 글/댓글 id 기준 별도 보관 (구글시트 sync로 글 객체가 새로 생겨도 유지)
    votes: { post: {}, comment: {} },
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
    votes: {
      post: (data.votes && data.votes.post) || {},
      comment: (data.votes && data.votes.comment) || {}
    },
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
  nickname: [
    'nickname', '닉네임', '닉넴', '닉', '별명', '작성자', '이름', '작성자명', '본인닉네임', '본인이쓴닉네임',
    '닉네임을입력해주세요', '닉네임기본익명', '표시이름', '대화명', '본인대화명',
    '오픈채팅닉네임', '오픈카톡닉네임', '카톡닉네임', '카카오톡닉네임', '단톡방닉네임', '방닉네임', '사용닉네임',
    '구글폼닉네임', '폼닉네임', '제보자닉네임', '익명닉네임', '대숲닉네임'
  ],
  status: ['status', '상태', '공개여부', '게시여부', '승인', '공개', '관리자확인'],
  createdAt: ['createdat', 'created_at', '작성일', '작성일시', '제출일', '제출시간', '타임스탬프', 'timestamp', '날짜', '일시', '시간'],
  email: ['email', '이메일', '이메일주소', '메일', '메일주소', '구글계정', '구글이메일', '이메일을입력해주세요', '이메일주소를입력해주세요'],
  realName: ['realname', 'name', '실명', '이름', '본명', '성함', '실제이름', '본인이름'],
  phone: ['phone', 'tel', '전화번호', '휴대폰', '연락처', '핸드폰번호', '휴대폰번호', '전화'],
  privateContact: ['비공개연락처', '관리자용연락처', '운영진확인용', '운영자확인용', '확인용정보', '비상연락처'],
  account: ['아이디', '카톡아이디', '카카오톡아이디', '인스타아이디', '오픈채팅프로필', '오픈채팅이름'],
  location: ['장소', '위치', '지역', '방문장소', '모임장소'],
  adminMemo: ['관리자메모', '운영진메모', '메모', '비고']
};

function findValue(row, field) {
  const entries = Object.entries(row).filter(([key]) => key !== '__rowNumber');
  const aliases = (FIELD_ALIASES[field] || []).map(compactKey);

  // 1) 컬럼명이 정확히 같은 경우
  for (const [key, value] of entries) {
    if (aliases.includes(compactKey(key))) return value;
  }

  // 2) 구글폼 질문이 길어도 잡히게: "본인 닉네임을 입력해주세요" 같은 문장형 컬럼 대응
  for (const [key, value] of entries) {
    const compact = compactKey(key);
    if (!String(value ?? '').trim()) continue;
    if (aliases.some(alias => alias && (compact.includes(alias) || alias.includes(compact)))) return value;
  }

  // 3) 닉네임은 실제 구글폼에서 질문 문구가 제각각이라 한 번 더 넓게 잡기
  if (field === 'nickname') {
    const nicknameLikeWords = ['닉네임', '닉넴', '닉', '별명', '대화명', '작성자', '제보자', '이름'];
    for (const [key, value] of entries) {
      const compact = compactKey(key);
      const raw = String(value ?? '').trim();
      if (!raw) continue;
      if (nicknameLikeWords.some(word => compact.includes(compactKey(word)))) return value;
    }
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
      .filter(([key, value]) => {
        const compact = compactKey(key);
        const isMeta = metaKeys.has(compact)
          || FIELD_ALIASES.nickname.map(compactKey).some(alias => compact.includes(alias) || alias.includes(compact))
          || ['닉네임', '닉넴', '닉', '별명', '대화명', '작성자', '제보자', '이름'].some(word => compact.includes(compactKey(word)));
        return !isMeta && String(value ?? '').trim();
      })
      .sort((a, b) => String(b[1]).length - String(a[1]).length);
    return candidates[0]?.[1] || '';
  }

  return '';
}

function parseMaybeDate(value) {
  const raw = cleanText(value, 80);
  if (!raw) return '';

  // 구글폼 한국어 타임스탬프: "2026. 6. 26 오전 10:55:42" / "2026. 7. 6 오후 3:04"
  const kr = raw.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (kr) {
    const [, y, mo, d, ampm, h, mi, s] = kr;
    let hour = Number(h);
    if (ampm === '오후' && hour < 12) hour += 12;
    if (ampm === '오전' && hour === 12) hour = 0;
    // 구글폼 시각은 한국시간(KST, UTC+9). 서버 타임존(Netlify=UTC)에 흔들리지 않도록
    // UTC 기준으로 만든 뒤 9시간을 빼서 올바른 UTC 순간으로 변환한다.
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi), s ? Number(s) : 0) - KST_OFFSET_MS);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

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


function buildAdminMeta(row, { nickname = '', createdAt = '' } = {}) {
  const meta = {
    sheetRow: row.__rowNumber || '',
    submittedAt: createdAt || parseMaybeDate(findValue(row, 'createdAt')) || '',
    sheetNickname: cleanText(nickname || findValue(row, 'nickname') || '', 60)
  };

  const fields = [
    ['email', '이메일'],
    ['realName', '실명'],
    ['phone', '전화번호'],
    ['privateContact', '비공개 연락처'],
    ['account', '계정/아이디'],
    ['location', '장소/지역'],
    ['adminMemo', '관리자 메모']
  ];

  for (const [field, label] of fields) {
    const value = cleanText(findValue(row, field), field === 'adminMemo' ? 300 : 120);
    if (value) meta[field] = { label, value };
  }

  return meta;
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
    source: 'google-sheet',
    adminMeta: buildAdminMeta(row, { nickname, createdAt })
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

function tallyVotes(votesMap, id, viewerHash) {
  const votes = (votesMap && votesMap[id]) || {};
  const values = Object.values(votes);
  return {
    up: values.filter(v => v === 'up').length,
    down: values.filter(v => v === 'down').length,
    myVote: viewerHash ? (votes[viewerHash] || null) : null
  };
}

function publicData(data, { admin = false, viewerHash = '' } = {}) {
  const postVotes = (data.votes && data.votes.post) || {};
  const commentVotes = (data.votes && data.votes.comment) || {};
  const posts = data.posts
    .filter(post => post.status !== '숨김')
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .map(post => {
      const v = tallyVotes(postVotes, post.id, viewerHash);
      const publicPost = {
        id: post.id,
        createdAt: post.createdAt,
        category: post.category || '속마음',
        nickname: post.nickname || '익명',
        content: post.content || '',
        status: post.status || '게시',
        source: post.source || 'manual',
        up: v.up,
        down: v.down,
        myVote: v.myVote
      };
      // 관리자 화면에서만 IP 해시의 앞 8자리를 지문으로 노출 (원본 IP·전체 해시는 비공개)
      if (admin && post.ipHash) publicPost.ipHash = String(post.ipHash).slice(0, 8);
      return publicPost;
    });
  const visiblePostIds = new Set(posts.map(post => post.id));
  const comments = data.comments
    .filter(comment => comment.status !== '숨김' && visiblePostIds.has(comment.postId))
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
    .map(comment => {
      const v = tallyVotes(commentVotes, comment.id, viewerHash);
      const publicComment = {
        id: comment.id,
        postId: comment.postId,
        createdAt: comment.createdAt,
        nickname: comment.nickname || '익명',
        content: comment.content || '',
        status: comment.status || '게시',
        up: v.up,
        down: v.down,
        myVote: v.myVote
      };
      // 관리자 화면에서만 IP 해시의 앞 8자리를 지문으로 노출 (원본 IP·전체 해시는 비공개)
      if (admin && comment.ipHash) publicComment.ipHash = String(comment.ipHash).slice(0, 8);
      return publicComment;
    });
  const result = {
    settings: data.settings,
    posts,
    comments,
    sync: data.sync,
    adminDefaultPin: !process.env.ADMIN_PIN,
    adminView: admin
  };
  // 관리자 화면에만 숨긴 글·댓글 목록을 함께 내려줌
  if (admin) {
    result.hiddenPosts = data.posts
      .filter(post => post.status === '숨김')
      .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
      .map(post => ({
        id: post.id,
        createdAt: post.createdAt,
        category: post.category || '속마음',
        nickname: post.nickname || '익명',
        content: post.content || '',
        source: post.source || 'manual',
        ipHash: post.ipHash ? String(post.ipHash).slice(0, 8) : ''
      }));
    result.hiddenComments = data.comments
      .filter(comment => comment.status === '숨김')
      .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
      .map(comment => ({
        id: comment.id,
        postId: comment.postId,
        createdAt: comment.createdAt,
        nickname: comment.nickname || '익명',
        content: comment.content || '',
        ipHash: comment.ipHash ? String(comment.ipHash).slice(0, 8) : ''
      }));
  }
  return result;
}

export default async (req, context) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers });
  }

  try {
    const action = getAction(url);
    let data = await getData();
    const viewerIp = clientIp(req, context);
    const viewerHash = viewerIp ? hash(viewerIp) : '';

    if (req.method === 'GET') {
      if (action === 'feed') {
        data = await syncGoogleSheet(data);
        return json(publicData(data, { viewerHash }));
      }
      return json({ error: '없는 API예요.' }, 404);
    }

    const body = await readBody(req);

    if (req.method === 'POST' && action === 'comment') {
      const comment = normalizeComment(body);
      if (!comment.postId || !comment.content) return json({ error: '댓글 내용을 입력해 주세요.' }, 400);
      const target = data.posts.find(post => post.id === comment.postId && post.status !== '숨김');
      if (!target) return json({ error: '글을 찾을 수 없어요.' }, 404);
      const ip = clientIp(req, context);
      comment.ipHash = ip ? hash(ip) : '';
      data.comments.push(comment);
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { viewerHash }) });
    }

    if (req.method === 'POST' && action === 'create-post') {
      // 누구나 글쓰기 가능. id·status는 사용자 입력을 신뢰하지 않음(주입 방지).
      const post = normalizePost({
        category: body.category,
        nickname: body.nickname,
        content: body.content,
        source: 'user'
      });
      if (!post.content) return json({ error: '글 내용을 입력해 주세요.' }, 400);
      const ip = clientIp(req, context);
      post.ipHash = ip ? hash(ip) : '';
      data.posts.unshift(post);
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { viewerHash }) });
    }

    if (req.method === 'POST' && (action === 'vote-post' || action === 'vote-comment')) {
      const isPost = action === 'vote-post';
      const id = cleanText(isPost ? body.postId : body.commentId, 100);
      const dir = body.dir === 'down' ? 'down' : (body.dir === 'up' ? 'up' : '');
      if (!id || !dir) return json({ error: '잘못된 투표 요청이에요.' }, 400);
      if (!viewerHash) return json({ error: '지금은 투표할 수 없어요.' }, 400);
      const target = isPost
        ? data.posts.find(item => item.id === id && item.status !== '숨김')
        : data.comments.find(item => item.id === id && item.status !== '숨김');
      if (!target) return json({ error: '대상을 찾을 수 없어요.' }, 404);
      const bucket = isPost ? data.votes.post : data.votes.comment;
      const map = bucket[id] || (bucket[id] = {});
      if (map[viewerHash] === dir) delete map[viewerHash];   // 같은 버튼 다시 → 취소
      else map[viewerHash] = dir;                            // 새로 투표 / 반대로 전환
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { viewerHash }) });
    }

    const adminActions = ['admin-feed', 'delete-post', 'restore-post', 'delete-comment', 'restore-comment', 'settings', 'sync-now'];
    if (adminActions.includes(action) && !isAdmin(req, body, url)) {
      return json({ error: '관리자 PIN이 맞지 않아요.' }, 401);
    }

    if (req.method === 'POST' && action === 'admin-feed') {
      data = await syncGoogleSheet(data);
      return json({ ok: true, feed: publicData(data, { admin: true, viewerHash }) });
    }

    if (req.method === 'POST' && action === 'sync-now') {
      data = await syncGoogleSheet(data, { force: true });
      return json({ ok: true, feed: publicData(data, { admin: true, viewerHash }) });
    }

    if (req.method === 'POST' && action === 'delete-post') {
      const postId = cleanText(body.postId, 100);
      const post = data.posts.find(item => item.id === postId);
      if (!post) return json({ error: '글을 찾을 수 없어요.' }, 404);
      post.status = '숨김';
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { admin: true, viewerHash }) });
    }

    if (req.method === 'POST' && action === 'restore-post') {
      const postId = cleanText(body.postId, 100);
      const post = data.posts.find(item => item.id === postId);
      if (!post) return json({ error: '글을 찾을 수 없어요.' }, 404);
      post.status = '게시';
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { admin: true, viewerHash }) });
    }

    if (req.method === 'POST' && action === 'delete-comment') {
      const commentId = cleanText(body.commentId, 100);
      const comment = data.comments.find(item => item.id === commentId);
      if (!comment) return json({ error: '댓글을 찾을 수 없어요.' }, 404);
      comment.status = '숨김';
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { admin: true, viewerHash }) });
    }

    if (req.method === 'POST' && action === 'restore-comment') {
      const commentId = cleanText(body.commentId, 100);
      const comment = data.comments.find(item => item.id === commentId);
      if (!comment) return json({ error: '댓글을 찾을 수 없어요.' }, 404);
      comment.status = '게시';
      await saveData(data);
      return json({ ok: true, feed: publicData(data, { admin: true, viewerHash }) });
    }

    if (req.method === 'POST' && action === 'settings') {
      data.settings = {
        ...data.settings,
        appTitle: cleanText(body.appTitle || data.settings.appTitle, 60),
        appSubtitle: cleanText(body.appSubtitle || data.settings.appSubtitle, 120),
        notice: cleanText(body.notice || data.settings.notice, 200)
      };
      await saveData(data);
      return json({ ok: true, settings: data.settings, feed: publicData(data, { admin: true, viewerHash }) });
    }

    return json({ error: '요청을 처리할 수 없어요.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: '서버 오류가 났어요.', detail: error?.message || String(error) }, 500);
  }
};
