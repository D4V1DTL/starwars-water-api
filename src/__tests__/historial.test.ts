import { handler } from "../historial";
import { APIGatewayProxyEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const ddbMock = mockClient(DynamoDBDocumentClient);
const TEST_SECRET = "supersecreto";
const testToken = jwt.sign({ user: "test" }, TEST_SECRET, { expiresIn: "1h" });

describe("handler historial - flujo exitoso sin paginación", () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.HISTORIAL_TABLE = "historial-table";
    process.env.JWT_SECRET = "supersecreto";
  });

  it("devuelve 401 si falta el token JWT", async () => {
    const event = {
      headers: {},
      queryStringParameters: undefined,
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({
      message:
        "Debes consumir primero el endpoint /generate-token para obtener un token válido.",
    });
  });

  it("devuelve los items ordenados por fecha descendente", async () => {
    const items = [
      { id: "1", fecha: "2024-07-01T10:00:00Z" },
      { id: "2", fecha: "2024-07-03T10:00:00Z" },
      { id: "3", fecha: "2024-07-02T10:00:00Z" },
    ];
    ddbMock.on(ScanCommand).resolves({ Items: items });
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: undefined,
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items.map((i: any) => i.id)).toEqual(["2", "3", "1"]); // ordenados por fecha desc
    expect(body.nextPageToken).toBeNull();
  });

  it("devuelve 500 si ocurre un error inesperado al leer", async () => {
    ddbMock.on(ScanCommand).rejects(new Error("Fallo DynamoDB"));
    // Silenciar console.error solo en este test
    const originalError = console.error;
    console.error = jest.fn();
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: undefined,
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Error interno");
    expect(body.error).toMatch(/Fallo DynamoDB/);
    console.error = originalError;
  });

  it("devuelve nextPageToken si hay LastEvaluatedKey", async () => {
    const items = [
      { id: "1", fecha: "2024-07-01T10:00:00Z" },
      { id: "2", fecha: "2024-07-03T10:00:00Z" },
    ];
    const lastKey = { id: "2" };
    ddbMock
      .on(ScanCommand)
      .resolves({ Items: items, LastEvaluatedKey: lastKey });
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: undefined,
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items.length).toBe(2);
    expect(body.nextPageToken).toBe(
      encodeURIComponent(JSON.stringify(lastKey))
    );
  });

  it("decodifica y usa lastKey como ExclusiveStartKey", async () => {
    const items = [{ id: "4", fecha: "2024-07-04T10:00:00Z" }];
    const lastKey = { id: "3" };
    const encodedLastKey = encodeURIComponent(JSON.stringify(lastKey));
    ddbMock.on(ScanCommand).resolves({ Items: items });
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { lastKey: encodedLastKey },
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe("4");
    expect(body.nextPageToken).toBeNull();
  });

  it("devuelve un array vacío si ScanCommand no retorna Items", async () => {
    ddbMock.on(ScanCommand).resolves({});
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: undefined,
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toEqual([]);
    expect(body.nextPageToken).toBeNull();
  });
});
