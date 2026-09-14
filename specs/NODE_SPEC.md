# Sensor Node Spec

Every ESP32 runs the same firmware. A physical long press selects which node
is the gateway.

Physical wiring lives in [PHYSICAL_BUILD_SPEC.md](./PHYSICAL_BUILD_SPEC.md).

## Fixed hardware map

| Function | Setting |
|---|---|
| I²C SDA / SCL | GPIO 21 / 22, 100 kHz |
| TCA9548A | address `0x70` |
| Sensors S1–S4 | channels `7, 3, 5, 1` |
| Button / LED / buzzer | GPIO 16 / 23 / 17 |
| RS-485 DI / RO / DE+RE | GPIO 33 / 34 / 32 |
| MPU address | `0x68` |

GPIO34 is input-only and has no internal pull-up. Firmware disables the UART
RX pull-up before starting Serial2.

> Current bench firmware intentionally enables only `S1` on TCA channel 5 for
> loose-sensor testing. Before deployment, replace the bench table with the
> production map: `S1=7`, `S2=3`, `S3=5`, `S4=1`.

## Runtime behavior

- Sample each present MPU at 100 Hz.
- Report one averaged reading per second: MAC, channel, tilt, `|g|`,
  temperature, sample count, and failures.
- Compute tilt from the angle between the current and baseline gravity vectors.
- Fire the local buzzer only after tilt stays above the pipe threshold for
  3 seconds; clear with 0.5° hysteresis.
- The gateway batches readings to Supabase every 5 seconds. Network work runs
  outside the sampling loop.

## Baseline and controls

- Baseline capture lasts **30 seconds**.
- Save every baseline to RAM, NVS, and Supabase; never delete old cloud data.
- On boot: load NVS first. Use cloud recovery only when NVS is empty.
- A new baseline starts a new monitoring period.

| Action | Result |
|---|---|
| Short press or serial `z` | Capture baseline; gateway broadcasts it globally |
| Hold ≥3 s or serial `g` | Toggle gateway role and save it in NVS |
| Serial `r` | Reboot |

LED: off=no baseline, blinking=busy, solid=monitoring, heartbeat=gateway.

## Master/slave transport

- Slaves keep WiFi off and send data over half-duplex RS-485.
- Gateway polls slaves, relays thresholds and baselines, and posts to Supabase.
- Every relayed record keeps the originating node MAC and sensor channel.

| Frame | Meaning |
|---|---|
| `D` / `H:<mac>` | discovery / hello |
| `P:<mac>` / `R;...` | poll / readings |
| `A;...` | slave alert |
| `B;...` | slave baseline upload |
| `C` | global baseline capture |
| `T;<deg>` | threshold update |
| `F;<mac>` / `Q;...` | baseline recovery request/reply |

Spontaneous `A` and `B` frames can collide with a poll. The local buzzer is
independent of this accepted prototype limitation.

## Identity and manufacturing

- ESP32 factory MAC is the hardware identity.
- ExcaVision registers every unit's MAC and serial number in Supabase before
  sale. Customers never type or scan individual MAC addresses.
- Before handoff, the producer registers each node, assigns it to the
  customer's site, and may place it into a deployment pipe with a position and
  gateway role.
- The producer deploys each node before delivery; its `sensor_nodes`, MAC, and
  four sensor rows already exist when the customer receives it.
- The customer does not register, claim, scan, select, or position nodes.

## Gateway WiFi setup

Only the gateway enables WiFi. It first tries credentials already saved in NVS.
If none work, it opens:

```text
SSID: ExcaVision-Setup-XXXXXX
Portal: http://192.168.4.1
```

`XXXXXX` is the final six hexadecimal characters of the registered MAC, without
colons. The app derives and displays this SSID from the selected gateway record.

The installer connects a phone to that AP and submits the site WiFi credentials
through the captive portal. Credentials remain local on the ESP32; they do not
pass through the app or Supabase. The portal times out after five minutes and
reopens on the next retry. Slaves never need WiFi setup.

The gateway uses the Supabase device secret, polls the pipe threshold about
every 15 seconds, broadcasts it to slaves, and caches it in NVS. Its MAC must
already belong to the assigned customer/site; an unknown gateway is not
auto-enrolled.

## Firmware layout

```text
firmware/node/include/              public headers, Config.h, local secrets
firmware/node/src/main.cpp          setup and main loop
firmware/node/src/connectivity/     WiFi, Supabase, and RS-485
firmware/node/src/hardware/         button, LED, and alarm
firmware/node/src/sensing/          MPU6050, baseline, and reports
firmware/node/src/system/           device identity
```

## PlatformIO build

Run production firmware commands from `firmware/node/`:

```bash
cd firmware/node
pio run
```

Upload and monitor:

```bash
pio run --target upload --upload-port /dev/ttyUSB0
pio device monitor --port /dev/ttyUSB0 --baud 115200
```

Copy `firmware/node/include/secrets.example.h` to
`firmware/node/include/secrets.h` before building. WiFi credentials do not
belong in that file.

For clangd/Neovim, regenerate the ignored `compile_commands.json` after changing
PlatformIO dependencies or build flags:

```bash
cd firmware/node
pio run --target compiledb
```

At boot, every installed channel must print `present`. After baseline capture,
resting tilt should remain near zero and read failures should remain near zero.
