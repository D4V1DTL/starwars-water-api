import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";

const ddb = DynamoDBDocumentClient.from(
  AWSXRay.captureAWSv3Client(new DynamoDBClient({}))
);
const tableName = process.env.HISTORIAL_TABLE!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("[historial] Solicitud recibida");

  try {
    const query = event.queryStringParameters || {};
    const limit = Number(query.limit) || 5;
    const lastKey = query.lastKey
      ? JSON.parse(decodeURIComponent(query.lastKey))
      : undefined;

    const scanParams: any = {
      TableName: tableName,
      Limit: limit,
    };

    if (lastKey) {
      scanParams.ExclusiveStartKey = lastKey;
    }

    const result = await ddb.send(new ScanCommand(scanParams));

    const sortedItems = (result.Items || []).sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    );

    console.log(`[historial] Registros obtenidos: ${sortedItems.length}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        items: sortedItems,
        nextPageToken: result.LastEvaluatedKey
          ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
          : null,
      }),
    };
  } catch (err: any) {
    console.error("[historial] Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error interno", error: err.message }),
    };
  }
};
