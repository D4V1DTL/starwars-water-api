import { handler } from "../fusionados";
import { APIGatewayProxyEventV2 } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";
import { isRateLimited } from "../utils/rateLimiter";
import jwt from "jsonwebtoken";
import { verifyToken } from "../utils/auth";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ddbMock = mockClient(DynamoDBDocumentClient);

const TEST_SECRET = "supersecreto";
const testToken = jwt.sign({ user: "test" }, TEST_SECRET, { expiresIn: "1h" });

// Elimino el describe de isRateLimited y dejo solo los describes del handler fusionados

describe("handler fusionados - 404 si SWAPI no encuentra el planeta", () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.CACHE_TABLE = "cache-table";
    process.env.HISTORIAL_TABLE = "historial-table";
    process.env.WEATHER_API_KEY = "fake-weather-key";
    process.env.JWT_SECRET = "supersecreto";
    ddbMock.on(GetCommand).resolves({ Item: undefined });
  });

  it("devuelve 401 si falta el token JWT", async () => {
    const event = {
      headers: {},
      queryStringParameters: { planet: "Tatooine" },
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({
      message:
        "Debes consumir primero el endpoint /generate-token para obtener un token válido.",
    });
  });

  it("devuelve 404 si SWAPI no encuentra el planeta", async () => {
    // Mock de WeatherAPI (devuelve clima válido)
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          current: {
            temp_c: 20,
            condition: { text: "Nublado", icon: "icono.png" },
          },
        },
      })
    );
    // Mock de SWAPI (no encuentra planeta)
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: { results: [] },
      })
    );
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { planet: "PlanetaInexistente" },
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({
      message: "Planeta no encontrado",
    });
  });

  it("devuelve 500 si la llamada a WeatherAPI falla", async () => {
    // Mock de WeatherAPI que lanza error
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.reject(new Error("Fallo WeatherAPI"))
    );
    // Silenciar console.error solo en este test
    const originalError = console.error;
    console.error = jest.fn();
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { planet: "Tatooine" },
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe("Error interno");
    expect(body.error).toMatch(/Fallo WeatherAPI/);
    console.error = originalError;
  });

  it("devuelve datos de clima desde la caché si no ha expirado, y SWAPI desde API", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    jest.spyOn(Math, "random").mockReturnValue(0); // Forzar índice 0
    // Clima en caché válido
    ddbMock.on(GetCommand, { Key: { id: "weather#0" } }).resolves({
      Item: {
        id: "weather#0",
        timestamp: now - 1000, // no expirado
        data: {
          temp_c: 22,
          condition: { text: "Caché", icon: "icono_cache.png" },
        },
      },
    });
    // Planeta no en caché
    ddbMock
      .on(GetCommand, { Key: { id: "swapi#Alderaan" } })
      .resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar planeta
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar historial
    // SWAPI responde con planeta válido
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          results: [
            {
              name: "Alderaan",
              population: "2000000000",
              terrain: "grasslands, mountains",
            },
          ],
        },
      })
    );
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { planet: "Alderaan" },
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.planeta).toBe("Alderaan");
    expect(body.data.clima.temp_c).toBe(22);
    expect(body.data.clima.condition).toBe("Caché");
    expect(body.data.clima.icon).toBe("icono_cache.png");
    expect(body.data.poblacion).toBe("2000000000");
    expect(body.data.terreno).toBe("grasslands, mountains");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // Solo SWAPI
  });

  it("happy path con datos reales de las APIs", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    jest.spyOn(Math, "random").mockReturnValue(0); // Forzar índice 0
    // No hay datos en caché
    ddbMock
      .on(GetCommand, { Key: { id: "weather#0" } })
      .resolves({ Item: undefined }); // clima
    ddbMock
      .on(GetCommand, { Key: { id: "swapi#Tatooine" } })
      .resolves({ Item: undefined }); // planeta
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar clima
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar planeta
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar historial
    // Mock de WeatherAPI
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          location: {
            name: "Lima",
            region: "Lima",
            country: "Peru",
            lat: -12.05,
            lon: -77.05,
            tz_id: "America/Lima",
            localtime_epoch: 1751958885,
            localtime: "2025-07-08 02:14",
          },
          current: {
            last_updated_epoch: 1751958000,
            last_updated: "2025-07-08 02:00",
            temp_c: 15.2,
            temp_f: 59.4,
            is_day: 0,
            condition: {
              text: "Patchy rain nearby",
              icon: "//cdn.weatherapi.com/weather/64x64/night/176.png",
              code: 1063,
            },
            wind_mph: 5.6,
            wind_kph: 9.0,
            wind_degree: 173,
            wind_dir: "S",
            pressure_mb: 1015.0,
            pressure_in: 29.96,
            precip_mm: 0.01,
            precip_in: 0.0,
            humidity: 82,
            cloud: 74,
            feelslike_c: 15.2,
            feelslike_f: 59.4,
            windchill_c: 15.2,
            windchill_f: 59.4,
            heatindex_c: 15.2,
            heatindex_f: 59.4,
            dewpoint_c: 12.2,
            dewpoint_f: 54.0,
            vis_km: 10.0,
            vis_miles: 6.0,
            uv: 0.0,
            gust_mph: 8.7,
            gust_kph: 14.0,
          },
        },
      })
    );
    // Mock de SWAPI
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              name: "Tatooine",
              rotation_period: "23",
              orbital_period: "304",
              diameter: "10465",
              climate: "arid",
              gravity: "1 standard",
              terrain: "desert",
              surface_water: "1",
              population: "200000",
              residents: [
                "https://swapi.py4e.com/api/people/1/",
                "https://swapi.py4e.com/api/people/2/",
                "https://swapi.py4e.com/api/people/4/",
                "https://swapi.py4e.com/api/people/6/",
                "https://swapi.py4e.com/api/people/7/",
                "https://swapi.py4e.com/api/people/8/",
                "https://swapi.py4e.com/api/people/9/",
                "https://swapi.py4e.com/api/people/11/",
                "https://swapi.py4e.com/api/people/43/",
                "https://swapi.py4e.com/api/people/62/",
              ],
              films: [
                "https://swapi.py4e.com/api/films/1/",
                "https://swapi.py4e.com/api/films/3/",
                "https://swapi.py4e.com/api/films/4/",
                "https://swapi.py4e.com/api/films/5/",
                "https://swapi.py4e.com/api/films/6/",
              ],
              created: "2014-12-09T13:50:49.641000Z",
              edited: "2014-12-20T20:58:18.411000Z",
              url: "https://swapi.py4e.com/api/planets/1/",
            },
          ],
        },
      })
    );
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { planet: "Tatooine" },
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.planeta).toBe("Tatooine");
    expect(body.data.poblacion).toBe("200000");
    expect(body.data.terreno).toBe("desert");
    expect(body.data.clima.temp_c).toBe(15.2);
    expect(body.data.clima.condition).toBe("Patchy rain nearby");
    expect(body.data.clima.icon).toBe(
      "//cdn.weatherapi.com/weather/64x64/night/176.png"
    );
    expect(mockedAxios.get).toHaveBeenCalledTimes(2); // WeatherAPI y SWAPI
  });

  it("devuelve datos de planeta desde la caché si no ha expirado, y clima desde WeatherAPI", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    jest.spyOn(Math, "random").mockReturnValue(0); // Forzar índice 0
    // Clima no en caché
    ddbMock
      .on(GetCommand, { Key: { id: "weather#0" } })
      .resolves({ Item: undefined });
    // Planeta en caché válido
    ddbMock.on(GetCommand, { Key: { id: "swapi#Tatooine" } }).resolves({
      Item: {
        id: "swapi#Tatooine",
        timestamp: now - 1000, // no expirado
        data: {
          name: "Tatooine",
          population: "200000",
          terrain: "desert",
        },
      },
    });
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar clima
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar historial
    // WeatherAPI responde con clima válido
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          current: {
            temp_c: 18,
            condition: { text: "Despejado", icon: "icono_clima.png" },
          },
        },
      })
    );
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { planet: "Tatooine" },
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.planeta).toBe("Tatooine");
    expect(body.data.poblacion).toBe("200000");
    expect(body.data.terreno).toBe("desert");
    expect(body.data.clima.temp_c).toBe(18);
    expect(body.data.clima.condition).toBe("Despejado");
    expect(body.data.clima.icon).toBe("icono_clima.png");
    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // Solo WeatherAPI
  });

  it("usa 'Tatooine' como planeta por defecto si no se pasa parámetro", async () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    jest.spyOn(Math, "random").mockReturnValue(0); // Forzar índice 0
    // No hay datos en caché
    ddbMock
      .on(GetCommand, { Key: { id: "weather#0" } })
      .resolves({ Item: undefined }); // clima
    ddbMock
      .on(GetCommand, { Key: { id: "swapi#Tatooine" } })
      .resolves({ Item: undefined }); // planeta
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar clima
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar planeta
    ddbMock.on(PutCommand).resolvesOnce({}); // guardar historial
    // Mock de WeatherAPI
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          current: {
            temp_c: 21,
            condition: { text: "Soleado", icon: "icono_default.png" },
          },
        },
      })
    );
    // Mock de SWAPI
    mockedAxios.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              name: "Tatooine",
              population: "200000",
              terrain: "desert",
            },
          ],
        },
      })
    );
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: undefined, // No se pasa parámetro
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.data.planeta).toBe("Tatooine");
    expect(body.data.poblacion).toBe("200000");
    expect(body.data.terreno).toBe("desert");
    expect(body.data.clima.temp_c).toBe(21);
    expect(body.data.clima.condition).toBe("Soleado");
    expect(body.data.clima.icon).toBe("icono_default.png");
    expect(mockedAxios.get).toHaveBeenCalledTimes(2); // WeatherAPI y SWAPI
  });
});

describe("handler fusionados - 429 si se excede el rate limit", () => {
  beforeEach(() => {
    ddbMock.reset();
    jest.clearAllMocks();
    process.env.CACHE_TABLE = "cache-table";
    process.env.HISTORIAL_TABLE = "historial-table";
    process.env.WEATHER_API_KEY = "fake-weather-key";
    process.env.JWT_SECRET = "supersecreto";
  });

  it("devuelve 429 si isRateLimited retorna true", async () => {
    // Mockear isRateLimited para que devuelva true
    jest
      .spyOn(require("../utils/rateLimiter"), "isRateLimited")
      .mockResolvedValue(true);
    const event = {
      headers: { authorization: `Bearer ${testToken}` },
      queryStringParameters: { planet: "Tatooine" },
      requestContext: { http: { sourceIp: "1.2.3.4" } },
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(429);
    expect(JSON.parse(result.body)).toEqual({
      message: "Demasiadas solicitudes. Intenta nuevamente en un momento.",
    });
  });
});

it("verifyToken devuelve error si el token es inválido", () => {
  const result = verifyToken("Bearer token_invalido");
  expect(result.valid).toBe(false);
  expect(result.message).toMatch(/Token inválido/);
});
