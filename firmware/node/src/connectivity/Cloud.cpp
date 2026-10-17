#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "Cloud.h"
#include "GtsRootR4.h"
#include "Identity.h"
#include "PortalFonts.h"
#include "Rs485.h"
#include "Led.h"
#include "Environment.generated.h"

// Long-lived objects so the TLS session / connection can be reused across
// requests (cheaper than a fresh handshake every 5 s batch).
static WiFiClientSecure client;
static HTTPClient        http;
static WiFiManager       wifiManager;
static bool              connected = false;
static bool              clockReady = false;
static String            setupApName;
static bool              portalConfigured = false;
static String            setupInfoHtml;
static String            setupNotice;   // current registration/waiting status

// ── Setup portal skin ───────────────────────────────────────────────────────
// WiFiManager owns the routes, Wi-Fi scanning and form handling. Everything
// below only restyles that flow and adds the Wi-Fi QR paste helper. The portal
// has no internet access, so Inter is served by the device itself
// (PortalFonts.h) and the logo is inlined as an SVG data URI.
static const char EXCAVISION_PORTAL_HEAD[] = R"rawliteral(
<style>
  @font-face { font-family: Inter; font-style: normal; font-weight: 400 600; font-display: swap; src: url('/ev-font-400.woff2') format('woff2'); }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f7f9fb; color: #12161a; font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 15px; line-height: 1.5; }
  .wrap { display: block; width: 100%; max-width: 440px; margin: 0 auto; padding: 22px 16px 44px; text-align: left; }
  /* Brand block, matching the Landing header wordmark exactly: 36px mark,
     Inter 600 22px with -0.03em tracking, 10px gap. WiFiManager only renders its
     own h1/h3 on the menu page, which the portal no longer uses, so the brand is
     injected into whatever page is served (see the script at the end). */
  .ev-brand { display: flex; align-items: center; gap: 10px; margin: 0 0 18px; }
  .ev-brand .ev-mark { flex: 0 0 36px; width: 36px; height: 36px; background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><circle cx='256' cy='256' r='232' fill='%23F2994A' stroke='%2312161A' stroke-width='24'/><ellipse cx='256' cy='256' rx='143' ry='98' fill='%2312161A'/><circle cx='256' cy='256' r='45' fill='%23F7F5EF'/><path d='M128 128L384 384M384 128L128 384' fill='none' stroke='%23F7F5EF' stroke-width='36' stroke-linecap='round'/></svg>") center/contain no-repeat; }
  .ev-brand strong { display: block; font: 600 22px/1 Inter, Arial, sans-serif; letter-spacing: -0.03em; color: #12161a; }
  h1 { position: relative; margin: 0 0 4px; padding-left: 46px; min-height: 36px; font-size: 22px; font-weight: 600; line-height: 36px; }
  h1::before { content: ''; position: absolute; left: 0; top: 0; width: 34px; height: 34px; margin: 1px 0 0; background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'><circle cx='256' cy='256' r='232' fill='%23F2994A' stroke='%2312161A' stroke-width='24'/><ellipse cx='256' cy='256' rx='143' ry='98' fill='%2312161A'/><circle cx='256' cy='256' r='45' fill='%23F7F5EF'/><path d='M128 128L384 384M384 128L128 384' fill='none' stroke='%23F7F5EF' stroke-width='36' stroke-linecap='round'/></svg>") center/contain no-repeat; }
  h3 { margin: 0 0 20px; padding-left: 46px; color: #425466; font-size: 13px; font-weight: 400; }
  h2 { margin: 0 0 6px; font-size: 17px; font-weight: 600; }
  p { margin: 6px 0; color: #425466; font-size: 14px; }
  a { color: #b84b0d; font-weight: 600; text-decoration: none; }
  a:hover { text-decoration: underline; }
  form { margin: 14px 0 0; padding: 16px; background: #fff; border: 1px solid #d9e1e5; border-radius: 10px; }
  label { display: block; margin: 14px 0 6px; color: #425466; font-size: 13px; font-weight: 600; }
  label[for='showpass'] { display: inline; margin: 0 0 0 6px; font-weight: 400; }
  input, select, button { width: 100%; min-height: 44px; border-radius: 8px; font-family: inherit; font-size: 15px; }
  input, select { padding: 10px 12px; border: 1px solid #b8c5ca; background: #fff; color: #12161a; }
  input:focus, select:focus { outline: 2px solid #ff7a22; outline-offset: 1px; border-color: #ff7a22; }
  input[type='checkbox'] { width: auto; min-height: 0; padding: 0; }
  button, input[type='submit'] { margin-top: 12px; padding: 10px 16px; border: 0; background: #ff7a22; color: #fff; font-weight: 600; cursor: pointer; }
  button:hover, input[type='submit']:hover { background: #e96612; }
  button:active { opacity: .75; }
  .wrap > div:not([class]), .ev-scans > div { padding: 11px 13px; margin: 7px 0; background: #fff; border: 1px solid #d9e1e5; border-radius: 9px; }
  .wrap > div:not([class]) a, .ev-scans > div a { font-size: 15px; color: #12161a; }
  .ev-scans { display: block; }
  .ev-scans-label { margin: 0 0 6px 2px; color: #617579; font-size: 11px; font-weight: 600; }
  .q { float: right; color: #617579; font-size: 12px; }
  .ev-card { margin: 14px 0 0; padding: 16px; background: #fff; border: 1px solid #d9e1e5; border-radius: 10px; }
  .ev-kicker { margin-bottom: 6px; color: #ff7a22; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
  .ev-card h2 { font-size: 16px; }
  .ev-hint { color: #617579; font-size: 13px; }
  .ev-setup-code { margin: 10px 0 14px; padding: 12px; border: 1px solid #f2b27c; border-radius: 9px; background: #fff8f2; }
  .ev-setup-code > span, .ev-section-label { display: block; margin-bottom: 6px; color: #617579; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
  .ev-setup-code code { display: block; overflow-wrap: anywhere; color: #12161a; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.45; }
  .ev-setup-code .ev-copy { width: 100%; margin-top: 9px; border-color: #ff7a22; color: #b84b0d; }
  .ev-section-label { margin: 0; padding-bottom: 4px; }
  .ev-download { display: inline-block; margin-top: 8px; padding: 9px 12px; border-radius: 8px; background: #ff7a22; color: #fff; font-size: 13px; font-weight: 600; text-decoration: none; }
  .ev-download:hover { background: #e96612; text-decoration: none; }
  .ev-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 7px 0; border-top: 1px solid #eef2f4; }
  .ev-row:first-of-type { border-top: 0; }
  .ev-row span { color: #425466; font-size: 13px; }
  .ev-row code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; color: #12161a; }
  .ev-copy { width: auto; min-height: 30px; margin: 0; padding: 5px 9px; border: 1px solid #b8c5ca; background: #fff; color: #425466; font-size: 12px; }
  .ev-copy:hover { background: #f1f5f6; color: #12161a; }
  .ev-copy.copied { border-color: #2f9e68; color: #2f9e68; }
  .ev-row em { color: #617579; font-size: 13px; font-style: normal; }
  .ev-tag { display: inline-block; padding: 3px 8px; background: #fff1e6; color: #c95712; font-size: 11px; font-weight: 700; letter-spacing: .06em; }
  .ev-key-status { font-size: 13px; font-weight: 700; color: #2f9e68; }
  .ev-key-status.missing { color: #b42318; }
  .msg { margin: 14px 0; padding: 12px 14px; background: #fff; border: 1px solid #d9e1e5; border-left: 4px solid #ff7a22; border-radius: 8px; color: #425466; font-size: 14px; }
  .msg.S { border-left-color: #2f9e68; }
  .msg.D { border-left-color: #b42318; }
  hr { border: 0; border-top: 1px solid #d9e1e5; margin: 20px 0; }
  hr + br { display: none; }
  /* Desktops and laptops. One centred column, not two: the unit card is tall, so
     splitting the list beside it always left the shorter column half empty and
     the page looked broken. A centred sheet is what the content justifies. */
  @media (min-width: 900px) {
    body { padding: 40px 0 64px; }
    .wrap { max-width: 620px; padding: 0 24px 40px; }
    .ev-scans-label { margin-top: 0; }
  }
</style>
<script>
  // The brand belongs to every portal page, so it is inserted at the top of the
  // page container instead of relying on WiFiManager's menu markup.
  (function () {
    function addBrand() {
      var wrap = document.querySelector('.wrap');
      if (!wrap || wrap.querySelector('.ev-brand')) return;
      var brand = document.createElement('div');
      brand.className = 'ev-brand';
      brand.innerHTML = '<span class="ev-mark"></span><strong>ExcaVision</strong>';
      wrap.insertBefore(brand, wrap.firstChild);
    }
    function groupScans() {
      var wrap = document.querySelector('.wrap');
      if (!wrap || wrap.querySelector('.ev-scans')) return;
      var rows = wrap.querySelectorAll(':scope > div:not([class])');
      if (rows.length < 2) return;

      var group = document.createElement('div');
      group.className = 'ev-scans';
      // Labels the list on both viewports; the desktop panel styles it further.
      group.innerHTML = '<p class="ev-scans-label">Available networks</p>';
      rows[0].parentNode.insertBefore(group, rows[0]);
      Array.prototype.forEach.call(rows, function (row) { group.appendChild(row); });

      // One container for the column, so the desktop stylesheet has something
      // stable to target. On status pages (no form) nothing is grouped.
      var form = wrap.querySelector(':scope > form');
      if (!form) return;
      var panel = document.createElement('div');
      panel.className = 'ev-panel';
      group.parentNode.insertBefore(panel, group);
      panel.appendChild(group);
      panel.appendChild(form);
    }
    function wireCopyButtons() {
      var buttons = document.querySelectorAll('.ev-copy');
      Array.prototype.forEach.call(buttons, function (button) {
        if (button.dataset.copyBound === '1') return;
        button.dataset.copyBound = '1';
        button.addEventListener('click', function () {
          var value = button.getAttribute('data-copy') || '';
          var done = function () {
            var previous = button.textContent;
            button.textContent = 'Copied';
            button.classList.add('copied');
            setTimeout(function () {
              button.textContent = previous;
              button.classList.remove('copied');
            }, 1200);
          };
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(value).then(done);
            return;
          }
          var helper = document.createElement('textarea');
          helper.value = value;
          helper.setAttribute('readonly', '');
          helper.style.position = 'fixed';
          helper.style.opacity = '0';
          document.body.appendChild(helper);
          helper.select();
          try { document.execCommand('copy'); done(); } finally { document.body.removeChild(helper); }
        });
      });
    }
    function pollSetupInfo() {
      var card = document.querySelector('#ev-setup-info');
      if (!card || card.dataset.polling === '1') return;
      card.dataset.polling = '1';
      window.setInterval(function () {
        fetch('/ev-setup-info', { cache: 'no-store' })
          .then(function (response) { if (!response.ok) throw new Error('setup info unavailable'); return response.text(); })
          .then(function (html) {
            var wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            var next = wrapper.firstElementChild;
            var current = document.querySelector('#ev-setup-info');
            if (next && current) {
              current.replaceWith(next);
              next.dataset.polling = '1';
              wireCopyButtons();
            }
          })
          .catch(function () {});
      }, 2000);
    }
    function setup() { addBrand(); groupScans(); wireCopyButtons(); pollSetupInfo(); }
    if (document.readyState !== 'loading') setup();
    else document.addEventListener('DOMContentLoaded', setup);
  })();
</script>
)rawliteral";

// WiFiManagerParameter with an empty id renders getCustomHTML(), which lets the
// MAC list be rebuilt every time the portal opens (slaves are learned on the
// RS-485 bus after boot, so the list cannot be captured once at startup).
// Refresh the card on every page render, not once when the portal opens: RS-485
// discovery keeps running while the installer reads the page, and a snapshot
// taken at portal start showed "none on the bus yet" long after the slaves had
// answered.
static void refreshSetupInfo();

class SetupInfoParam : public WiFiManagerParameter {
 public:
  SetupInfoParam() : WiFiManagerParameter("") {}
  const char* getCustomHTML() const override {
    refreshSetupInfo();
    return setupInfoHtml.c_str();
  }
};
static SetupInfoParam setupInfoParam;

static int base64AlphabetValue(char character) {
  if (character >= 'A' && character <= 'Z') return character - 'A';
  if (character >= 'a' && character <= 'z') return character - 'a' + 26;
  if (character >= '0' && character <= '9') return character - '0' + 52;
  if (character == '+') return 62;
  if (character == '/') return 63;
  return -1;
}

// Serves one embedded webfont. The page must render without internet access,
// so the font travels with the firmware instead of coming from a CDN.
static void serveEmbeddedFont(const char* encoded, size_t encodedLength) {
  const size_t capacity = (encodedLength / 4) * 3;
  char* buffer = (char*)malloc(capacity ? capacity : 1);
  if (!buffer) {
    wifiManager.server->send(500, "text/plain", "font unavailable");
    return;
  }
  size_t written = 0;
  uint32_t accumulator = 0;
  uint8_t bits = 0;
  for (size_t i = 0; i < encodedLength; i++) {
    const int value = base64AlphabetValue(encoded[i]);
    if (value < 0) continue;              // padding and line breaks end the symbol
    accumulator = (accumulator << 6) | (uint8_t)value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      buffer[written++] = (char)((accumulator >> bits) & 0xFF);
    }
  }
  wifiManager.server->setContentLength(written);
  wifiManager.server->sendHeader("Cache-Control", "public, max-age=604800");
  wifiManager.server->send(200, "font/woff2", "");
  wifiManager.server->sendContent(buffer, written);
  free(buffer);
}

// Live commissioning card: environment, this Gateway's MAC, and every slave the
// Gateway has discovered on the RS-485 bus, so the installer can register the
// whole unit in Admin from one screen.
static void refreshSetupInfo() {
  const uint8_t slaveCount = rs485SlaveCount();
  String setupCode = String("EV1|G:") + String(nodeMac) + "|N:";
  for (uint8_t i = 0; i < slaveCount; i++) {
    if (i > 0) setupCode += ",";
    setupCode += rs485SlaveMac(i);
  }
  String html = String("<div id='ev-setup-info' class='ev-card'><h2>Setup</h2>")
    + "<div class='ev-setup-code'><span>Setup Code</span><code>" + setupCode + "</code><button type='button' class='ev-copy' data-copy='" + setupCode + "'>Copy Setup Code</button></div>"
    + "<span class='ev-section-label'>Individual nodes</span>"
    + "<div class='ev-row'><span>Node 1 <small class='ev-tag'>Gateway</small></span><code>" + String(nodeMac) + "</code><button type='button' class='ev-copy' data-copy='" + String(nodeMac) + "'>Copy</button></div>";
  for (uint8_t i = 0; i < slaveCount; i++) {
    html += "<div class='ev-row'><span>Node " + String(i + 2) + "</span><code>" + String(rs485SlaveMac(i)) + "</code><button type='button' class='ev-copy' data-copy='" + String(rs485SlaveMac(i)) + "'>Copy</button></div>";
  }
  if (slaveCount == 0) {
    html += "<div class='ev-row'><span>Sensor nodes</span><em>none found</em></div>";
  }
  html += "<p class='ev-hint'>Paste in Admin, then save Wi-Fi.</p>";
  html += "<p class='ev-hint'>2.4 GHz Wi-Fi only</p>";
  html += "<p class='ev-hint'>Portal: <strong>http://192.168.4.1</strong></p>";
  html += "<p class='ev-hint'>Cannot open? Turn off mobile data.</p>";
  if (setupNotice.length() > 0) {
    html += "<div class='msg D'>" + setupNotice + "</div>";
  }
  html += "</div>";
  setupInfoHtml = html;
}

// Every gateway exposes a stable, recognizable setup hotspot. The suffix is
// derived from the factory MAC, so manufactured units need no per-device
// firmware build and installers can match the AP to the serial label.
static String buildSetupApName() {
  String compactMac(nodeMac);
  compactMac.replace(":", "");
  String suffix = compactMac.substring(compactMac.length() - 6);
  return String("ExcaVision-Setup-") + suffix;
}

static void configureSetupPortal() {
  if (portalConfigured) return;

  refreshSetupInfo();
  wifiManager.addParameter(&setupInfoParam);
  // Non-blocking: WiFiManager's blocking loop only calls yield(), which in the
  // ESP32 core does not let the lower-priority idle task run. A quiet portal
  // therefore starved IDLE0 and tripped the task watchdog. We drive the portal
  // ourselves so every iteration can sleep.
  wifiManager.setConfigPortalBlocking(false);
  // "param" is deliberately absent: parameters then render inside the Wi-Fi
  // form, so commissioning is one page instead of a menu hunt. "restart" and
  // "exit" are gone too: the installer only ever needs the Wi-Fi form.
  const char* portalMenu[] = {"wifi"};
  wifiManager.setMenu(portalMenu, 1);
  wifiManager.setCustomHeadElement(EXCAVISION_PORTAL_HEAD);
  wifiManager.setTitle("ExcaVision Setup");
  wifiManager.setWebServerCallback([]() {
    // Land straight on the Wi-Fi form. WiFiManager's own menu page is still
    // registered afterwards, but the first matching handler wins, so this
    // catches every captive-portal probe that would have shown it.
    wifiManager.server->on("/", HTTP_GET, []() {
      wifiManager.server->sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/wifi", true);
      wifiManager.server->send(302, "text/plain", "");
    });
    wifiManager.server->on("/ev-font-400.woff2", HTTP_GET, []() {
      serveEmbeddedFont(PORTAL_FONT_INTER_400, sizeof(PORTAL_FONT_INTER_400) - 1);
    });
    wifiManager.server->on("/ev-setup-info", HTTP_GET, []() {
      refreshSetupInfo();
      wifiManager.server->sendHeader("Cache-Control", "no-store");
      wifiManager.server->send(200, "text/html", setupInfoHtml);
    });
    wifiManager.server->on("/ev-setup-packet", HTTP_GET, []() {
      String packet = String("{\"version\":1,\"gateway_mac\":\"") + String(nodeMac) + "\",\"node_macs\":[";
      for (uint8_t i = 0; i < rs485SlaveCount(); i++) {
        if (i > 0) packet += ",";
        packet += "\"";
        packet += rs485SlaveMac(i);
        packet += "\"";
      }
      packet += "]}";
      wifiManager.server->sendHeader("Content-Disposition", "attachment; filename=excavision-setup.json");
      wifiManager.server->send(200, "application/json", packet);
    });
  });
  wifiManager.setDebugOutput(false);
  portalConfigured = true;
}

void cloudStop() {
  // WiFiManager 2.0.17's stopConfigPortal() is not idempotent: when its server
  // pointer has already been cleared, a second call dereferences null. Runtime
  // Gateway-off and retry paths can both reach this function, so only stop an
  // actually active portal and only touch Wi-Fi while it is enabled.
  const bool portalActive = wifiManager.getConfigPortalActive();
  const bool wasActive = connected || clockReady ||
                         WiFi.getMode() != WIFI_OFF || portalActive;
  connected = false;
  clockReady = false;
  if (portalActive) wifiManager.stopConfigPortal();
  if (WiFi.getMode() != WIFI_OFF) {
    WiFi.disconnect();
    WiFi.mode(WIFI_OFF);
  }
  if (wasActive) Serial.println("[cloud] gateway off — WiFi/AP stopped");
}

// Synchronize the RTC before TLS certificate validation. A certificate can
// be valid on the calendar but appear invalid to an ESP32 whose clock is 1970.
static bool syncClock() {
  if (clockReady) return true;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");
  Serial.print("[cloud] synchronizing clock");
  unsigned long t0 = millis();
  time_t now = 0;
  while (now < 1700000000 && millis() - t0 < 10000) {
    delay(250);
    time(&now);
    Serial.print(".");
  }
  clockReady = (now >= 1700000000);
  Serial.println(clockReady ? " synchronized" : " FAILED");
  return clockReady;
}

// Returns the HTTP status of the Admin-registration check, or a negative
// HTTPClient error code when the request never completed.
static int validateRegistrationStatus() {
  String response;
  const String url = String(SUPABASE_URL) + "/functions/v1/node-telemetry/config?mac_address=" + String(nodeMac);
  return cloudGetJsonStatus(url.c_str(), response);
}

// Field diagnosis for the setup hotspot. When a phone cannot reach the portal,
// these lines separate the two failure modes: the phone never joined the
// hotspot, or it joined and never requested the page (Android preferring
// mobile data for a network with no internet).
static void logPortalStationEvents() {
  static bool registered = false;
  if (registered) return;
  registered = true;
  WiFi.onEvent([](arduino_event_id_t event, arduino_event_info_t info) {
    switch (event) {
      case ARDUINO_EVENT_WIFI_AP_STACONNECTED:
        Serial.println("[wifi] phone joined the setup hotspot");
        break;
      case ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED:
        Serial.print("[wifi] phone got IP ");
        Serial.println(IPAddress(info.wifi_ap_staipassigned.ip.addr));
        Serial.println("[wifi] if no page request follows, the phone is routing over mobile data");
        break;
      case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
        Serial.println("[wifi] phone left the setup hotspot");
        break;
      default:
        break;
    }
  });
}

// Drives the config portal until a station connection succeeds or the portal
// times out. The sleep is load-bearing: it guarantees IDLE0 runs, so the task
// watchdog can never fire while the installer is reading the page.
static bool driveConfigPortal() {
  if (!wifiManager.getConfigPortalActive()) return WiFi.status() == WL_CONNECTED;
  unsigned long lastReport = millis();
  while (wifiManager.getConfigPortalActive()) {
    // A Gateway toggle can happen while the installer is still viewing the
    // captive portal. Without this check, the portal loop keeps running and
    // the AP survives even after the role changes to sensor mode.
    if (!isThisGateway()) {
      // Return to cloudConnectOnce(), whose single cloudStop() call owns portal
      // shutdown. Stopping here as well caused a second stop on a null server.
      Serial.println("[wifi] Gateway mode disabled; closing setup hotspot");
      return false;
    }
    wifiManager.process();
    if (WiFi.status() == WL_CONNECTED) break;
    vTaskDelay(pdMS_TO_TICKS(20));
    if (millis() - lastReport >= 30000) {
      lastReport = millis();
      Serial.print("[wifi] portal open, connected stations: ");
      Serial.println(WiFi.softAPgetStationNum());
    }
  }
  return WiFi.status() == WL_CONNECTED;
}

// Connect with saved Wi-Fi credentials. If none work, WiFiManager opens the
// single setup portal. Once Wi-Fi is saved, the Gateway stays online and checks
// every retry whether Admin has registered its MAC as Node 1.
bool cloudConnectOnce() {
  configureSetupPortal();
  if (setupApName.length() == 0) setupApName = buildSetupApName();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  wifiManager.setConnectTimeout(15);
  wifiManager.setConfigPortalTimeout(600);
  wifiManager.setWiFiAutoReconnect(true);

  if (WiFi.status() != WL_CONNECTED) {
    refreshSetupInfo();
    logPortalStationEvents();
    Serial.println("[wifi] connecting with saved Wi-Fi or opening setup hotspot");
    Serial.print("[wifi] hotspot: "); Serial.println(setupApName);
    wifiManager.autoConnect(setupApName.c_str());
    if (!driveConfigPortal() || WiFi.status() != WL_CONNECTED) {
      connected = false;
      Serial.println("[wifi] setup timed out or connect failed; retrying in 10 s");
      cloudStop();
      return false;
    }
  }

  client.setCACert(GTS_ROOT_R4);
  connected = syncClock();
  if (!connected) return false;

  const int registrationStatus = validateRegistrationStatus();
  if (registrationStatus >= 200 && registrationStatus < 300) {
    setupNotice = "";
    Serial.println("[cloud] Gateway registered; reporting enabled");
    return true;
  }

  connected = false;
  if (registrationStatus == 404) {
    setupNotice = "Waiting for Admin to register this Setup Code. The Gateway will check again in 10 seconds.";
    Serial.println("[cloud] waiting for Admin registration");
  } else {
    setupNotice = String("Registration check failed (HTTP ") + registrationStatus + "). Retrying in 10 seconds.";
    Serial.println(setupNotice);
  }
  return false;
}

bool cloudConnected() { return connected; }

// True while the setup hotspot is serving pages. The sender uses this to skip
// its stall recovery: a portal session is legitimately "no progress".
// True while the setup hotspot is serving pages. The sender uses this to skip
// its stall recovery: a portal session is legitimately "no progress".
bool cloudPortalActive() { return wifiManager.getConfigPortalActive(); }

// Called from the main loop when the cloud task has made no progress for
// SENDER_STALL_MS. A blocking socket call inside that task cannot time out on
// its own, so the recovery has to come from outside it: drop the socket, drop
// the association, and let the task reconnect (and re-sync the clock).
void cloudForceReconnect() {
  client.stop();
  connected = false;
  clockReady = false;
  WiFi.disconnect();
  WiFi.reconnect();
  Serial.println("[cloud] link reset — reconnecting");
}

bool cloudPostJson(const char* url, const String& jsonBody) {
  if (!connected) return false;
  client.stop();   // reset stale TLS/socket state before each request (ESP32 reuse gotcha)
  client.setTimeout(5000);   // socket-level guard: a half-open peer must not block forever
  http.begin(client, url);
  http.setConnectTimeout(8000);
  http.setTimeout(10000);   // 10 s read timeout — the -11 timeouts were 5 s; hurts when the server is briefly slow
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-node-mac", nodeMac);
  int code = http.POST((uint8_t*)jsonBody.c_str(), jsonBody.length());  // explicit length — String POST can truncate large bodies
  bool ok = (code >= 200 && code < 300);
  if (!ok) {
    Serial.print("[cloud] POST http="); Serial.print(code);
    if (code < 0) { Serial.print(" "); Serial.print(http.errorToString(code)); }
    Serial.print(" resp="); Serial.println(http.getString());
  }
  http.end();
  return ok;
}

int cloudGetJsonStatus(const char* url, String& out) {
  if (!connected) return -1;
  client.stop();
  client.setTimeout(5000);
  http.begin(client, url);
  http.setConnectTimeout(8000);
  http.setTimeout(10000);   // 10 s read timeout (was 5 s)
  http.addHeader("x-node-mac", nodeMac);
  int code = http.GET();
  if (code >= 200 && code < 300) out = http.getString();
  else {
    Serial.print("[cloud] GET http="); Serial.print(code);
    if (code < 0) { Serial.print(" "); Serial.print(http.errorToString(code)); }
    Serial.println();
  }
  http.end();
  return code;
}

bool cloudGetJson(const char* url, String& out) {
  const int code = cloudGetJsonStatus(url, out);
  return code >= 200 && code < 300;
}
