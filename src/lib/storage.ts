import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 (S3-compatible). Chei per organizație:
 *   org/{org_id}/...   (F2+)
 *   mf/...             (fișiere master platformă: dataset MF)
 */

let client: S3Client | null = null;

/** Cheia R2 fixă pentru dataset-ul MF — un singur fișier master pe platformă. */
export const MF_DATASET_KEY = "mf/date-identificare.txt";

export function isR2Enabled(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

function getClient(): S3Client {
  if (!client) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 nu e configurat (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
    }
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET nu e setat");
  return b;
}

/** URL presemnat pentru upload direct din browser (PUT). Valabil 1h. */
export async function presignPut(
  key: string,
  contentType = "application/octet-stream",
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: 3600 });
}

/** Mărimea obiectului (bytes) sau null dacă nu există. */
export async function headObjectSize(key: string): Promise<number | null> {
  try {
    const res = await getClient().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: key }),
    );
    return res.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** Citește un interval de bytes [start, end] inclusiv, ca string UTF-8. */
export async function getObjectRange(
  key: string,
  start: number,
  end: number,
): Promise<string> {
  const res = await getClient().send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      Range: `bytes=${start}-${end}`,
    }),
  );
  if (!res.Body) throw new Error("R2: răspuns fără body");
  const bytes = await res.Body.transformToByteArray();
  return new TextDecoder("utf-8").decode(bytes);
}
