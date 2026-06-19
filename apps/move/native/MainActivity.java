package community.soapbox.move;

// MainActivity — MELEK Move Android shell. Capacitor BridgeActivity loading move.melek.salon, plus:
//  • a JS bridge exposing MelekStepsNative.latest() (the running step total from StepService),
//  • the window.MelekSteps.start(cb) shim the web page (site/move-miner/server.mjs) feature-detects,
//  • the ACTIVITY_RECOGNITION permission request + start of the `health` foreground StepService.
// No mining, no keys, no network here. apply.sh overwrites the cap-generated MainActivity with this.
//
// ToS note: the in-app prominent disclosure lives in the web step card (always visible). For strict
// prominent-disclosure timing, gate requestStepPerms() behind the user's "Start counting" tap before
// submission (see apps/move/LAUNCH_CHECKLIST.md).

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // expose the native step total to the WebView
        bridge.getWebView().addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface public int latest() { return StepService.latestSteps; }
        }, "MelekStepsNative");
        requestStepPerms();
    }

    private void requestStepPerms() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            String[] perms = (Build.VERSION.SDK_INT >= 33)
                ? new String[]{ Manifest.permission.ACTIVITY_RECOGNITION, Manifest.permission.POST_NOTIFICATIONS }
                : new String[]{ Manifest.permission.ACTIVITY_RECOGNITION };
            boolean need = false;
            for (String p : perms) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) need = true;
            if (need) { requestPermissions(perms, 1001); return; }
        }
        startStepService();
    }

    @Override
    public void onRequestPermissionsResult(int rc, String[] p, int[] g) {
        super.onRequestPermissionsResult(rc, p, g);
        if (rc == 1001) startStepService();   // service no-ops if the sensor/permission is absent
    }

    private void startStepService() {
        Intent i = new Intent(this, StepService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i); else startService(i);
        // inject window.MelekSteps so the web page reads the OS pedometer (polls the native total every 2s)
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
            "window.MelekSteps={start:function(cb){setInterval(function(){try{cb(MelekStepsNative.latest());}catch(e){}},2000);}};", null));
    }
}
