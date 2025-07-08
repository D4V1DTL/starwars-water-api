import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE!;
const WINDOW_MS = 60 * 1000; // 1 minuto
const MAX_REQUESTS = 5;

export async function checkRateLimit(ip: string): Promise<boolean> {
  const now = Date.now();
  const key = `rate#${ip}`;

  const res = await ddb.send(
    new GetCommand({ TableName: RATE_LIMIT_TABLE, Key: { id: key } })
  );

  const record = res.Item;
  if (!record) {
    await ddb.send(
      new PutCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: { id: key, count: 1, firstRequest: now },
      })
    );
    return true;
  }

  const elapsed = now - record.firstRequest;
  if (elapsed > WINDOW_MS) {
    await ddb.send(
      new PutCommand({
        TableName: RATE_LIMIT_TABLE,
        Item: { id: key, count: 1, firstRequest: now },
      })
    );
    return true;
  }

  if (record.count >= MAX_REQUESTS) {
    return false;
  }

  await ddb.send(
    new PutCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: {
        id: key,
        count: record.count + 1,
        firstRequest: record.firstRequest,
      },
    })
  );

  return true;
}
