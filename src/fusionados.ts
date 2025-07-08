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
import { isRateLimited } from "./utils/rateLimiter";
import { verifyToken } from "./utils/auth";

// 📦 X-Ray para trazabilidad
import AWSXRay from "aws-xray-sdk-core";
const AWS = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const ddb = DynamoDBDocumentClient.from(AWS);

export const handler = async (event: APIGatewayProxyEventV2): Promise<any> => {
  const auth = verifyToken(event.headers?.authorization);
  if (!auth.valid) {
    return {
      statusCode: 401,
      body: JSON.stringify({ message: auth.message }),
    };
  }

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
