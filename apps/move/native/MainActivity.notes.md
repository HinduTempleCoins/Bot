# Wiring MainActivity → window.MelekSteps (build-time, after `cap add android`)

The web page (`site/move-miner/server.mjs`) feature-detects `window.MelekSteps.start(cb)` and, when
present, takes steps from the device sensor instead of the in-page accelerometer. The Android shell
fulfills that contract. Do this in the generated `MainActivity.java`:

## 1. Prominent disclosure + permission (ToS-required order)
Before requesting `ACTIVITY_RECOGNITION`, show the in-app disclosure (the step card already states it; you
may also show a one-time dialog). Then request the runtime permission:
```java
if (checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
    requestPermissions(new String[]{ Manifest.permission.ACTIVITY_RECOGNITION,
                                     Manifest.permission.POST_NOTIFICATIONS }, 1001);
}
```

## 2. Start the foreground health service on grant
```java
startForegroundService(new Intent(this, StepService.class));
```

## 3. Expose window.MelekSteps to the WebView (JS bridge)
Capacitor's WebView is a standard `WebView`. Add a JS interface and push the latest count:
```java
bridge.getWebView().addJavascriptInterface(new Object() {
    @android.webkit.JavascriptInterface public int latest() { return StepService.latestSteps; }
}, "MelekStepsNative");
```
Then inject the JS shim that the page expects (run once after page load):
```java
bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
    "window.MelekSteps={start:function(cb){setInterval(function(){try{cb(MelekStepsNative.latest());}catch(e){}},2000);}};", null));
```
That gives the page a `window.MelekSteps.start(cb)` that polls the native step total every 2s and feeds
`setSteps(n)`. (A push/event version is fine too; polling is simplest and battery-cheap at 2s.)

## Notes
- `StepService.latestSteps` is the session step count (cumulative-since-boot minus a baseline taken on
  first reading) — see `StepService.java`.
- No network, no keys, no mining in any of this — the service only reads the pedometer and forwards a number.
- iOS later: replace this bridge with a CMPedometer plugin exposing the same `window.MelekSteps.start(cb)`.
