import { S3Client } from '@aws-sdk/client-s3';

export function createR2Client({ privateBucket = false } = {}) {
  const { R2_ACCOUNT_ID } = process.env;
  const prefix = privateBucket ? 'BO_PRIVATE_R2_' : 'R2_';
  const bucket = process.env[`${prefix}BUCKET_NAME`];
  const accessKeyId = process.env[`${prefix}ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${prefix}SECRET_ACCESS_KEY`];
  if (privateBucket && (!bucket || bucket === process.env.R2_BUCKET_NAME || !accessKeyId || !secretAccessKey)) {
    throw Object.assign(new Error('原片私有存储尚未配置，暂时无法上传新照片。'), { status: 503 });
  }
  if (!/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID ?? '') || !accessKeyId || !secretAccessKey || !bucket) {
    throw Object.assign(new Error('R2 图片存储尚未配置。'), { status: 503 });
  }
  const client = new S3Client({
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: 'auto', forcePathStyle: true,
    retryMode: 'standard', maxAttempts: 4, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000, throwOnRequestTimeout: true },
  });
  return { client, bucket };
}
