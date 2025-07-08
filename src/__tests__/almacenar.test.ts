import { handler } from "../almacenar";
import { APIGatewayProxyEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbMock = mockClient(DynamoDBDocumentClient);

describe("handler almacenar - validación de cuerpo vacío", () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.PERSONAL_TABLE = "personal-table";
  });

  it("devuelve 400 si el cuerpo está vacío", async () => {
    const event = {
      body: undefined,
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: "Cuerpo vacío" });
  });

  it("devuelve 400 si falta el campo nombre", async () => {
    const event = {
      body: JSON.stringify({ descripcion: "desc" }),
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: "Faltan campos obligatorios: nombre y descripción",
    });
  });

  it("devuelve 400 si falta el campo descripcion", async () => {
    const event = {
      body: JSON.stringify({ nombre: "nombre" }),
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: "Faltan campos obligatorios: nombre y descripción",
    });
  });

  it("guarda en DynamoDB y devuelve 201 con el item", async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = {
      body: JSON.stringify({ nombre: "Juan", descripcion: "desc", extra: 123 }),
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Elemento almacenado exitosamente");
    expect(body.item.nombre).toBe("Juan");
    expect(body.item.descripcion).toBe("desc");
    expect(body.item.extra).toBe(123);
    expect(body.item.id).toBeDefined();
    expect(body.item.creadoEn).toBeDefined();
    // Verifica que se haya llamado PutCommand
    expect(ddbMock.commandCalls(PutCommand).length).toBe(1);
  });

  it("devuelve 500 si ocurre un error inesperado al guardar", async () => {
    ddbMock.on(PutCommand).rejects(new Error("Fallo DynamoDB"));
    // Silenciar console.error solo en este test
    const originalError = console.error;
    console.error = jest.fn();
    const event = {
      body: JSON.stringify({ nombre: "Juan", descripcion: "desc" }),
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Error interno");
    expect(body.error).toMatch(/Fallo DynamoDB/);
    console.error = originalError;
  });
});
