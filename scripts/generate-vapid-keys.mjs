import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateJwk = privateKey.export({ format: "jwk" });
const publicJwk = publicKey.export({ format: "jwk" });
const base64Url = (value) => Buffer.from(value).toString("base64url");
const publicPoint = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, "base64url"),
  Buffer.from(publicJwk.y, "base64url"),
]);

console.log(`VAPID_PUBLIC_KEY=${base64Url(publicPoint)}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
