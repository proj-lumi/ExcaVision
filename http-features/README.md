# http-features/ — staged for the future `feat/http` branch

Parked here so the `feat/sensor` branch can focus on accurate MPU6050 readings
without the send-to-database noise.

## Contents

- `WiFiManager.h/.cpp`     - ESP32 WiFi connect (uses `secrets.h`)
- `SupabaseClient.h/.cpp`  - HTTPS POST of readings to Supabase (uses `secrets.h`, `Config.h`)
- `SendScheduler.h/.cpp`   - rate-limits sends (uses `SupabaseClient.h`, `Config.h`)
- `secrets.h`              - WiFi SSID/password + Supabase URL/key (keep out of git!)

## How to restore (on the `feat/http` branch)

    mv http-features/*.h http-features/*.cpp MPU6050Test/

Then re-add these to `MPU6050Test/MPU6050Test.ino`:

    #include "WiFiManager.h"
    #include "SupabaseClient.h"
    #include "SendScheduler.h"

    // in setup():  connectToWiFi();
    // in loop():   sendReadingIfDue(reading);

Notes:
- The files are Arduino sketch fragments; they expect `Config.h` and `secrets.h`
  to sit in the same sketch folder as them.
- `secrets.h` contains credentials - never commit it.