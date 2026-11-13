import crypto from "crypto";
import { env } from "../../env.js";
import { ApiError } from "./ApiError.js";

// Encrypts small secrets (people's saved API keys) before they go into the database, so a copy of the database alone
// doesn't reveal them. AES-256-GCM: the ciphertext can't be changed without the decryption failing.
// Stored as "v1.<iv>.<auth tag>.<ciphertext>" (each part base64). The "v1" leaves room to change the scheme later.

const secretKey = (): Buffer => {
    const raw = env.AI_KEY_ENCRYPTION_SECRET;
    if (!raw) throw new ApiError(503, "Saving keys isn't set up on the server yet.");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new ApiError(503, "The server's key-encryption secret is not valid.");
    return key;
};

export const encryptSecret = (plain: string): string => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
};

export const decryptSecret = (payload: string): string => {
    const [version, iv, tag, encrypted] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Unreadable saved secret");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
};
