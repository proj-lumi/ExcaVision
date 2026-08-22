#ifndef REPORT_H
#define REPORT_H

#include <Arduino.h>
#include "Config.h"      // SensorNode, nodes[]

// The per-second table. printReportHeader() draws the 3-line header;
// formatSensorBlock() fills one sensor's cell and resets its 1 s window.

void printReportHeader();                 // the 3-line header (names / labels / separator)
void formatSensorBlock(char* buf, uint8_t i);  // fill sensor i's cell; reset its window

#endif
