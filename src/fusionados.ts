import { APIGatewayProxyEventV2, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";
import { randomUUID } from "crypto";
import { CACHE_TTL_MS, coordsList } from "./config/constants";
import * as AWSXRay from "aws-xray-sdk-core";

const ddb = DynamoDBDocumentClient.from(
  AWSXRay.captureAWSv3Client(new DynamoDBClient({}))
);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  const planetName = event.queryStringParameters?.planet || "Tatooine";
  const now = Date.now();
  const sourceIp = event.requestContext?.http?.sourceIp || "unknown";

  console.log(`[fusionados] Inicio → IP: ${sourceIp}, planeta: ${planetName}`);

  try {
    let coordIndex = Math.floor(Math.random() * coordsList.length);
    const { lat, lon } = coordsList[coordIndex];

    // Weather Cache
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
    } else {
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
            expireAt: Math.floor(now / 1000) + CACHE_TTL_MS / 1000,
            data: weatherData,
          },
        })
      );
    }

    // SWAPI Cache
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
    } else {
      const swapiRes = await axios.get(
        `https://swapi.py4e.com/api/planets/?search=${planetName}`
      );

      if (!swapiRes.data.results[0]) {
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
            expireAt: Math.floor(now / 1000) + CACHE_TTL_MS / 1000,
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

    console.log(`[fusionados] Éxito: planeta ${swapiData.name}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ source: "fusion", data: fusion }),
    };
  } catch (err: any) {
    console.error("[fusionados] Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error interno", error: err.message }),
    };
  }
};
