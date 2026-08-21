// sensor_node - MINIMAL raw MPU6050 reader (feat/sensor start point)
// Goal: get raw readings on the serial monitor, then observe what's missing
// or wrong before adding any filtering / mapping / networking.

#include <Wire.h>
#include <math.h>

#define MPU_ADDR 0x68

// Read one 16-bit big-endian register. Returns false if the transaction or
// the read fails, so a failure is distinguishable from a real 0 reading.
static bool read16(byte reg, int16_t &out) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  Wire.requestFrom(MPU_ADDR, (byte)2);
  if (Wire.available() < 2) return false;

  int16_t high = Wire.read();
  int16_t low = Wire.read();
  out = (high << 8) | low;
  return true;
}

void setup() {
  Serial.begin(115200);

  // ESP32 I2C: SDA = GPIO 21, SCL = GPIO 22 (default wiring on this board)
  Wire.begin(21, 22);

  delay(100);

  // Wake up the MPU6050 (clear SLEEP bit in PWR_MGMT_1)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  Serial.println("MPU6050 initialized!");
}

void loop() {
  int16_t ax, ay, az;

  if (!(read16(0x3B, ax) && read16(0x3D, ay) && read16(0x3F, az))) {
    Serial.println("--- I2C FAIL ---");
    delay(500);
    return;
  }

  // Raw counts. At rest, total magnitude |g| should be ~16384 counts for the
  // default +/-2 g range (1 g = 16384 counts) and stable within noise.
  float mag = sqrtf((float)ax * ax + (float)ay * ay + (float)az * az);

  Serial.print("AX: "); Serial.print(ax);
  Serial.print("  AY: "); Serial.print(ay);
  Serial.print("  AZ: "); Serial.print(az);
  Serial.print("  |g|: "); Serial.println(mag, 1);

  delay(500);
}