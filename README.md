# HIT — KBO 야구 알림 앱

내 팀 경기가 시작하고, 점수가 나고, 끝나는 순간을 잠금화면으로 알려주는 iOS 앱.
경기 중에는 잠금화면과 다이내믹 아일랜드에 실시간 점수판이 뜹니다.

```
HIT/
├─ server/   알림 서버 (Node.js 22, 외부 라이브러리 없음)
├─ ios/      iOS 앱 + 위젯 확장 + 알림 서비스 확장 (SwiftUI, iOS 17.2+)
└─ tools/    서버 JSON ↔ Swift 모델 일치 검사
```

## 어떻게 동작하나

```
네이버 스포츠 KBO 데이터 ──(10초마다)──> HIT 서버 ──APNs──> 아이폰 (알림 · 라이브 액티비티)
                                        ↑   │
                                  기기 등록   └── /v1 API ──> 앱 화면 · 홈 화면 위젯
```

앱이 꺼져 있어도 알림이 오려면 경기를 지켜보는 서버가 있어야 합니다. 서버는 진행 중인 경기를 10초마다 확인합니다.
직전 상태와 비교해 바뀐 순간을 찾으면, 그 경기 팀을 응원하는 사람에게만 푸시를 보냅니다.

## 루타(Ruta) 기능과 비교

| 기능 | HIT |
|---|---|
| 내 팀 기준 경기 시작 · 득점 · 종료 알림 | ✅ 득점 알림은 "삼성 득점 / 삼성 실점"처럼 내 팀 기준 |
| 알림 종류 맞춤 설정 | ✅ 시작 10분 전, 선발 발표, 시작, 득점, 홈런, 역전·동점, 연장, 종료, 취소·중단 |
| 연장전 알림 | ✅ |
| 실시간 점수 · 이닝별 흐름 | ✅ 이닝별 점수(R·H·E·B), 문자중계, 타석별 승리 확률 흐름 그래프 |
| 투구 로케이션 · 구종 | ✅ 현재 타석 투구 위치·구종·구속 |
| 라인업 | ✅ 라인업 탭에 타순 표시. 경기 전에 타순이 나오면 **라인업 발표 알림** (네이버가 시작 무렵에야 주는 날은 알림 없음) |
| 오늘의 MVP 투표 | ✅ 끝난 경기의 중계 탭에서 수훈 선수 한 명 고르기 (승리 투수·양 팀 타순 중, 로그인한 사람 한 표, 다시 고를 수 있음), 상위 5명 집계 |
| 알림 눌러 바로 그 장면 | ✅ 득점·홈런·관심 선수 알림을 누르면 그 경기 중계 탭의 그 이닝 문자중계가 열림 |
| 연결 끊김 · 데이터 지연 안내 | ✅ 서버에 못 닿으면 "연결이 불안정해요 · 18:42 기준", 경기 중 네이버 데이터가 1분 넘게 멈추면 "N분 전 기준" 한 줄 |
| 관심 선수 알림 | ✅ 타자는 타석 결과마다, 투수는 등판·강판 때. 응원 팀과 상관없이 ★ 한 선수만 |
| 선수 검색 | ✅ 이름 일부, 초성(ㄱㄷㅇ → 김도영), 구단 이름(KIA) |
| 투수·타자 TOP20 | ✅ 기록 탭, WAR 순 (팀 순위 · 투수 TOP20 · 타자 TOP20) |
| 잠금화면 실시간 점수판 · 다이내믹 아일랜드 | ✅ 경기 시작 때 자동으로 뜸 (iOS 17.2+) |
| 홈 화면 위젯 | ✅ 내 팀 오늘 경기 |
| 가입·로그인 | ✅ Apple로 계속하기, 카카오로 계속하기, 로그인 없이 둘러보기. 응원 팀·알림 설정이 계정에 저장 |
| 구단 엠블럼 · 선수 사진 | ✅ 경기 카드·순위·위젯·잠금화면에 엠블럼. 선발·타자·투수·라인업·문자중계·검색·TOP20에 선수 사진, **잠금화면 알림에도 선수 사진** (홈런 친 선수, 관심 선수) |
| 애니메이션 | ✅ 카드 순차 등장, 점수 바뀔 때 숫자 튀기기, 홈런 때 "HOME RUN!" 꽃가루 연출, ★ 튀기기, 로그인 화면 등장. 아이폰 "동작 줄이기"를 켜면 꺼짐 |

알림 문구 예시는 올해 플레이오프 2차전을 재생한 실제 결과입니다:

