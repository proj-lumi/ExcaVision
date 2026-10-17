export const MAC_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
export const PH_PHONE_PATTERN = /^09\d{9}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizedMac(value: string) {
  return value.trim().toUpperCase();
}

export function normalizedPhone(value: string) {
  return value.replace(/\D/g, "");
}

export function validName(value: string) {
  const length = value.trim().length;
  return length >= 1 && length <= 80;
}

export function validPhilippinesCoordinates(latitude: number, longitude: number) {
  return latitude >= 4.2 && latitude <= 21.5 && longitude >= 116.5 && longitude <= 127;
}
