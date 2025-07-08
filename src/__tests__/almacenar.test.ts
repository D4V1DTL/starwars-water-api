import { handler } from "../almacenar";
import { APIGatewayProxyEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const ddbMock = mockClient(DynamoDBDocumentClient);
const TEST_SECRET = "supersecreto";
const testToken = jwt.sign({ user: "test" }, TEST_SECRET, { expiresIn: "1h" });

describe("handler almacenar - validación de cuerpo vacío", () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.PERSONAL_TABLE = "almacenar_personalizado";
    process.env.JWT_SECRET = "supersecreto";
  });

  it("devuelve 400 si el cuerpo está vacío", async () => {
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      body: undefined,
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ message: "Cuerpo vacío" });
  });

  it("devuelve 400 si falta el campo nombre", async () => {
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ descripcion: "desc" }),
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: "Faltan campos obligatorios: nombre y descripcion",
    });
  });

  it("devuelve 400 si falta el campo descripcion", async () => {
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ nombre: "Leia" }),
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      message: "Faltan campos obligatorios: nombre y descripcion",
    });
  });

  it("devuelve 401 si falta el token JWT", async () => {
    const event = {
      headers: {},
      body: JSON.stringify({ nombre: "Han", descripcion: "Corellia" }),
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({
      message:
        "Debes consumir primero el endpoint /generate-token para obtener un token válido.",
    });
  });

  it("guarda en DynamoDB y devuelve 201 con el item", async () => {
    ddbMock.on(PutCommand).resolves({});
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ nombre: "Han", descripcion: "Corellia" }),
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Elemento almacenado exitosamente");
    expect(body.item.nombre).toBe("Han");
    expect(body.item.descripcion).toBe("Corellia");
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
      headers: { authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ nombre: "Han", descripcion: "Corellia" }),
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Error interno");
    expect(body.error).toMatch(/Fallo DynamoDB/);
    console.error = originalError;
  });
});
