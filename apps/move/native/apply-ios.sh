#!/usr/bin/env bash
# apply-ios.sh — patch the Capacitor-generated ios/ project with MELEK Move's iOS usage-description strings.
# Run from apps/move/ AFTER `npx cap add ios`. Idempotent. Used by codemagic.yaml.
#
# iOS REQUIRES these Info.plist keys or the app CRASHES the moment it asks for motion/location. The webview's
# DeviceMotion + Geolocation (foreground step counting + reward zone) work with just these strings — no
# native Swift needed for v1. The native CoreMotion/CMPedometer background counter (parity with the Android
# StepService) is the Phase-2 enhancement; see native/MainActivity.notes.md.
set -euo pipefail
cd "$(dirname "$0")/.."                       # -> apps/move
PLIST="ios/App/App/Info.plist"
[ -f "$PLIST" ] || { echo "✗ $PLIST not found — run 'npx cap add ios' first"; exit 1; }

echo "• adding usage descriptions to $PLIST"
python3 - "$PLIST" <<'PY'
import sys, plistlib
p = sys.argv[1]
with open(p, 'rb') as f:
    d = plistlib.load(f)
strings = {
    'NSMotionUsageDescription':
        'MELEK Move reads your step/motion count only to calculate your in-app fitness reward boost. '
        'Your activity is never sold or shared.',
    'NSLocationWhenInUseUsageDescription':
        'MELEK Move uses your approximate location only to derive the reward zone you claim. '
        'We store a coarse zone id, not a track of your movements.',
}
changed = False
for k, v in strings.items():
    if d.get(k) != v:
        d[k] = v; changed = True
if changed:
    with open(p, 'wb') as f:
        plistlib.dump(d, f)
    print('  Info.plist patched (Motion + Location usage strings)')
else:
    print('  Info.plist already current')
PY
echo "✓ apply-ios.sh done"
