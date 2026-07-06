# 대나무숲 댓글앱 - 관리자 잠금 버전

이 버전은 관리자 버튼을 눌러도 PIN이 맞기 전에는 관리 도구가 보이지 않습니다.

## 기능
- 구글시트 자동연동
- 게시글 닉네임 공개 표시
- 댓글 최신순 표시
- 관리자 PIN 인증 후에만 문구 수정, 글 등록, 숨김 처리, 동기화 버튼 표시

## Netlify 관리자 비밀번호
Netlify > Project configuration > Environment variables 에서 아래처럼 넣어야 합니다.

- Key: `ADMIN_PIN`
- Value: 원하는 비밀번호

저장 후 Deploys > Trigger deploy > Deploy project 를 눌러 재배포하세요.

⚠️ Key 칸에 비밀번호 숫자를 넣으면 안 됩니다. Key는 반드시 `ADMIN_PIN`이어야 합니다.
