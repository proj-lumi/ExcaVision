#ifndef RS485_H
#define RS485_H

// RS-485 half-duplex transport (feat/transport Phase A).
//
// Every node runs the same firmware; the role is decided by the gateway flag:
//   - MASTER (gateway): discovers slaves, polls each one, prints their readings.
//   - SLAVE: computes its own readings as usual, answers polls with a
//            MAC-tagged line of its latest per-sensor values.
//
// Frame format (ASCII lines, '\n' terminated):
//   master -> "D"                      discover: who is on the bus?
//   slave  -> "H:<mac>"                hello, I am <mac>
//   master -> "P:<mac>"                poll that specific node
//   slave  -> "R;<mac>;S<ch>:<tilt>,<g>,<T>,<n>,<fail>;S<ch>:...;..."
//   slave  -> "A;<mac>;<ch>;<kind>;<sev>;<value>"   spontaneous alert (relayed
//             by the master to the cloud)
//   slave  -> "B;<mac>;<ch>;<bx>,<by>,<bz>"   spontaneous baseline capture
//             (relayed by the master to the cloud)
//   master -> "C"                       broadcast: all nodes capture a baseline
//   master -> "T;<deg>"               broadcast: push the alert threshold to every slave
//
// All timing is non-blocking (millis()-driven), so the 100 Hz sensor loop,
// the report table, and the alarm keep running normally while on the bus.

void rs485Init();              // call once in setup(): configure DE pin + UART2
void rs485Update();            // call every loop(): receive lines + master poll schedule
void rs485SendAlert(uint8_t channel, float value);   // slave: relay a threshold trip to the master
void rs485SendBaseline(uint8_t channel, float bx, float by, float bz);  // slave: relay a captured baseline to the master
void rs485BroadcastCapture();   // gateway: tell every slave to start a baseline capture
void rs485BroadcastThreshold(float deg);  // gateway: push the pipe's alert threshold to every slave

#endif