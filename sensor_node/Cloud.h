#ifndef CLOUD_H
#define CLOUD_H

#include <Arduino.h>

// WiFi + HTTPS leg to Supabase. Only the gateway node uses this (it's the
// only box with WiFi); slaves stay WiFi-off.
//
// Auth: the node uses the SUPABASE_SECRET_KEY (server-side secret) for both
// the `apikey` and `Authorization` headers. This bypasses RLS — the node is
// trusted and only ever writes its own MAC-tagged data.

bool cloudConnectOnce();                               // one connect attempt (~15 s max); true when linked. Retryable.
void cloudStop();                                      // disconnect + mark not-connected (box stopped being the gateway)
bool cloudConnected();
bool cloudPostJson(const char* url, const String& jsonBody);  // true on 2xx
bool cloudGetJson(const char* url, String& out);              // true on 2xx, body in out

#endif