```
선취점! KIA 1 : 0 삼성      삼성 실점 · 3회초 · 이호연 : 중견수 희생플라이 아웃
동점! KIA 1 : 1 삼성        삼성 득점 · 3회말 · 박승규 : 좌익선상 2루타
역전! KIA 1 : 2 삼성        삼성 득점 · 3회말 · 구자욱 : 중견수 앞 1루타
홈런! KIA 1 : 4 삼성        삼성 득점 · 3회말 · 디아즈 : 우중간 담장 넘어가는 홈런
경기 종료 · KIA 3 : 8 삼성  삼성 승리 · 승 후라도
```

---

## 준비물

- **Mac + Xcode 16 이상**: iOS 앱 빌드
- **Apple Developer Program 가입 (연 $99)**: 푸시 알림과 라이브 액티비티는 무료 계정으로는 안 됩니다
- **카카오 개발자 앱** (카카오 로그인을 쓸 때만): [developers.kakao.com](https://developers.kakao.com)
- **서버를 올릴 곳**: Docker를 돌릴 수 있는 곳이면 어디든 됩니다(Fly.io, Railway, Render, 집 서버 등). 실제 아이폰에서 쓰려면 **HTTPS 주소**가 필요합니다.

## 1. 서버를 먼저 돌려 보기 (내 컴퓨터)

```bash
cd server
npm test                 # 39개 테스트
npm run replay           # 재생 모드로 서버 실행 → http://localhost:8787
```

**재생 모드**는 2026 플레이오프 2차전(10.27 대구, KIA 3 : 8 삼성)을 지금 열리는 경기처럼 한 장면씩 다시 틉니다.
시작하고 3분 뒤 플레이볼, 15초마다 한 장면, 끝나면 처음부터 반복합니다. 비시즌에도 알림과 라이브 액티비티를 끝까지 시험해 볼 수 있습니다.
득점 장면과 이닝별 점수는 실제 기록이고, 그 사이의 아웃·주자 상황은 단순하게 채웠습니다.

실제 경기 데이터에 붙는지 확인:

```bash
npm run smoke            # 오늘·내일 경기와 순위를 네이버에서 받아 출력
```

APNs 키를 넣지 않으면 실제로 보내지 않고 "이 사람에게 이 알림을 보냈을 것"이라는 로그만 남깁니다(dry-run).

## 2. Apple Developer 설정

[developer.apple.com](https://developer.apple.com/account) → Certificates, Identifiers & Profiles

1. **Identifiers → App IDs**에 앱 번들 ID 등록 (예: `com.내이름.hit`). Capabilities에서 **Push Notifications**, **App Groups**, **Time Sensitive Notifications**를 켭니다.
2. **Identifiers → App Groups**에 `group.com.내이름.hit` 등록. 앱 ID 설정에서 이 그룹을 연결합니다.
3. **Keys → +**: **Apple Push Notifications service (APNs)**를 체크하고 키를 만듭니다. `.p8` 파일은 **한 번만 내려받을 수 있습니다.** 키 ID와 팀 ID(오른쪽 위 Membership)도 적어 둡니다.

### 로그인 설정

**Apple 로그인**: 위 App ID의 Capabilities에서 **Sign In with Apple**을 켭니다. 서버는 앱이 보낸 토큰을 Apple 공개키로 검증하고, 토큰의 대상이 `APPLE_CLIENT_ID`(비우면 `APNS_BUNDLE_ID`)와 같은지 확인합니다.

**카카오 로그인**: 카카오 SDK 없이 서버가 대신 진행합니다.
1. developers.kakao.com → 내 애플리케이션 → 앱 추가
2. 제품 설정 → 카카오 로그인 → 활성화. Redirect URI에 `https://내서버/v1/auth/kakao/callback` 등록
3. 동의항목에서 닉네임·프로필 사진 설정
4. 서버 `.env`에 `KAKAO_REST_API_KEY`(앱 키 → REST API 키), `PUBLIC_BASE_URL=https://내서버` 입력. 클라이언트 시크릿을 켰다면 `KAKAO_CLIENT_SECRET`도 넣습니다.

앱에는 "로그인 없이 둘러보기"도 있습니다. 계정 기능이 핵심이 아닌 앱에 로그인을 강제하면 App Store 심사에서 거절될 수 있어서입니다. 가입이 있는 앱은 앱 안에서 탈퇴할 수 있어야 해서 MY → 회원 탈퇴도 넣었습니다.

## 3. iOS 앱 빌드

```bash
brew install xcodegen
cd ios
```

`ios/project.yml` 위쪽의 세 값을 내 것으로 바꿉니다:

```yaml
APP_BUNDLE_ID: com.내이름.hit
APP_GROUP_ID: group.com.내이름.hit
HIT_API_BASE_URL: http://localhost:8787     # 실제 아이폰이면 배포한 https 서버 주소
```

```bash
xcodegen                 # HIT.xcodeproj 생성
open HIT.xcodeproj
```

Xcode에서 HIT, HITWidgets, HITNotificationService 세 타깃 모두 **Signing & Capabilities → Team**을 고르고 실행합니다. HITNotificationService는 푸시에 실린 선수 사진을 받아 알림에 붙이는 확장입니다.
알림과 라이브 액티비티는 **실제 아이폰**에서 확인하는 것을 권장합니다.
Xcode로 설치한 빌드는 샌드박스 APNs, TestFlight·App Store 빌드는 프로덕션 APNs를 씁니다. 서버가 기기별로 알아서 구분합니다.

## 4. 서버 배포

```bash
cd server
cp .env.example .env     # APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID 채우기
docker build -t hit-server .
docker run -d -p 8787:8787 -v hit-data:/data --env-file .env \
  -v $(pwd)/AuthKey_XXXX.p8:/app/AuthKey.p8:ro -e APNS_KEY_FILE=/app/AuthKey.p8 hit-server
```

- 저장소는 SQLite 파일 하나(`/data/hit.db`)입니다. 볼륨을 붙여야 재시작해도 구독이 남습니다.
- 앞단에 HTTPS를 붙이세요. 호스팅 서비스 대부분이 자동으로 해 줍니다.
- 서버는 한 대만 띄우세요. 여러 대면 같은 알림이 여러 번 갑니다.
- `curl https://내서버/health` → `{"ok":true,"provider":"naver","apns":"live"}` 이면 준비 끝.

배포 후 `project.yml`의 `HIT_API_BASE_URL`을 서버 주소로 바꾸고 다시 빌드합니다. 앱의 알림 탭 → 서버 칸에서 바꿀 수도 있습니다.

## 5. 알림이 오는지 확인

1. 앱 실행 → 응원 팀 선택 → 알림 허용
2. 서버 로그에 기기 등록이 보이는지 확인 (`PUT /v1/devices/...`)
3. 서버를 `HIT_PROVIDER=replay`로 잠깐 띄우고 KIA나 삼성을 응원 팀으로 고르면, 몇 분 안에 경기 시작 → 선취점 → 동점 → 역전… 알림이 옵니다. 잠금화면에는 실시간 점수판도 뜹니다.

---

## 디자인

검정 바탕 위에 강조색과 내 팀 색이 은은하게 번지는 배경(`AppBackground`), 그 위에 반투명 유리 카드. 화면 아래에 떠 있는 알약 탭바(고른 탭만 이름이 펼쳐짐), 머리의 원형 검색·알림 버튼, 알약 칩, 화면 끝까지 붙은 순위표에 구단 엠블럼. 강조색은 탠저린 오렌지(#FF8A4C)이고 앱 아이콘·실행 화면 로고도 같은 색입니다. `ios/Shared/Theme.swift`의 `Palette.accent` 한 줄과 `Assets.xcassets`의 `AccentColor`로 바꿀 수 있습니다.

**글라스.** 카드·알약·원형 버튼은 모두 `Components.swift`의 `glassCard()`, `glassCapsule()`, `glassCircle()`를 거칩니다. Xcode 26으로 빌드해 iOS 26에서 돌리면 애플의 Liquid Glass(`glassEffect`)가 쓰이고, 그보다 낮은 Xcode나 iOS에서는 `ultraThinMaterial`에 얇은 빛 테두리를 얹은 모양으로 대신합니다. 유리 느낌을 줄이거나 없애려면 이 세 함수만 고치면 됩니다.

**홈.** 맨 위에 날짜와 "오늘의 경기", "더보기 ›"(누르면 날짜 줄이 펼쳐짐)가 있습니다. 내 팀 경기는 팀 색 그라데이션 카드로 크게 보입니다. 카드에는 Live 표시, 큰 엠블럼, 이닝 알약, "5 VS 5" 점수, "실시간 중계 보기" 유리 버튼이 들어갑니다. 나머지 경기는 한 줄 카드로 이어집니다.

**다이나믹 아일랜드.** 접힌 상태에서는 양쪽에 엠블럼과 점수가 보이고, 앞선 팀 점수는 강조색입니다. 펼치면 양옆에 큰 엠블럼과 팀 이름, 가운데에 이닝 알약과 주자 다이아몬드, B·S·O가 나옵니다. 그 아래에는 방금 나온 장면 한 줄과 두 팀 색 띠가 붙습니다. 숫자는 바뀔 때 굴러가고, 테두리 색(keyline)은 앞선 팀 색을 따릅니다. 코드는 `ios/HITWidgets/GameLiveActivity.swift`에 있습니다. iOS는 HIT 앱을 연 동안에는 HIT의 아일랜드를 숨기고, 다른 앱이나 홈 화면에서만 보여 줍니다.

**이닝별 문자중계.** 중계 탭의 문자중계 위에 `1회 2회 3회…` 알약이 있습니다. 진행 중인 이닝에는 빨간 점이 붙고, 아무것도 안 누르면 지금 이닝을 따라갑니다. 진행 중인 이닝은 최신 줄이 위로 오고, 끝난 이닝은 처음부터 순서대로 보입니다. 지난 이닝은 `GET /v1/games/:id/relay?inning=N`으로 그 이닝 전체를 받아 옵니다(40줄 제한 없음). 끝난 이닝은 한 번 받으면 다시 받지 않습니다.

**직관 다이어리 (직관 탭).** 크보팬·풀카운트·오늘의 야구·승리지쿄 같은 앱의 핵심 기능을 참고했습니다.
- 본 경기를 직관(경기장)이나 집관(중계)으로 남기면, 좌석과 메모가 붙은 티켓이 쌓입니다.
- 내 팀 기준 승률이 큰 링으로 나오고, 직관과 집관이 따로 계산됩니다. 직관 연승·연패도 표시합니다.
- 구장별·상대별·요일별 승률도 볼 수 있습니다.
- 한 달 달력에서 내 팀 경기의 승·패·무, 아직 안 한 경기의 상대 엠블럼, 기록한 날의 티켓 표시를 봅니다. 날짜를 누르면 바로 기록합니다.
- 경기 화면 오른쪽 위의 "직관 기록"으로도 남길 수 있습니다.
- 기록은 로그인한 계정(서버)에 저장되고, 승패는 그날 일정에서 서버가 다시 계산합니다. 둘러보기 중에는 남길 수 없습니다.

**안타·볼넷 알림.** 풀카운트처럼 알림 설정에서 "안타", "볼넷·사구"를 켜면, 내 팀 타자가 칠 때마다(상대 팀 말고) 알림이 옵니다. 많이 오기 때문에 기본은 꺼져 있습니다.

## 서버 API

| | |
|---|---|
| `GET /v1/games?date=YYYY-MM-DD` | 그날 경기 목록 |
| `GET /v1/games/:id` | 경기 상세: 이닝별 점수, 상황, 문자중계, 라인업, 투구, 승리 확률 |
| `GET /v1/games/:id/relay?inning=N` | 그 이닝의 문자중계 전체 (`{ gameId, inning, plays }`) |
| `GET /v1/games/:id/mvp` · `PUT { team, name }` | 오늘의 MVP 후보·집계·내 표. 끝난 경기만, 투표는 로그인 필요, 다시 고르면 표가 옮겨 감 |
| `GET /v1/games/:id/winrate` | 타석별 홈팀 승리 확률 흐름 (`{ gameId, points: [{ inning, half, home }] }`, 그래프용) |
| `GET /v1/calendar?month=YYYY-MM&team=SS` | 한 달 경기 (달력, 네이버에 한 번만 요청) |
| `GET /v1/me/diary` | 내 직관 기록과 승률 (직관·집관, 구장·상대·요일별, 연승) |
| `PUT·DELETE /v1/me/diary/:gameId` | `{ date, mode: stadium\|home, seat, memo }` 직관 기록 남기기·지우기 |
| `GET /v1/standings?season=YYYY` | 팀 순위 |
| `PUT /v1/devices/:token` | `{ environment, teams, prefs }` 알림 구독 |
| `PUT /v1/devices/:token/start-token` | 라이브 액티비티 자동 시작(push-to-start) 토큰 |
| `POST /v1/live-activities` | `{ deviceToken, gameId, token, environment }` 라이브 액티비티 갱신 토큰 |
| `POST /v1/auth/apple` | `{ identityToken, name }` → `{ token, user }` |
| `GET /v1/auth/kakao/start` | 카카오 로그인 페이지로 이동, 끝나면 `hit://auth?token=…` |
| `GET·PUT·DELETE /v1/me` | 내 계정 조회, 닉네임·응원 팀·알림 설정 저장, 탈퇴 |
| `POST /v1/auth/logout` | 로그아웃 |
| `GET /v1/players?q=` | 선수 검색 (이름 일부·초성·구단) |
| `GET /v1/players/:id` | 선수 상세 (시즌 기록) |
| `GET /v1/leaders?type=pitcher\|hitter` | 투수·타자 TOP20 (WAR) |

## 검증한 것과 못 한 것

| | |
|---|---|
| ✅ 서버 테스트 44개 | 직관 다이어리(승패 판정, 직관·집관·구장·상대·요일별 승률, 연승, 로그인 필요, 탈퇴 시 삭제)·한 달 달력, 안타·볼넷 알림(그 팀 팬에게만, 투수 쪽 문구 제외), 이닝별 문자중계, 선수 검색(초성 포함)·TOP20, 관심 선수 알림(재생 경기 한 판: 타석 결과·등판·강판, 동명이인·알림 끔 제외), 데이터 정규화, 득점·홈런·역전·동점·연장·종료 감지, 알림 문구, APNs 서명(ES256)과 HTTP/2 전송, 재생 경기 한 판 전체, 재시작 후 중복 방지, API 입력 검증, Apple 토큰 검증(위조·만료·다른 앱 거절), 카카오 로그인 흐름, 계정 수정·로그아웃·탈퇴, 선수 사진 색인 |
| ✅ 서버 ↔ 앱 계약 | `python3 tools/check-contract.py`: 서버 JSON과 Swift 모델 33개 구조체(문자열 enum 값 포함)의 필드 이름·타입·필수 여부 대조 |
| ✅ Swift 문법 | 30개 파일 구문 분석 오류 없음 |
| ⚠️ Swift 컴파일 | Mac이 없는 환경에서 만들어 Xcode 빌드는 못 해 봤습니다. 처음 빌드할 때 경고나 사소한 오류가 나오면 고쳐야 할 수 있습니다. |
| ⚠️ 실제 네이버 응답 | 만든 환경에서 네이버가 막혀 있어서 공개 프로젝트에 문서화된 응답 형식으로 만든 테스트 데이터로 검증했습니다. 이닝별 문자중계는 네이버 `relay?inning=N`이 그 이닝을 돌려준다는 전제로 만들었고, 이것도 직접 확인하지는 못했습니다. 배포 전에 `npm run smoke`를 꼭 한 번 돌려 보세요. |
| ⚠️ 실제 APNs 전송 | Apple 키가 있어야 해서 로컬 HTTP/2 서버로 대신 검증했습니다. |
| ⚠️ 실제 Apple·카카오 로그인 | 만든 환경에서 두 서비스가 막혀 있어서, 직접 만든 서명 키와 가짜 카카오 서버로 흐름 전체를 검증했습니다. |
| ⚠️ 엠블럼·선수 사진 주소 | 공개 프로젝트(tickball)가 쓰는 네이버 주소 형식을 따랐고, 실제로 받아지는지는 확인하지 못했습니다. 못 받으면 앱은 구단 이름 배지와 이니셜로 대신 보여줍니다. |

## 데이터 출처 주의

경기 데이터는 네이버 스포츠의 **비공식** API(`api-gw.sports.naver.com`)에서 가져옵니다.
- 예고 없이 형식이 바뀔 수 있습니다. 필드 접근은 전부 `server/src/naver.js`에 모아 두었으니 거기만 고치면 됩니다.
- 서버는 경기당 10초보다 자주 묻지 않습니다. 앱 사용자가 몇 명이든 네이버로 가는 요청 수는 같습니다(서버가 캐시).
- **구단 엠블럼은 각 구단의 상표, 선수 사진은 구단·KBO·사진 제공사의 저작물입니다.** 앱은 이미지를 앱 안에 넣지 않고 실행할 때 네이버에서 불러옵니다. 그래도 App Store 심사에서 상표·저작권 문제로 거절될 수 있습니다.
- **App Store에 정식 출시하거나 돈을 벌 계획이라면** 공식 데이터 제공 계약이 필요합니다. KBO 기록 데이터는 별도 권리자가 있습니다. 개인 사용·지인 테스트(TestFlight) 단계에서는 문제가 적지만, 출시 전에는 꼭 확인하세요.

API 형식은 MIT 라이선스 오픈소스 [kbo-cli](https://github.com/jeonbyeongmin/kbo-cli)와 [tickball](https://github.com/leesh0829/tickball)의 문서를 참고했습니다.
