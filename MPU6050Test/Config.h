#ifndef CONFIG_H
#define CONFIG_H

// Set to 1 to see heap usage + I2C failure details, 0 for clean logs
#define DEBUG_MODE 0

#define MPU_ADDR 0x68
#define SDA_PIN 21
#define SCL_PIN 22

const unsigned long SEND_INTERVAL_MS = 60000; // 1 minute
const unsigned long LOOP_DELAY_MS = 500;

#endif
