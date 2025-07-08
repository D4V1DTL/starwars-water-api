import { isRateLimited } from "../utils/rateLimiter";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

describe("isRateLimited", () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);
  const RATE_LIMIT_MAX = 5;
  const RATE_LIMIT_WINDOW_SEC = 60;
  const rateLimitTable = "rate_limit_table";

  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.RATE_LIMIT_TABLE = rateLimitTable;
    process.env.RATE_LIMIT_MAX = RATE_LIMIT_MAX.toString();
    process.env.RATE_LIMIT_WINDOW_SEC = RATE_LIMIT_WINDOW_SEC.toString();
  });

  it("devuelve true si el contador supera el límite", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { count: RATE_LIMIT_MAX } });
    const result = await isRateLimited("1.2.3.4");
    expect(result).toBe(true);
  });

  it("devuelve false si el contador está por debajo del límite", async () => {
    ddbMock.on(GetCommand).resolves({ Item: { count: 2 } });
    ddbMock.on(PutCommand).resolves({});
    const result = await isRateLimited("1.2.3.4");
    expect(result).toBe(false);
  });

  it("devuelve false si no existe item previo en la tabla (primer request de la IP)", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    const result = await isRateLimited("5.6.7.8");
    expect(result).toBe(false);
  });

  it("lanza si falta RATE_LIMIT_TABLE en env", async () => {
    delete process.env.RATE_LIMIT_TABLE;
    await expect(isRateLimited("1.2.3.4")).rejects.toThrow();
  });

  it("usa valores por defecto si faltan RATE_LIMIT_MAX y RATE_LIMIT_WINDOW_SEC", async () => {
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_SEC;
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});
    const result = await isRateLimited("8.8.8.8");
    expect(result).toBe(false);
  });
});
