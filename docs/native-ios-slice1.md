# Right Hand Native iOS Slice 1

Slice 1 proves only the native wrapper link:

- Capacitor launches a native iOS shell.
- The shell loads the deployed Kerf web app in `WKWebView`.
- Crew auth works inside that webview.
- The session cookie persists after closing and reopening the app.

RoomPlan/LiDAR is intentionally not part of Slice 1. Slice 2 owns the native `RoomCaptureView` plugin.

## Running

```bash
npm install
npm run native:sync
npm run native:open
```

The default remote app URL is `https://kerf-v17-internal.fly.dev`.
Override it before syncing if needed:

```bash
KERF_NATIVE_SERVER_URL=https://example.internal npm run native:sync
```

## Device Proof Checklist

1. Open the Xcode workspace at `ios/App/App.xcworkspace`.
2. Select Christian's Apple Developer team and a unique bundle id if `com.ggrvalle.kerf.righthand` is unavailable.
3. Build onto a real iPhone.
4. Log into Right Hand with the crew/owner credentials used for the deployed web app.
5. Force-close and reopen the app.
6. Confirm the session persists and the app still resolves the correct tenant/role.

## Known Slice 1 Risks

- `WKWebView` may not behave like Safari for the current HTTP Basic-auth deployment gate. If Basic auth does not prompt cleanly, stop and add a small native auth-challenge bridge instead of weakening web auth.
- The native shell uses the live deployed app. It is not an offline/static bundle.
- Full Xcode is required. Command Line Tools alone are not enough for iOS builds.

## Founder Dependencies

- Apple Developer Program / App Store Connect access.
- Full Xcode installed and selected with `xcode-select`.
- Signing team, bundle id, certificates, and provisioning.
- Real iPhone for Slice 1 auth proof; LiDAR-capable iPhone Pro/iPad Pro for Slice 2.
