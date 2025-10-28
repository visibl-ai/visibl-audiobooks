# <a href="https://visibl.ai"><img src="https://imagedelivery.net/tQttKO0JZXPihTOH_rMepA/e2f040dd-3dda-408b-e767-b5c02ed1ec00/thumb" alt="Visibl" width="32" height="32" style="vertical-align: middle;"> Visibl iOS Client</a>

<p align="center">
  <strong>Native iOS app for transforming audiobooks into visual narratives</strong>
</p>

<p align="center">
  <a href="https://testflight.apple.com/join/B3P1abHk">
    <img src="https://img.shields.io/badge/TestFlight-Beta-blue?style=flat-square&logo=apple" alt="TestFlight Beta">
  </a>
  <a href="https://github.com/visibl-ai/visibl-audiobooks/blob/master/LICENCE.md">
    <img src="https://img.shields.io/badge/License-Apache%202.0-yellow?style=flat-square" alt="Apache 2.0">
  </a>
  <a href="../README.md">
    <img src="https://img.shields.io/badge/Docs-Main%20README-green?style=flat-square" alt="Main README">
  </a>
</p>

---

## Prerequisites

- **Xcode**: 15.0 or later
- **iOS Deployment Target**: iOS 16.0+
- **Developer Accounts**:
  - Apple Developer account (for device testing)
  - Firebase project with iOS app configured
- **macOS**: Ventura 13.0 or later recommended

---

## Setup Instructions

### 1. Firebase Configuration

#### Obtain GoogleService-Info.plist

1. Go to the [Firebase Console](https://console.firebase.google.com)
2. Select your project (or create a new one)
3. Click on the iOS app or add a new iOS app with bundle ID
4. Download `GoogleService-Info.plist` from Project Settings → Your iOS App
5. Place the file in the root of the `visibl-swift` directory:
   ```
   visibl-swift/
   ├── GoogleService-Info.plist  <- Place here
   ├── visibl/
   ├── visibl.xcodeproj
   └── ...
   ```

> **Important**: This file contains your Firebase configuration and is gitignored for security. Never commit this file to version control.

### 2. Build Configuration

#### Create Debug.xcconfig

1. Navigate to `visibl/BuildConfig/`
2. Copy `Template.xcconfig` to create `Debug.xcconfig`:
   ```bash
   cd visibl/BuildConfig/
   cp Template.xcconfig Debug.xcconfig
   ```

3. Edit `Debug.xcconfig` and replace all `replace.me` placeholder values with your actual configuration values from Firebase Console and Apple Developer Portal.

#### Where to Find Key Values:

- **DEVELOPMENT_TEAM**: Apple Developer Portal → Membership → Team ID
- **APP_GID_CLIENT_ID**: GoogleService-Info.plist → CLIENT_ID
- **APP_CF_BUNDLE_URL_SCHEMES**: GoogleService-Info.plist → REVERSED_CLIENT_ID
- **APP_RTDB_URL**: Firebase Console → Realtime Database → Data tab (shows URL at top, use WITHOUT https://)
- **APP_CLOUD_FUNC_REGION**: Firebase Console → Functions → Dashboard (shows region)

#### Create Release.xcconfig (Optional)

For release builds, create `Release.xcconfig` with production values:
```bash
cp Template.xcconfig Release.xcconfig
# Edit with production values, use distribution signing
```

### 3. Xcode Setup

1. Open the project in Xcode:
   ```bash
   open visibl.xcodeproj
   ```

2. Drag and drop `GoogleService-Info.plist` into the Xcode project navigator (onto the `visibl` folder)

3. Verify build configuration:
   - Confirm Debug configuration uses `Debug.xcconfig`
   - Confirm Release configuration uses `Release.xcconfig` (if created)

4. Configure signing:
   - Select the `visibl` target
   - Go to "Signing & Capabilities"
   - Enable "Automatically manage signing" for development
   - Select your team

---

## Building and Running

### Build for Simulator

1. Select a simulator from the device menu (iPhone 14 Pro recommended)
2. Press `Cmd+R` or click the Run button
3. Wait for the app to build and launch

### Build for Device

1. Connect your iPhone via USB or configure for wireless debugging
2. Select your device from the device menu
3. Ensure your device is registered in your developer account
4. Press `Cmd+R` to build and run

---

## Testing

### Running Unit Tests

#### Via Xcode

1. Open the project in Xcode
2. Press `Cmd+U` or Product → Test
3. View results in the Test Navigator (`Cmd+6`)

#### Via Command Line

```bash
# Run all unit tests
xcodebuild test -project visibl.xcodeproj \
                -scheme visibl \
                -destination 'platform=iOS Simulator,name=iPhone 14' \
                -testPlan visibl

# Run specific test class
xcodebuild test -project visibl.xcodeproj \
                -scheme visibl \
                -destination 'platform=iOS Simulator,name=iPhone 14' \
                -only-testing:visiblTests/MockAuthServiceTests
```

### Running UI Tests

The UI tests verify core user workflows including audiobook management and playback.

#### Available Test Scenarios

1. **testAudiobookAddFromCatalogue**: Tests adding an audiobook from the store
2. **testAudiobookPlayPause**: Tests playback controls and player functionality

#### Via Xcode

1. Select the `visiblUITests` scheme
2. Press `Cmd+U` to run UI tests
3. Watch the simulator perform automated interactions

#### Via Command Line

```bash
# Run all UI tests
xcodebuild test -project visibl.xcodeproj \
                -scheme visibl \
                -destination 'platform=iOS Simulator,name=iPhone 14' \
                -testPlan visibl \
                -only-testing:visiblUITests

# Run specific UI test
xcodebuild test -project visibl.xcodeproj \
                -scheme visibl \
                -destination 'platform=iOS Simulator,name=iPhone 14' \
                -only-testing:visiblUITests/visiblUITests/testAudiobookAddFromCatalogue
```

### Test Environment

The app includes a special test mode activated with the `--uitesting` command line argument:

- **Purpose**: Sets up mock data and disables system prompts for automated testing
- **Activation**: Automatically enabled when running UI tests
- **Test Ready Indicator**: The app displays a "TestReadyIndicator" element when test setup is complete
- **Mock Data**: Automatically configures test user account and sample audiobooks

### Test Plan

The project uses `visibl.xctestplan` which:
- Runs unit tests in parallel for faster execution
- Runs UI tests sequentially
- Automatically passes `--uitesting` argument to the app
- Can be customized for different test configurations

---

## Firebase Services

The app integrates multiple Firebase services:

- **Authentication**: Email/password, Google Sign-In, Apple Sign-In, anonymous auth
- **Realtime Database**: Syncs user library and reading progress
- **Cloud Functions**: Server-side processing and API endpoints
- **Cloud Storage**: Audiobook files and generated images
- **Remote Config**: Feature flags and configuration updates
- **Cloud Messaging**: Push notifications for updates
- **App Check**: Security and anti-abuse protection

---

## Contributing

PRs and recommendations welcome! Please submit via [GitHub](https://github.com/visibl-ai/visibl-audiobooks).

---

<p align="center">
  <a href="https://testflight.apple.com/join/B3P1abHk">Download TestFlight</a> •
  <a href="https://visibl.ai">Website</a> •
  <a href="../README.md">Main README</a>
</p>