#include <Arduino.h>
#include <string.h>      // strcmp, strncmp, strtok
#include "Config.h"      // pins, constants, SENSORS[], nodes[]
#include "Identity.h"    // nodeMac
#include "Led.h"         // isThisGateway()
#include "Sender.h"      // senderAddReading() (Phase B)
#include "Baseline.h"    // startBaselineCapture() (global-capture broadcast 'C')
#include "Alarm.h"       // setThresholdDeg() (threshold relay 'T;')
#include "Rs485.h"

// ---------------------------------------------------------------------------
// Receive buffer + master state (internal).
// ---------------------------------------------------------------------------
static char     rxLine[RS485_MAX_LINE];
static uint16_t rxLen = 0;

// Master states: 0 = idle, 1 = discovering, 2 = polling
static uint8_t      rsState    = 0;
static unsigned long stateStart = 0;
static unsigned long lastPoll   = 0;
static uint8_t      pollIdx    = 0;                    // which known slave to poll next
static bool         gotReply   = false;                // did the current poll get a reply?
static char         slaves[RS485_MAX_SLAVES][18];      // learned slave MACs
static uint8_t      slaveCount = 0;

// ---------------------------------------------------------------------------
// Low-level half-duplex helpers
// ---------------------------------------------------------------------------

static bool startWith(const char* s, const char* pre) {
  return strncmp(s, pre, strlen(pre)) == 0;
}

// Transmit one line, then return to receive mode. Half-duplex: we must own
// the bus while transmitting, keep the driver engaged for a short turnaround
// so the last bits fully clear the transceiver/bus, and discard our own echo.
static void rs485Send(const char* line) {
  digitalWrite(RS485_DE_PIN, HIGH);   // transmit mode
  delayMicroseconds(50);              // let DE latch on the transceiver
  Serial2.print(line);
  Serial2.print('\n');
  Serial2.flush();                    // bytes are out of the UART FIFO
  delayMicroseconds(200);             // TX turnaround: let the tail clear the bus,
                                      // else the receiver cuts the last bits off
  digitalWrite(RS485_DE_PIN, LOW);    // back to receive mode
  while (Serial2.available()) Serial2.read();  // discard our own transmission echo
}

// ---------------------------------------------------------------------------
// Slave side: build and send the MAC-tagged latest readings.
// ---------------------------------------------------------------------------

static void sendReadings() {
  char line[RS485_MAX_LINE];
  uint16_t n = (uint16_t)snprintf(line, sizeof line, "R;%s", nodeMac);
  for (uint8_t i = 0; i < NUM_SENSORS; i++) {
    if (!nodes[i].present) continue;
    n += (uint16_t)snprintf(line + n, sizeof line - n,
                            ";%s@%u:%.3f,%.3f,%.1f,%lu,%lu",
                            SENSORS[i].name, SENSORS[i].channel,
                            nodes[i].lastTilt, nodes[i].lastMag, nodes[i].lastTemp,
                            (unsigned long)nodes[i].lastN,
                            (unsigned long)nodes[i].lastFail);
  }
  rs485Send(line);
}

// ---------------------------------------------------------------------------
// Master side: enqueue a slave's readings into the Sender (Phase B). The frame
// is "R;<mac>;S1@7:v,v,v,v,v;S2@3:..." — name for display, channel for the DB.
// ---------------------------------------------------------------------------

static void parseAndEnqueueReadings(const char* line) {
  const char* p = line + 2;           // skip "R;"
  char mac[18];
  size_t k = 0;
  while (*p && *p != ';' && k < sizeof mac - 1) mac[k++] = *p++;
  mac[k] = '\0';

  while (*p == ';') {
    p++;
    // "<name>@<channel>:<tilt>,<g>,<T>,<n>,<fail>"
    uint8_t ch = 0;
    const char* colon = strchr(p, ':');
    if (!colon) break;
    const char* at = strchr(p, '@');
    if (at && at < colon) ch = (uint8_t)atoi(at + 1);

    float tilt = 0, g = 0, T = 0;
    unsigned long n = 0, f = 0;
    sscanf(colon + 1, "%f,%f,%f,%lu,%lu", &tilt, &g, &T, &n, &f);

    senderAddReading(mac, ch, tilt, g, T, n, f, false);
    p = strchr(colon, ';');
    if (!p) break;
  }
}

