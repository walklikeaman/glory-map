# GloryMap for iPhone

A native iOS app (Capacitor 8) that opens the live GloryMap site
(`https://glory-map.vercel.app`) inside a native shell. Every
merge to `main` reaches the app on its next launch; no rebuild is needed for web
changes. Rebuild only when something in this folder changes.

It lives in its own folder with its own `package.json`, so the web build, the
tests and Vercel never see it.

## What the native shell adds

- An app icon and a dark launch screen on the home screen.
- iOS permission prompts for the camera ("Recreate this shot"), location (pins
  near you, the walk), photos (upload a shot) and microphone.
- An offline page (`www/index.html`) with a retry button when there is no network.

## One command: build and install from the Mac mini

On a Mac where Xcode is already signed in to the Apple ID (the Mac mini), and the
iPhone is paired by cable or Wi-Fi:

```bash
cd mobile && npm run iphone
```

It pulls main, syncs Capacitor, builds with automatic signing (team `NM3FPYR56P`),
installs on "Oz iPhone Pro" and launches the app. No Xcode window, no prompts.
Override with `DEVICE_NAME`, `DEVICE_ID`, `TEAM_ID`. Run it at least once every 7
days: a free Apple ID's signing expires after a week. Note: on the MacBook Pro with
Xcode 27, the terminal build did not see the GUI sign-in ("No Accounts").

## Put it on your iPhone (free, with a Mac)

You need a Mac with Xcode (free from the App Store) and your Apple ID. No paid
developer account is needed; the app then has to be re-installed from Xcode
every 7 days.

```bash
cd mobile
npm install
npx cap sync ios
npx cap open ios        # opens Xcode
```

In Xcode:

1. Plug in the iPhone with a cable, unlock it, tap "Trust".
2. Select the **App** target → **Signing & Capabilities** → Team: your Apple ID
   (Add Account… if it is not there). If Xcode says the bundle id is taken,
   change `com.walklikeaman.glorymap` to anything unique.
3. Pick the iPhone at the top of the window and press ▶ (Run).
4. On the iPhone, the first time: Settings → General → VPN & Device Management →
   your Apple ID → Trust. On iOS 16+ also turn on Settings → Privacy & Security →
   Developer Mode and restart the phone.

## TestFlight (later)

With a paid Apple Developer account ($99/yr): Product → Archive in Xcode, then
Distribute → App Store Connect → TestFlight. The app then installs from the
TestFlight app and lasts 90 days per build.

## Known limits

- Google/Facebook sign-in is blocked by Google inside embedded web views, and
  the email link opens in Safari, so signing in does not carry into the app yet.
  Fixing it needs a native auth plugin (ASWebAuthenticationSession) and a
  custom URL scheme. Browsing, the map, routes and the camera work without it.
- No offline map: the web app's service worker does not run inside the app.
