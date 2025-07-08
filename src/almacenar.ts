import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.PERSONAL_TABLE!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Cuerpo vacío" }),
      };
    }

    const data = JSON.parse(event.body);
    const { nombre, descripcion, ...rest } = data;

    // Validación básica obligatoria
    if (!nombre || !descripcion) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Faltan campos obligatorios: nombre y descripción",
        }),
      };
    }

    const item = {
      id: randomUUID(),
      nombre,
      descripcion,
      ...rest, // Campos personalizados
      creadoEn: new Date().toISOString(),
    };

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
      })
    );

    return {
      statusCode: 201,
      body: JSON.stringify({
        message: "Elemento almacenado exitosamente",
        item,
      }),
    };
  } catch (err: any) {
    console.error("Error al guardar:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error interno",
        error: err.message,
      }),
    };
  }
};