// ---------------------------------------------------------------------------
// Master side: forward a spontaneous slave alert
// ("A;<mac>;<ch>;<kind>;<sev>;<value>") to the cloud. Called only on the gateway.
// ---------------------------------------------------------------------------

static void parseAndForwardAlert(const char* line) {
  const char* p = line + 2;   // skip "A;"

  char mac[18];
  size_t k = 0;
  while (*p && *p != ';' && k < sizeof mac - 1) mac[k++] = *p++;
  mac[k] = '\0';
  if (*p++ != ';') return;

  uint8_t channel = (uint8_t)atoi(p);
  p = strchr(p, ';');
  if (!p) return;
  p++;

  char kind[12];
  k = 0;
  while (*p && *p != ';' && k < sizeof kind - 1) kind[k++] = *p++;
  kind[k] = '\0';
  if (*p++ != ';') return;

  char sev[12];
  k = 0;
  while (*p && *p != ';' && k < sizeof sev - 1) sev[k++] = *p++;
  sev[k] = '\0';
  if (*p++ != ';') return;

  float value = atof(p);

  Serial.print("[rs485] slave alert "); Serial.print(mac);
  Serial.print(" ch"); Serial.print(channel);
  Serial.print(" "); Serial.print(kind);
  Serial.print(" "); Serial.print(sev);
  Serial.print(" v="); Serial.println(value, 3);

  senderPushAlert(mac, channel, kind, sev, value);
}

// ---------------------------------------------------------------------------
// Master side: forward a slave baseline capture
// ("B;<mac>;<ch>;<bx>,<by>,<bz>") to the cloud. Called only on the gateway.
// ---------------------------------------------------------------------------

static void parseAndForwardBaseline(const char* line) {
  const char* p = line + 2;   // skip "B;"

  char mac[18];
  size_t k = 0;
  while (*p && *p != ';' && k < sizeof mac - 1) mac[k++] = *p++;
  mac[k] = '\0';
  if (*p++ != ';') return;

  uint8_t channel = (uint8_t)atoi(p);
  p = strchr(p, ';');
  if (!p) return;
  p++;   // now at "<bx>,<by>,<bz>"

  float bx = 0, by = 0, bz = 0;
  sscanf(p, "%f,%f,%f", &bx, &by, &bz);

  Serial.print("[rs485] slave baseline "); Serial.print(mac);
  Serial.print(" ch"); Serial.print(channel);
  Serial.print("  bx="); Serial.print(bx, 4);
  Serial.print(" by="); Serial.print(by, 4);
  Serial.print(" bz="); Serial.println(bz, 4);

  senderUploadBaseline(mac, channel, bx, by, bz);
}

// ---------------------------------------------------------------------------
// Receive side: dispatch one complete line according to role.
// ---------------------------------------------------------------------------

