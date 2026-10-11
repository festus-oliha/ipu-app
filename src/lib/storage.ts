import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SetupError } from "./config";

/**
 * Private file storage for receipts and proofs (System Design §7: files are
 * never public; the app checks who is asking and then streams the file).
 *
 * - Live (Netlify): a private Supabase Storage bucket, reached with the
 *   service-role key from .env. The bucket is created on first use.
 * - On your computer, if those two settings are empty: the ".uploads" folder.
 */
const BUCKET = "ipu-files";
const LOCAL_DIR = path.join(process.cwd(), ".uploads");

export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const FILE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;
export type FileType = keyof typeof FILE_TYPES;

/** The real type from the file's first bytes (the browser's label can't be trusted). */
export function sniffType(bytes: Uint8Array): FileType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function supabase() {
  // Only the site part is used (https://xxxx.supabase.co), even if the
  // "/rest/v1" API address was pasted instead.
  const raw = process.env.SUPABASE_URL?.trim();
  let url: string | undefined;
  try {
    url = raw ? new URL(raw).origin : undefined;
  } catch {
    throw new SetupError(`SUPABASE_URL is not a web address (it should look like https://xxxx.supabase.co).`);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // New Supabase secret keys (sb_secret_…) go only in the apikey header; legacy service_role JWTs also as Bearer.
  if (url && key) {
    const headers: Record<string, string> = key.startsWith("sb_") ? { apikey: key } : { Authorization: `Bearer ${key}`, apikey: key };
    return { url, headers };
  }
  // On Netlify the disk is read-only, so the local folder cannot be used there.
  const onNetlify = Boolean(process.env.NETLIFY || process.env.SITE_ID || process.env.NETLIFY_IMAGES_CDN_DOMAIN || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (process.env.NODE_ENV === "production" && onNetlify) {
    throw new SetupError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed to store receipts.");
  }
  return null;
}

async function createBucket(sb: NonNullable<ReturnType<typeof supabase>>) {
  const res = await fetch(`${sb.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...sb.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_FILE_BYTES }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (!/already exists|Duplicate/i.test(body)) throw new Error(`could not create the "${BUCKET}" storage bucket (${res.status}): ${body}`);
  }
}

export async function putFile(key: string, bytes: Uint8Array, type: FileType) {
  const sb = supabase();
  if (!sb) {
    const file = path.join(LOCAL_DIR, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return;
  }
  const upload = () =>
    fetch(`${sb.url}/storage/v1/object/${BUCKET}/${key}`, {
      method: "POST",
      headers: { ...sb.headers, "Content-Type": type, "x-upsert": "false" },
      body: Buffer.from(bytes),
    });
  let res = await upload();
  if (res.status === 404 || res.status === 400) {
    const body = await res.text();
    if (/bucket/i.test(body)) {
      await createBucket(sb);
      res = await upload();
    } else {
      throw new Error(`File storage refused the upload: ${body}`);
    }
  }
  if (!res.ok) throw new Error(`File storage refused the upload (${res.status}): ${await res.text()}`);
}

export async function getFile(key: string): Promise<{ bytes: Uint8Array; type: FileType } | null> {
  const sb = supabase();
  let bytes: Uint8Array;
  if (!sb) {
    try {
      bytes = new Uint8Array(await readFile(path.join(LOCAL_DIR, key)));
    } catch {
      return null;
    }
  } else {
    const res = await fetch(`${sb.url}/storage/v1/object/authenticated/${BUCKET}/${key}`, { headers: sb.headers, cache: "no-store" });
    if (!res.ok) return null;
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const type = sniffType(bytes);
  return type ? { bytes, type } : null;
}

/** Reads and checks an uploaded file from a form. */
export async function readUpload(value: FormDataEntryValue | null): Promise<{ bytes: Uint8Array; type: FileType } | { error: string }> {
  if (!value || typeof value === "string" || value.size === 0) return { error: "Choose a photo or PDF of the bank receipt." };
  if (value.size > MAX_FILE_BYTES) return { error: "The file is larger than 4 MB. Take a new photo, or send a smaller PDF." };
  const bytes = new Uint8Array(await value.arrayBuffer());
  const type = sniffType(bytes);
  if (!type) return { error: "Only photos (JPG, PNG, WebP) and PDF files can be uploaded." };
  return { bytes, type };
}
