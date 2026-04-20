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

프로젝트 폴더 최상단(`pokemon-card-app/`)에 `.env.local` 파일을 새로 만들고, 아래 내용을 그대로 복사해서 붙여넣습니다.

```
VITE_GEMINI_API_KEY="AIzaSyADoNdAGf77G9t2_HkJMihouRMEmK1iQ1E"
VITE_FIREBASE_API_KEY="AIzaSyACosiZlpImEYUK3ADg2rXcHmSkpY_V6n0"
VITE_FIREBASE_AUTH_DOMAIN="pokemoncard-0319.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="pokemoncard-0319"
VITE_FIREBASE_STORAGE_BUCKET="pokemoncard-0319.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="84068202860"
VITE_FIREBASE_APP_ID="1:84068202860:web:57173ee43d2a279ac11b49"
VITE_GITHUB_TOKEN="[깃허브에서 발급받은 Personal Access Token 입력]"
VITE_GITHUB_OWNER="bsw3013"
VITE_GITHUB_REPO="pokemon-card-app"
VITE_GITHUB_BACKUP_PATH="database_backups/main_dataset.csv"
```

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

## 📊 카드 데이터(DB) 복원 방법

카드 데이터(파이어베이스 DB)는 깃허브 코드와 별개입니다.
앱을 실행한 뒤 **마스터 설정 → 🐙 깃허브 백업 & 복원 → [⬇️ 깃허브에서 DB로 불러오기]** 버튼을 누르면 자동으로 복원됩니다.

---

## 🧠 개발 흐름 요약

```
[이 컴퓨터에서 코드 수정]
       ↓ git push
  [GitHub (코드 보관소)]
       ↓ git pull
[다른 컴퓨터에서 이어서 수정]

[이 컴퓨터에서 DB 데이터 수정]
       ↓ 마스터설정 → 깃허브 백업 버튼
  [GitHub (database_backups/main_dataset.csv)]
       ↓ 마스터설정 → 깃허브 복원 버튼
[다른 컴퓨터에서 DB 복원]
```
