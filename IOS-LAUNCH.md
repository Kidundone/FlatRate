# FR Buddy — iOS Launch Checklist

**App name:** FR Buddy | **Bundle ID:** `dev.nellylabs.flatrate` | **Capacitor:** v8

## Prerequisites
- Mac with Xcode 15+ installed (free from App Store)
- Apple ID signed in to Xcode → Settings → Accounts
  - Free account: sideload to your own phone (re-sign every 7 days)
  - Paid account ($99/yr at developer.apple.com): keep it installed + submit to App Store
- iPhone plugged in via USB and trusted on your Mac

---

## 1. Sync the latest build into the iOS project
```bash
cd ~/flat-rate-log
npm run cap:ios
```
This runs `node build.mjs`, syncs web assets into `ios/`, and opens Xcode automatically.

---

## 3. In Xcode

### Signing
1. Click the top-level **App** project in the left sidebar
2. Select the **App** target → **Signing & Capabilities** tab
3. Check **Automatically manage signing**
4. Set **Team** to your Apple Developer account
5. Bundle Identifier: `dev.nellylabs.flatrate` (already set)

### App icons
- Open `ios/App/App/Assets.xcassets/AppIcon.appiconset`
- Replace placeholder icons with your actual icon at required sizes
- Minimum: 1024×1024 PNG for App Store, plus 180×180 for iPhone

### Permissions (verify in Info.plist)
Xcode should add these automatically, but confirm they exist:
- `NSCameraUsageDescription` → "Used to scan pay stubs"
- `NSPhotoLibraryUsageDescription` → "Used to scan pay stubs from your photo library"

---

## 4. Trust the cert and run on your iPhone
1. Connect iPhone via USB, select it in the Xcode toolbar (top left)
2. Press **⌘R** to build and install (~2 min first time)
3. If you see "Untrusted Developer" on your phone:
   - iPhone → **Settings → General → VPN & Device Management**
   - Tap your Apple ID → **Trust** → confirm
4. Re-open FR Buddy — it runs normally from here on

### Enable notifications
Go to **More → Notifications** in the app and tap Allow when prompted.

---

## 5. Archive for App Store
1. Xcode menu → **Product → Archive**
2. When complete, **Distribute App → App Store Connect**
3. Follow the upload wizard

---

## 6. App Store Connect (appstoreconnect.apple.com)
1. **My Apps → +** → New App
   - Platform: iOS
   - Name: FR Buddy
   - Bundle ID: `dev.nellylabs.flatrate`
   - SKU: `flatrate-buddy-1`
2. Category: **Productivity**
3. Add screenshots (minimum: iPhone 6.5" and 5.5")
4. Description tip: "Log flat-rate hours job by job, track your weekly earnings, and catch short pay before payday. Works offline on the shop floor."
5. Set price, submit for review (Apple takes 1–3 days)

---

## 7. After every code update
```bash
cd ~/flat-rate-log
npm run cap:ios   # build + sync + open Xcode
```
Then archive and upload the new version.

---

## Quick reference
| Command | What it does |
|---|---|
| `node build.mjs` | Build JS/CSS for GitHub Pages only |
| `npm run cap:sync` | Build + sync to iOS (no Xcode) |
| `npm run cap:ios` | Build + sync + open Xcode |
