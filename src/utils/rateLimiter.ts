import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function isRateLimited(ip: string): Promise<boolean> {
  const rateLimitTable = process.env.RATE_LIMIT_TABLE!;
  const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "5");
  const RATE_LIMIT_WINDOW_SEC = parseInt(
    process.env.RATE_LIMIT_WINDOW_SEC || "60"
  );
  const key = `${ip}#${Math.floor(
    Date.now() / (RATE_LIMIT_WINDOW_SEC * 1000)
  )}`;
  const result = await ddb.send(
    new GetCommand({
      TableName: rateLimitTable,
      Key: { ip_key: key },
    })
  );
  if (result.Item && result.Item.count >= RATE_LIMIT_MAX) {
    console.warn(`[RateLimit] Límite alcanzado para IP: ${ip}`);
    return true;
  }
  await ddb.send(
    new PutCommand({
      TableName: rateLimitTable,
      Item: {
        ip_key: key,
        count: (result.Item?.count || 0) + 1,
        ttl: Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW_SEC,
      },
    })
  );
  return false;
}
