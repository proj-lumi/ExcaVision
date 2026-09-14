# ExcaVision Node Firmware

Production ESP32 firmware built with PlatformIO.

```bash
pio run
pio run --target upload --upload-port /dev/ttyUSB0
pio device monitor --port /dev/ttyUSB0 --baud 115200
```

Copy `include/secrets.example.h` to `include/secrets.h` for local builds. Never commit `secrets.h`.