static void handleLine() {
  const char* line = rxLine;

  if (isThisGateway()) {
    // Master: forward spontaneous slave alerts, capture hellos during
    // discovery, enqueue readings during a poll.
    if (startWith(line, "A;")) {
      parseAndForwardAlert(line);
    } else if (startWith(line, "B;")) {
      parseAndForwardBaseline(line);
    } else if (startWith(line, "H:") && rsState == 1) {
      if (slaveCount < RS485_MAX_SLAVES) {
        for (uint8_t i = 0; i < slaveCount; i++)
          if (strcmp(slaves[i], line + 2) == 0) return;   // already known
        strncpy(slaves[slaveCount], line + 2, sizeof slaves[0] - 1);
        slaves[slaveCount][sizeof slaves[0] - 1] = '\0';
        Serial.print("[rs485] discovered slave "); Serial.println(slaves[slaveCount]);
        slaveCount++;
      }
    } else if (startWith(line, "R;") && rsState == 2) {
      parseAndEnqueueReadings(line);
      gotReply = true;
    }
  } else {
    // Slave: answer the discovery broadcast, and polls addressed to us.
    if (strcmp(line, "D") == 0) {
      char h[24];
      snprintf(h, sizeof h, "H:%s", nodeMac);
      rs485Send(h);
    } else if (strcmp(line, "C") == 0) {
      // Global baseline capture (spec §7.4): a human action at the gateway
      // tells EVERY node to run its own BASELINE_COLLECT_SECONDS window.
      // When it ends, this node sends its B; frames so the master uploads it.
      startBaselineCapture();
    } else if (startWith(line, "T;")) {
      // Engineer-set alert threshold pushed from the gateway: apply to THIS
      // slave's local alarm immediately + persist to NVS (threshold relay).
      float t = (float)atof(line + 2);
      if (t > 0) setThresholdDeg(t);
    } else if (startWith(line, "P:")) {
      if (strcmp(line + 2, nodeMac) == 0) {
        sendReadings();
      } else {
        Serial.print("[rs485] poll for '"); Serial.print(line + 2);
        Serial.print("' vs me '"); Serial.print(nodeMac); Serial.println("'");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Master transmit schedule (non-blocking state machine).
// ---------------------------------------------------------------------------

static void masterTick() {
  unsigned long now = millis();

  switch (rsState) {
    case 0:  // idle
      if (slaveCount == 0) {
        rs485Send("D");                 // no slaves known yet -> discover
        rsState = 1;
        stateStart = now;
      } else if (now - lastPoll >= RS485_POLL_MS) {
        char poll[22];
        snprintf(poll, sizeof poll, "P:%s", slaves[pollIdx]);
        rs485Send(poll);
        gotReply = false;
        rsState = 2;
        stateStart = now;
        lastPoll = now;
      }
      break;

    case 1:  // discovering — wait for hellos
      if (now - stateStart >= RS485_DISCOVER_MS) rsState = 0;
      break;

    case 2:  // polling — wait for the slave's reply, then move on
      if (now - stateStart >= RS485_RESP_TIMEOUT_MS) {
        if (!gotReply) {
          Serial.print("[rs485] no reply from "); Serial.println(slaves[pollIdx]);
        }
        pollIdx = (pollIdx + 1) % slaveCount;
        rsState = 0;
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void rs485Init() {
  pinMode(RS485_DE_PIN, OUTPUT);
  digitalWrite(RS485_DE_PIN, LOW);     // start in receive mode
  Serial2.begin(RS485_BAUD, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
  rxLen = 0;
}

// Slave side: relay a threshold trip to the master, which forwards it to the
// cloud. One-line "A;<mac>;<channel>;threshold;critical;<value>" frame.
void rs485SendAlert(uint8_t channel, float value) {
  char line[80];
  snprintf(line, sizeof line, "A;%s;%u;threshold;critical;%.3f",
           nodeMac, channel, (double)value);
  rs485Send(line);
}

// Slave side: relay a freshly captured baseline to the master (which uploads
// it). One-line "B;<mac>;<channel>;<bx>,<by>,<bz>" frame.
void rs485SendBaseline(uint8_t channel, float bx, float by, float bz) {
  char line[80];
  snprintf(line, sizeof line, "B;%s;%u;%.4f,%.4f,%.4f",
           nodeMac, channel, (double)bx, (double)by, (double)bz);
  rs485Send(line);
}

// Gateway: broadcast the global-baseline-capture command to every slave.
// One-line "C", symmetric with the "D" discovery broadcast. Slaves start
// their own collection window on receipt; when it ends they send B; frames
// (built already) so the master uploads every node's baseline.
void rs485BroadcastCapture() {
  rs485Send("C");
}

// Gateway: push the pipe's engineer-set alert threshold to every slave so
// their LOCAL alarm stays in sync. One-line "T;<deg>". Master-initiated
// (like D/P), so no slave transmits while it's on the bus.
void rs485BroadcastThreshold(float deg) {
  char line[32];
  snprintf(line, sizeof line, "T;%.2f", (double)deg);
  rs485Send(line);
}

void rs485Update() {
  // If the gateway role changed since last loop, drop learned slaves so a
  // toggled-on master re-discovers (and a toggled-off one stops carrying
  // stale addresses).
  static bool lastGateway = false;
  bool gw = isThisGateway();
  if (gw != lastGateway) {
    slaveCount = 0;
    rsState    = 0;
    lastPoll   = 0;
    gotReply   = false;
  }
  lastGateway = gw;

  // Receive: accumulate bytes until a complete '\n'-terminated line.
  while (Serial2.available() > 0) {
    char c = Serial2.read();
    if (c == '\n') {
      rxLine[rxLen] = '\0';
      handleLine();
      rxLen = 0;
    } else if (c != '\r' && rxLen < sizeof rxLine - 1) {
      rxLine[rxLen++] = c;
    }
  }

  // Only the gateway schedules polls; slaves only ever respond.
  if (isThisGateway()) masterTick();
}