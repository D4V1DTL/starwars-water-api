import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";
import { randomUUID } from "crypto";
import { CACHE_TTL_MS, coordsList } from "./config/constants";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const planetName = event.queryStringParameters?.planet || "Tatooine";
  const now = Date.now();

  try {
    let coordIndex = Math.floor(Math.random() * coordsList.length);
    const { lat, lon } = coordsList[coordIndex];

    // 1. Cache WeatherAPI
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
            data: weatherData,
          },
        })
      );
    }

    // 2. Cache SWAPI
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
            data: swapiData,
          },
        })
      );
    }

    // 3. Fusionar
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

    // 4. Guardar en historial
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

    return {
      statusCode: 200,
      body: JSON.stringify({ source: "fusion", data: fusion }),
    };
  } catch (err: any) {
    console.error("Error en /fusionados:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error interno", error: err.message }),
    };
  }
};
