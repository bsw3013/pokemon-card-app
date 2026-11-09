# 🎮 포켓몬 카드 도감 앱 — 개발환경 셋업 가이드

> 다른 컴퓨터에서 이 프로젝트를 이어서 수정하기 위한 완전한 안내서입니다.

---

## ✅ 사전 준비 (최초 1회, 설치되어 있다면 건너뜀)

### 1. Node.js 설치
- https://nodejs.org 에서 **LTS 버전** 다운로드 & 설치
- 설치 후 확인: `node -v` → v18 이상이면 OK

### 2. Git 설치
- https://git-scm.com 에서 다운로드 & 설치
- 설치 후 확인: `git -v`

### 3. VSCode 설치 (선택사항이지만 강력 추천)
- https://code.visualstudio.com 에서 다운로드

---

## 📥 프로젝트 다운로드 (Clone)

터미널(PowerShell 또는 VSCode 내 터미널)을 열고 아래 명령어를 순서대로 입력합니다.

```bash
# 원하는 폴더로 이동 (예: Documents)
cd Documents

# 깃허브에서 프로젝트 복사 (Clone)
git clone https://github.com/bsw3013/pokemon-card-app.git

# 폴더 진입
cd pokemon-card-app

# 라이브러리 설치
npm install
```

---

## 🔑 환경변수 파일 생성 (.env.local) — 중요!

`.env.local` 파일은 보안상 깃허브에 올라가지 않기 때문에 **직접 생성**해야 합니다.

프로젝트 폴더 최상단(`pokemon-card-app/`)에 `.env.local` 파일을 새로 만들고, 아래 형식대로 값을 채워 넣습니다.
**실제 키 값은 이 문서(공개 저장소)에 절대 적지 않습니다.** 값은 아래 "어디서 찾나요"를 보고 직접 복사해 오세요.

```
VITE_GEMINI_API_KEY="(Gemini API 키)"
VITE_FIREBASE_API_KEY="(Firebase 웹 API 키)"
VITE_FIREBASE_AUTH_DOMAIN="pokemoncard-0319.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="pokemoncard-0319"
VITE_FIREBASE_STORAGE_BUCKET="pokemoncard-0319.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="(Firebase 메시징 발신자 ID)"
VITE_FIREBASE_APP_ID="(Firebase 앱 ID)"
```

어디서 찾나요?
- **Firebase 값들**: [Firebase 콘솔](https://console.firebase.google.com/project/pokemoncard-0319/settings/general) → 프로젝트 설정 → 일반 → "내 앱"의 SDK 설정
- **Gemini 키**: [Google AI Studio](https://aistudio.google.com/apikey) 의 API 키 목록

> 깃허브 토큰은 더 이상 필요 없습니다. 깃허브 백업은 깃허브 Actions가 자동으로 합니다(아래 "카드 데이터(DB) 백업과 복원" 참고).

> ⚠️ 이 파일은 외부에 절대 공유하지 마세요.

---

## 🚀 로컬 서버 실행

```bash
npm run dev
```

실행 후 브라우저에서 `http://localhost:5173` 접속 → 개발환경 오픈!

---

## 🔄 코드 수정 후 깃허브에 저장하는 방법

한 컴퓨터에서 코드를 수정한 뒤, 아래 명령어로 저장합니다.

```bash
git add .
git commit -m "간단한 변경 내용 설명"
git push origin main
```

---

## 📡 다른 컴퓨터에서 최신 코드 가져오기

이미 clone이 되어있는 컴퓨터에서 최신 코드를 가져올 때:

```bash
git pull origin main
```

---

## 📊 카드 데이터(DB) 백업과 복원

카드 데이터(파이어베이스 DB)는 깃허브 코드와 별개입니다.

- **백업(자동)**: 깃허브 Actions가 매일 새벽 3시쯤 카드 목록을 `database_backups/main_dataset.csv` 와 `backup_날짜_시간.csv` 로 저장합니다. 바뀐 카드가 없으면 건너뜁니다.
- **지금 바로 백업**: 깃허브 저장소 → **Actions** 탭 → 왼쪽 **Backup card database** → 오른쪽 **Run workflow** 버튼. (마스터 설정의 백업 버튼도 이 화면을 열어 줍니다.)
- **복원**: 앱의 **마스터 설정 → 🐙 깃허브 백업 & 복원 → [⬇️ 최신 백업 DB로 복원]** 버튼.

---

## 🖼️ 카드 썸네일(목록용 작은 이미지) 만들기

도감·필터·앨범 같은 목록 화면은 원본 대신 `public/thumbs/` 의 작은 WebP 썸네일(가로 300px, 장당 약 30KB)을 씁니다.
카드 상세 창은 계속 원본을 씁니다. 썸네일이 아직 없는 카드는 자동으로 원본을 보여주므로, 새 카드를 넣어도 화면이 깨지지는 않습니다(조금 느릴 뿐).

**새 카드를 추가한 뒤에는 아래 명령을 한 번 실행하세요.** 이미 있는 썸네일은 건너뛰고, 새 카드 것만 만듭니다.

```bash
npm run thumbs              # 최신 카드 목록(Firestore)을 읽어 빠진 썸네일만 생성
npm run thumbs -- --dry-run # 새로 만들 장수만 확인
npm run thumbs -- --prune   # 더 이상 쓰지 않는 썸네일 정리
```

만든 뒤 `public/thumbs` 를 커밋해서 main에 올리면 자동 배포로 사이트에 반영됩니다.
썸네일 파일 이름은 원본 이미지 주소로 정해집니다(`src/utils/thumbKey.js`). 그래서 카드의 이미지 주소를 바꾸면 새 썸네일이 필요합니다.

---

## 🧠 개발 흐름 요약

```
[이 컴퓨터에서 코드 수정]
       ↓ git push
  [GitHub (코드 보관소)]
       ↓ git pull
[다른 컴퓨터에서 이어서 수정]

[이 컴퓨터에서 DB 데이터 수정]
       ↓ 매일 자동 백업 (깃허브 Actions)
  [GitHub (database_backups/main_dataset.csv)]
       ↓ 마스터설정 → 깃허브 복원 버튼
[다른 컴퓨터에서 DB 복원]
```
