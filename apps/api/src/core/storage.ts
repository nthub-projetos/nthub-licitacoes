import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { config } from './config.js';
const client =
  config.S3_ENDPOINT && config.S3_BUCKET
    ? new S3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.S3_ACCESS_KEY,
          secretAccessKey: config.S3_SECRET_KEY,
        },
      })
    : null;
export const storageConfigured = Boolean(client);
export async function storeBlob(key: string, bytes: Buffer, mime: string) {
  if (!client) return { content: bytes, storageKey: null };
  await client.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: mime,
    }),
  );
  return { content: null, storageKey: key };
}
export async function loadBlob(
  content: Buffer | null,
  key: string | null,
): Promise<Buffer> {
  if (content) return content;
  if (!client || !key)
    throw Object.assign(new Error('Arquivo não disponível no armazenamento.'), {
      statusCode: 404,
    });
  const object = await client.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
  );
  if (!object.Body) throw new Error('Resposta vazia do armazenamento.');
  if ((object.ContentLength || 0) > 26 * 1024 * 1024)
    throw new Error('Objeto excede o limite permitido.');
  return Buffer.from(await object.Body.transformToByteArray());
}
export async function ensureStorage() {
  if (!client) return;
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 404
    )
      throw error;
    await client.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
}
