import { S3Client } from '@aws-sdk/client-s3';

export function createR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID ?? '') || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw Object.assign(new Error('R2 图片存储尚未配置。'), { status: 503 });
  }
  const client = new S3Client({
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: 'auto', forcePathStyle: true,
    retryMode: 'standard', maxAttempts: 4, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000, throwOnRequestTimeout: true },
  });
  return { client, bucket: R2_BUCKET_NAME };
}
