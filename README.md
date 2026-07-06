# 대나무숲 댓글앱 - Netlify 서버 저장 버전

나영이용으로 만든 **대숲 + 댓글 + 관리자 등록 + 엑셀 업로드 + 홈화면 추가(PWA)** 앱입니다.

이 버전은 구글시트가 필요 없습니다. Netlify의 서버 기능인 **Netlify Functions**와 **Netlify Blobs**에 글/댓글을 저장합니다.

---

## 들어있는 기능

- 대나무숲 글 목록 보기
- 글별 댓글 달기
- 검색 / 카테고리 필터
- 관리자 PIN으로 글 직접 등록
- 관리자 PIN으로 엑셀/CSV 글 일괄 업로드
- 글/댓글 숨김 처리
- 데이터 JSON 백업
- 핸드폰 홈화면에 앱처럼 추가 가능

---

## 엑셀 업로드 형식

엑셀 첫 번째 줄에 아래 컬럼명을 넣어주세요.

| content | category | nickname | status |
|---|---|---|---|
| 방탈출 끝나고 단톡방 정리 규칙을 다시 공지해주면 좋겠어요 | 건의 | 익명 | 게시 |

필수 컬럼은 `content` 하나입니다.

한국어 컬럼명도 일부 인식합니다.

- `내용`, `글내용`, `제보내용` → content
- `카테고리`, `분류` → category
- `닉네임`, `작성자` → nickname
- `상태` → status

---

## 가장 쉬운 배포 방법: GitHub + Netlify

서버 저장 기능을 쓰려면 Netlify가 프로젝트를 빌드해야 합니다. 그냥 HTML만 드래그하는 방식보다 **GitHub 연결 배포**가 안전합니다.

### 1. GitHub에 새 저장소 만들기

1. GitHub 로그인
2. New repository 클릭
3. 이름 예시: `daesup-comment-app`
4. Public 또는 Private 아무거나 가능
5. Create repository

### 2. ZIP 압축 풀고 GitHub에 업로드

이 ZIP을 압축 풀면 아래 구조가 보여야 합니다.

```text
public/
netlify/
netlify.toml
package.json
README.md
sample_posts.csv
```

GitHub 저장소에 이 파일들을 전부 업로드하세요.

### 3. Netlify에서 Import

1. Netlify 로그인
2. Add new site
3. Import an existing project
4. GitHub 선택
5. 방금 만든 저장소 선택
6. 설정은 자동으로 잡힙니다.
   - Build command: `npm run build`
   - Publish directory: `public`
7. Deploy 클릭

---

## 관리자 PIN 꼭 바꾸기

처음에는 기본 PIN이 `1234`입니다.

Netlify에서 아래처럼 바꿔주세요.

1. Netlify 사이트 들어가기
2. Site configuration
3. Environment variables
4. Add variable
5. Key: `ADMIN_PIN`
6. Value: 원하는 비밀번호. 예: `0716wavy!`
7. Save
8. Deploys 메뉴에서 Trigger deploy 또는 재배포

---

## 앱 사용법

### 일반 사용자

1. 앱 주소 접속
2. 글 보기
3. 댓글 입력
4. 댓글 버튼 누르기

### 관리자

1. 오른쪽 위 `관리자` 버튼 클릭
2. 관리자 PIN 입력
3. 글 직접 등록 또는 엑셀 업로드
4. 필요하면 글/댓글 숨김 처리

---

## 핸드폰 앱처럼 쓰기

### 아이폰

Safari에서 앱 주소 열기 → 공유 버튼 → 홈 화면에 추가

### 갤럭시/안드로이드

Chrome에서 앱 주소 열기 → 점 세 개 메뉴 → 홈 화면에 추가

---

## 주의할 점

- 이 앱은 모임용/소규모 대숲에 맞춘 간단 서버앱입니다.
- 악성 댓글 자동 차단, 회원가입, 신고 누적 제재 같은 고급 기능은 아직 없습니다.
- 글/댓글 삭제는 실제 완전 삭제가 아니라 화면에서 숨김 처리입니다.
- 사람이 엄청 많이 동시에 쓰는 커뮤니티라면 나중에는 Supabase/Firebase 같은 DB로 바꾸는 게 좋습니다.

---

## 수정하고 싶은 문구

앱 안에서 관리자 모드로 들어가면 제목, 설명, 공지 문구를 바로 바꿀 수 있습니다.

