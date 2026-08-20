#include <Wire.h>

#define MPU_ADDR 0x68

int16_t read16(byte reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);

  Wire.requestFrom(MPU_ADDR, (byte)2);

  if (Wire.available() >= 2) {
    int16_t high = Wire.read();
    int16_t low = Wire.read();

    return (high << 8) | low;
  }

  return 0;
}

void setup() {
  Serial.begin(115200);

  // ESP32 I2C
  // SDA = GPIO 21
  // SCL = GPIO 22
  Wire.begin(21, 22);

  delay(100);

  // Wake up MPU6050
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission();

  Serial.println("MPU6050 initialized!");
}

void loop() {

  // Read raw accelerometer data
  int16_t ax = read16(0x3B);
  int16_t ay = read16(0x3D);
  int16_t az = read16(0x3F);

  // Convert raw values to 0-255
  byte X = constrain(map(ax, -17000, 17000, 0, 255), 0, 255);
  byte Y = constrain(map(ay, -17000, 17000, 0, 255), 0, 255);
  byte Z = constrain(map(az, -17000, 17000, 0, 255), 0, 255);

  Serial.print("Axis X = ");
  Serial.print(X);

  Serial.print("  ");

  Serial.print("Axis Y = ");
  Serial.print(Y);

  Serial.print("  ");

  Serial.print("Axis Z = ");
  Serial.println(Z);

  delay(500);
}
