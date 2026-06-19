package community.soapbox.move;

// StepService — MELEK Move background step counter (ToS-compliant: see .local/MOVE_TOS_COMPLIANCE.md).
//
// A `health` foreground service that reads the OS hardware step counter (TYPE_STEP_COUNTER) so steps keep
// counting with the screen off / app backgrounded — the one thing the web app can't do. It pushes the
// running total to the WebView via window.MelekSteps' callback (the page in site/move-miner/server.mjs
// feature-detects window.MelekSteps.start). It does NO mining, NO network, and never sells/shares data.
//
// Wiring: MainActivity (1) shows the in-app prominent disclosure, (2) requests ACTIVITY_RECOGNITION,
// (3) on grant, startForegroundService(this) and exposes window.MelekSteps via a JS bridge that forwards
// the latest count. See MainActivity.notes.md. This file is the build-kit reference implementation;
// finalize the bridge call (evaluateJavascript) to your MainActivity's WebView when the SDK is present.

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;

public class StepService extends Service implements SensorEventListener {
    private static final String CHANNEL = "melek_move_steps";
    private SensorManager sensorManager;
    private Sensor stepCounter;
    private float baseline = -1f;          // TYPE_STEP_COUNTER is cumulative since boot; subtract a baseline
    private int sessionSteps = 0;

    public static int latestSteps = 0;     // MainActivity's JS bridge reads this to feed window.MelekSteps

    @Override
    public void onCreate() {
        super.onCreate();
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) stepCounter = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(1, buildNotification());
        if (stepCounter != null) sensorManager.registerListener(this, stepCounter, SensorManager.SENSOR_DELAY_NORMAL);
        return START_STICKY;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_STEP_COUNTER) return;
        float total = event.values[0];
        if (baseline < 0f) baseline = total;
        sessionSteps = (int) (total - baseline);
        latestSteps = sessionSteps;        // MainActivity polls/pushes this into window.MelekSteps' callback
    }

    @Override public void onAccuracyChanged(Sensor s, int a) {}

    @Override
    public void onDestroy() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "MELEK Move steps", NotificationManager.IMPORTANCE_LOW));
            }
        }
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle("MELEK Move").setContentText("Counting your steps").setOngoing(true)
                .setSmallIcon(android.R.drawable.ic_menu_compass).build();
    }
}
