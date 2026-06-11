# iOS Launch Checklist — Flat-Rate Tracker

## Prerequisites
- Xcode 15+ installed (free from App Store)
- Apple Developer account ($99/yr — https://developer.apple.com/account)
- Homebrew + Node 18+ installed

---

## Step 1 — Install Capacitor (run once)

```bash
cd ~/flat-rate-log
npm install @capacitor/core @capacitor/cli @capacitor/ios \
            @capacitor/haptics @capacitor/local-notifications \
            @capacitor/push-notifications
```

## Step 2 — Initialize Capacitor (run once)

```bash
npx cap init "Flat-Rate Tracker" "dev.nellylabs.flatrate" --web-dir www
```
> If it asks to overwrite capacitor.config.json — say **No** (your config is already there).

## Step 3 — Build the web app + add iOS platform (run once)

```bash
node build.mjs
npx cap add ios
```

This creates an `ios/` folder with a full Xcode project.

## Step 4 — Open in Xcode

```bash
npx cap open ios
```

Or use the shortcut: `npm run cap:ios`

## Step 5 — In Xcode

1. Select the **App** target → **Signing & Capabilities**
2. Set **Team** to your Apple Developer account
3. Confirm **Bundle Identifier** = `dev.nellylabs.flatrate`
4. Add **Push Notifications** capability (+ Capability button)
5. Add **Background Modes** → check **Remote notifications**

## Step 6 — Test on your phone

1. Plug in your iPhone via USB
2. Select your device in the Xcode device picker
3. Press **▶ Run** (Cmd+R)
4. Trust the developer cert on the phone: Settings → General → VPN & Device Management

## Step 7 — Every time you update the web app

```bash
npm run cap:sync
```

This rebuilds + syncs changes to the Xcode project without reopening Xcode.

---

## App Store submission (when ready)

1. Xcode → Product → Archive
2. Distribute App → App Store Connect → Upload
3. Go to https://appstoreconnect.apple.com → fill out metadata, screenshots
4. Submit for review (~24–48hrs)

---

## Notes on Haptics

- On native iOS, the app uses `UIImpactFeedbackGenerator` via `@capacitor/haptics` — real taptic engine feedback, no `navigator.vibrate` needed.
- On the web, `navigator.vibrate` is used as fallback (works on Android Chrome, not Safari).

## Notes on Notifications

- On native iOS, the app uses `@capacitor/local-notifications` to schedule the shift reminder at the exact time you set in Settings.
- The first time the app runs, it will prompt for notification permission.
- No backend/APNs setup needed for local notifications — they're entirely on-device.
