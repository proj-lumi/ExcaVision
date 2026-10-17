#ifndef CLOUD_H
#define CLOUD_H

#include <Arduino.h>

// WiFi + HTTPS leg to Supabase. Only the gateway node uses this (it's the
// only box with WiFi); slaves stay WiFi-off.
//
// The Gateway waits for Admin to register its physical MAC as Node 1, then
// reports directly. No provisioning key is stored on the device.

bool cloudConnectOnce();                               // one WiFi + NTP + pinned-TLS setup attempt; retryable.
void cloudStop();                                      // disconnect + mark not-connected (box stopped being the gateway)
bool cloudConnected();
bool cloudPortalActive();                              // setup hotspot serving pages right now
void cloudForceReconnect();                            // recovery for a stalled socket (called from the main loop)
bool cloudPostJson(const char* url, const String& jsonBody);  // true on 2xx
bool cloudGetJson(const char* url, String& out);              // true on 2xx, body in out
// Same GET, but reports the HTTP status so setup can distinguish a missing
// Admin registration (404) from a temporary connectivity failure.
int  cloudGetJsonStatus(const char* url, String& out);

#endif
