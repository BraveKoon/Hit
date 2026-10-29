# TestFlight 올리기

GitHub Actions(macOS)가 빌드해서 App Store Connect에 올립니다. 빌드 번호는 실행 번호로 자동 증가합니다.

## 한 번만 준비

1. **Apple Developer Program** 가입(연 $99).
2. developer.apple.com → Identifiers 에서 App ID 3개 등록 (`APP_BUNDLE_ID` 기준)
   - `com.내이름.hit` — Push Notifications, Sign in with Apple, App Groups, Time Sensitive Notifications
   - `com.내이름.hit.widgets` — App Groups
   - `com.내이름.hit.notification-service` — App Groups
   - App Group `group.com.내이름.hit` 도 등록해 세 ID에 연결.
3. App Store Connect → 앱 → **새 앱**: 번들 ID는 위 메인 ID.
4. App Store Connect → 사용자 및 액세스 → 통합 → **App Store Connect API 키** 생성(권한 *앱 관리* 이상). `.p8` 은 한 번만 내려받을 수 있습니다.
5. GitHub 저장소 → Settings → Secrets and variables → Actions
   - **Variables**: `APP_BUNDLE_ID`, `APP_GROUP_ID`, `DEVELOPMENT_TEAM`(10자리 Team ID), `HIT_API_BASE_URL`(배포한 서버 https 주소)
   - **Secrets**: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` (`base64 -i AuthKey_XXXX.p8 | pbcopy`)
6. 서버의 `APNS_BUNDLE_ID` 는 `APP_BUNDLE_ID` 와 같아야 합니다.

## 올리기

Actions 탭 → **TestFlight** → Run workflow. 끝나고 몇 분 뒤 App Store Connect → TestFlight 에 빌드가 나타납니다. 내부 테스터는 바로, 외부 테스터는 베타 심사 후 초대할 수 있습니다.

## 알아 둘 점

- 이 프로젝트는 아직 Xcode 빌드를 한 번도 하지 않았습니다. 첫 실행은 컴파일 오류로 실패할 수 있으니 로그를 보내 주시면 고칩니다.
- 업로드 서명 때 푸시 환경은 자동으로 production 으로 바뀝니다.
- 경기 데이터·엠블럼·사진 이용 권한은 외부 테스터에게 배포하기 전에 확인하세요 (README "데이터 출처 주의").
