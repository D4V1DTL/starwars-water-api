import { APIGatewayProxyEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";
import { randomUUID } from "crypto";
import { CACHE_TTL_MS, coordsList } from "./config/constants";

// 📦 X-Ray para trazabilidad
import AWSXRay from "aws-xray-sdk-core";
const AWS = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const ddb = DynamoDBDocumentClient.from(AWS);

const rateLimitTable = process.env.RATE_LIMIT_TABLE!;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "5");
const RATE_LIMIT_WINDOW_SEC = parseInt(
  process.env.RATE_LIMIT_WINDOW_SEC || "60"
);

// 🔐 Rate limit por IP
async function isRateLimited(ip: string): Promise<boolean> {
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

export const handler = async (event: APIGatewayProxyEventV2): Promise<any> => {
  const now = Date.now();
  const planetName = event.queryStringParameters?.planet || "Tatooine";
  const sourceIp = event.requestContext?.http?.sourceIp || "unknown";

  console.log(`[START] /fusionados IP: ${sourceIp} | Planet: ${planetName}`);

  try {
    if (await isRateLimited(sourceIp)) {
      console.warn(`[429] Rate limit exceeded for IP: ${sourceIp}`);
      return {
        statusCode: 429,
        body: JSON.stringify({
          message: "Demasiadas solicitudes. Intenta nuevamente en un momento.",
        }),
      };
    }

    const coordIndex = Math.floor(Math.random() * coordsList.length);
    const { lat, lon } = coordsList[coordIndex];

    // 🧊 Clima cacheado
    const weatherKey = `weather#${coordIndex}`;
    let weatherData;

    const weatherCache = await ddb.send(
      new GetCommand({
        TableName: process.env.CACHE_TABLE!,
        Key: { id: weatherKey },
      })
    );

    if (weatherCache.Item && now - weatherCache.Item.timestamp < CACHE_TTL_MS) {
      weatherData = weatherCache.Item.data;
      console.log(`[CACHE] Weather usado desde cache`);
    } else {
      console.log(`[API] Llamando a WeatherAPI para ${lat},${lon}`);
      const weatherRes = await axios.get(
        `http://api.weatherapi.com/v1/current.json`,
        {
          params: {
            key: process.env.WEATHER_API_KEY,
            q: `${lat},${lon}`,
          },
        }
      );
      weatherData = weatherRes.data.current;

      await ddb.send(
        new PutCommand({
          TableName: process.env.CACHE_TABLE!,
          Item: {
            id: weatherKey,
            timestamp: now,
            data: weatherData,
          },
        })
      );
    }

    // 🌍 SWAPI cacheado
    const swapiKey = `swapi#${planetName}`;
    let swapiData;

    const swapiCache = await ddb.send(
      new GetCommand({
        TableName: process.env.CACHE_TABLE!,
        Key: { id: swapiKey },
      })
    );

    if (swapiCache.Item && now - swapiCache.Item.timestamp < CACHE_TTL_MS) {
      swapiData = swapiCache.Item.data;
      console.log(`[CACHE] SWAPI usado desde cache`);
    } else {
      console.log(`[API] Llamando a SWAPI para ${planetName}`);
      const swapiRes = await axios.get(
        `https://swapi.py4e.com/api/planets/?search=${planetName}`
      );

      if (!swapiRes.data.results[0]) {
        console.warn(`[404] Planeta no encontrado: ${planetName}`);
        return {
          statusCode: 404,
          body: JSON.stringify({ message: "Planeta no encontrado" }),
        };
      }

      swapiData = swapiRes.data.results[0];

      await ddb.send(
        new PutCommand({
          TableName: process.env.CACHE_TABLE!,
          Item: {
            id: swapiKey,
            timestamp: now,
            data: swapiData,
          },
        })
      );
    }

    const fusion = {
      planeta: swapiData.name,
      poblacion: swapiData.population,
      terreno: swapiData.terrain,
      coordenadas: { lat, lon },
      clima: {
        temp_c: weatherData.temp_c,
        condition: weatherData.condition.text,
        icon: weatherData.condition.icon,
      },
    };

    await ddb.send(
      new PutCommand({
        TableName: process.env.HISTORIAL_TABLE!,
        Item: {
          id: randomUUID(),
          fecha: new Date().toISOString(),
          planeta: swapiData.name,
          fusion,
        },
      })
    );

    console.log(`[SUCCESS] Fusion completada para ${planetName}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ source: "fusion", data: fusion }),
    };
  } catch (err: any) {
    console.error("[ERROR] Error en /fusionados:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error interno", error: err.message }),
    };
  }
};
