#!/usr/bin/env bash
# apply.sh — patch the Capacitor-generated android/ project with MELEK Move's native step counter.
# Run from apps/move/ AFTER `npx cap add android`. Idempotent. Used by .github/workflows/move-android.yml.
set -euo pipefail
cd "$(dirname "$0")/.."                       # -> apps/move
PKG_DIR="android/app/src/main/java/community/soapbox/move"
MANIFEST="android/app/src/main/AndroidManifest.xml"

echo "• copying native sources into $PKG_DIR"
mkdir -p "$PKG_DIR"
cp native/StepService.java "$PKG_DIR/StepService.java"
cp native/MainActivity.java "$PKG_DIR/MainActivity.java"

echo "• merging permissions + health service into $MANIFEST"
python3 - "$MANIFEST" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
# ensure the tools: namespace exists on <manifest> (needed for tools:node="remove" below)
if 'xmlns:tools' not in s:
    s = re.sub(r'(<manifest\b)', r'\1 xmlns:tools="http://schemas.android.com/tools"', s, count=1)
perms = [
    'android.permission.ACTIVITY_RECOGNITION',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_HEALTH',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.ACCESS_COARSE_LOCATION',
]
add = ''.join(f'    <uses-permission android:name="{x}" />\n' for x in perms if x not in s)
feat = '    <uses-feature android:name="android.hardware.sensor.stepcounter" android:required="false" />\n'
if 'sensor.stepcounter' not in s: add += feat
# explicitly REMOVE the advertising-ID permission so no merged-in SDK can re-add it — the app has no ads
# and declares "No" to advertising ID in Play. tools:node="remove" strips it from the merged manifest.
if 'com.google.android.gms.permission.AD_ID' not in s:
    add += '    <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />\n'
# insert permission/feature lines right after the opening <manifest ...> tag
if add:
    s = re.sub(r'(<manifest\b[^>]*>\s*\n)', r'\1' + add, s, count=1)
# register the health foreground service before </application>
if '.StepService' not in s:
    svc = ('        <service android:name=".StepService" android:exported="false" '
           'android:foregroundServiceType="health" />\n')
    s = s.replace('</application>', svc + '    </application>', 1)
open(p, 'w', encoding='utf-8').write(s)
print('  manifest patched')
PY
echo "• bumping compile/target SDK to 35 (Google Play target-API requirement, deadline 2026-08-31)"
# Google Play requires app UPDATES to target API level 35 (Android 15). Capacitor 6 generates
# android/variables.gradle defaulting to 34 → Play rejects updates. Patch it to 35 (idempotent).
# compileSdk must match; the AGP shipped with current @capacitor/android 6.2.x supports compileSdk 35.
VARS="android/variables.gradle"
if [ -f "$VARS" ]; then
  sed -i -E 's/(compileSdkVersion[[:space:]]*=[[:space:]]*)34/\135/; s/(targetSdkVersion[[:space:]]*=[[:space:]]*)34/\135/' "$VARS"
  echo "  variables.gradle now: $(grep -E 'compileSdkVersion|targetSdkVersion' "$VARS" | tr '\n' ' ')"
else
  echo "  ⚠ $VARS not found — run this AFTER 'npx cap add android'"
fi

echo "✓ apply.sh done"
