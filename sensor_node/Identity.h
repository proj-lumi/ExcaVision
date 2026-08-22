#ifndef IDENTITY_H
#define IDENTITY_H

// Node identity: the ESP32's efuse MAC as a friendly "XX:XX:XX:XX:XX:XX"
// string. Stable and unique per board, read WITHOUT needing WiFi to connect
// (the hardware MAC is present regardless of role — master or slave).
//
// Every reading / baseline payload is conceptually tagged with this MAC; the
// backend joins on it to resolve node -> pipe -> site -> user. On the bench,
// the MAC is shown in the report header so the tagging is visible.

extern char nodeMac[18];   // e.g. "24:0A:C4:12:34:56"

void initIdentity();       // read the MAC once (call in setup), print it

#endif