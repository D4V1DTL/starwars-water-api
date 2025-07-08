import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import * as AWSXRay from "aws-xray-sdk-core";
import { verifyToken } from "./utils/auth";

const ddb = DynamoDBDocumentClient.from(
  AWSXRay.captureAWSv3Client(new DynamoDBClient({}))
);
const tableName = process.env.PERSONAL_TABLE!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const auth = verifyToken(event.headers?.authorization);
  if (!auth.valid) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: auth.message }),
    };
  }
  console.log("[almacenar] Request recibido");

  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Cuerpo vacío" }),
      };
    }

    const data = JSON.parse(event.body);
    const { nombre, descripcion, ...rest } = data;

    if (!nombre || !descripcion) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Faltan campos obligatorios: nombre y descripcion",
        }),
      };
    }

    const item = {
      id: randomUUID(),
      nombre,
      descripcion,
      ...rest,
      creadoEn: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      })
    );

    console.log("[almacenar] Guardado exitoso:", item.id);
    return {
      statusCode: 201,
      body: JSON.stringify({
        message: "Elemento almacenado exitosamente",
        item,
      }),
    };
  } catch (err: any) {
    console.error("[almacenar] Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error interno",
        error: err.message,
      }),
    };
  }
};
