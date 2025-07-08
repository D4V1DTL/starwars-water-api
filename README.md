# Documentación Swagger/OpenAPI

La documentación interactiva de los endpoints está disponible en:

👉 **[https://d4v1dtl.github.io/starwars-water-api/](https://d4v1dtl.github.io/starwars-water-api/)**

# Características principales

Este proyecto cumple con los siguientes puntos clave:

- **Documentación de los endpoints con Swagger/OpenAPI**

  - Consulta y prueba los endpoints en la URL pública (ver arriba).

- **Logging avanzado con AWS CloudWatch**

  - Uso de `console.log`, `console.warn` y `console.error` en los handlers para rastreo de errores y rendimiento.
  - Ejemplo:
    ```ts
    console.log(`[START] /fusionados IP: ${sourceIp} | Planet: ${planetName}`);
    ```
  - Ruta: `src/fusionados.ts`, `src/almacenar.ts`, `src/historial.ts`

- **Sistema de rate-limiting**

  - Implementado en `src/utils/rateLimiter.ts` usando DynamoDB para limitar solicitudes por IP.
  - Ejemplo:
    ```ts
    if (await isRateLimited(sourceIp)) {
      return { statusCode: 429, body: ... };
    }
    ```

- **Monitorización y trazabilidad con AWS X-Ray**

  - Instrumentación automática de DynamoDBClient:
    ```ts
    import AWSXRay from "aws-xray-sdk-core";
    const AWS = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
    ```
  - Ruta: `src/fusionados.ts`, `src/almacenar.ts`, `src/historial.ts`

- **Pruebas unitarias y de integración con Jest**

  - Tests en `src/__tests__/*.test.ts` con cobertura total.
  - Ejecución:
    ```bash
    npx jest --coverage
    ```

- **Uso de TypeScript**

  - Tipado estático en todo el código fuente (`.ts`).
  - Configuración en `tsconfig.json`.

- **3 endpoints principales:**

  - **GET `/fusionados`**: Fusiona datos de WeatherAPI y SWAPI. Ruta: `src/fusionados.ts`
  - **POST `/almacenar`**: Guarda recursos personalizados. Ruta: `src/almacenar.ts`
  - **GET `/historial`**: Consulta historial de fusiones. Ruta: `src/historial.ts`

- **Cacheo de resultados**

  - Uso de DynamoDB para cachear respuestas de las APIs externas por 30 minutos.
  - Ejemplo:
    ```ts
    if (weatherCache.Item && now - weatherCache.Item.timestamp < CACHE_TTL_MS) {
      // Usar caché
    }
    ```
  - Ruta: `src/fusionados.ts`

- **Despliegue en AWS con Serverless Framework**

  - Configuración en `serverless.yml`.
  - Comando:
    ```bash
    npx serverless deploy
    ```

- **Almacenamiento en DynamoDB**

  - Tablas definidas en `serverless.yml` y usadas en todos los handlers.

- **Uso de AWS Lambda y API Gateway**
  - Cada endpoint es una función Lambda expuesta vía API Gateway.

---

# Starwars Weather API

API serverless en AWS que fusiona datos de clima y Star Wars, con almacenamiento en DynamoDB, rate limiting y trazabilidad con X-Ray.

## Descripción

Este proyecto expone tres endpoints principales mediante AWS Lambda y API Gateway, usando Serverless Framework. Permite consultar información fusionada de planetas de Star Wars y clima real, almacenar datos personalizados y consultar historial de fusiones.

- **Tecnologías:** TypeScript, AWS Lambda, API Gateway, DynamoDB, Serverless Framework, Jest, X-Ray, WeatherAPI, SWAPI.

## Endpoints

### 1. `/fusionados` (GET)

Fusiona datos de clima real (WeatherAPI) y datos de planetas (SWAPI). Cachea resultados en DynamoDB y guarda un historial de consultas.

- **Parámetros:**
  - `planet` (opcional): nombre del planeta a buscar (por defecto: `Tatooine`).
- **Respuesta exitosa:**
  - Código 200, JSON con datos fusionados:
    ```json
    {
      "source": "fusion",
      "data": {
        "planeta": "Alderaan",
        "poblacion": "2000000000",
        "terreno": "grasslands, mountains",
        "coordenadas": { "lat": 51.51, "lon": -0.13 },
        "clima": {
          "temp_c": 22,
          "condition": "Caché",
          "icon": "icono_cache.png"
        }
      }
    }
    ```
- **Errores:**
  - 404 si el planeta no existe
  - 429 si se excede el rate limit por IP
  - 500 si falla alguna API

### 2. `/almacenar` (POST)

Permite guardar datos personalizados en DynamoDB.

- **Body:** JSON con los datos a guardar.
- **Respuesta exitosa:**
  - Código 201, JSON con el ID generado.
- **Errores:**
  - 400 si el body es inválido
  - 500 si ocurre un error en DynamoDB

### 3. `/historial` (GET)

Devuelve el historial de fusiones realizadas (últimas N consultas).

- **Parámetros:**
  - `limit` (opcional): cantidad máxima de registros a devolver (por defecto: 10).
- **Respuesta exitosa:**
  - Código 200, JSON con un array de fusiones previas.

## Funciones principales

- **fusionados.handler:**
  - Orquesta la consulta a WeatherAPI y SWAPI, cachea resultados, aplica rate limiting y guarda historial.
- **almacenar.handler:**
  - Guarda datos personalizados enviados por el usuario en DynamoDB.
- **historial.handler:**
  - Recupera el historial de fusiones desde DynamoDB, soportando paginación.
- **isRateLimited:**
  - Lógica de rate limiting por IP usando DynamoDB.

## Despliegue

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Despliega en AWS:
   ```bash
   npx serverless deploy
   ```

## Pruebas

- Ejecuta todos los tests y cobertura:
  ```bash
  npx jest --coverage
  ```

## Variables de entorno

- `CACHE_TABLE`, `HISTORIAL_TABLE`, `PERSONAL_TABLE`, `RATE_LIMIT_TABLE`: nombres de las tablas DynamoDB.
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC`: configuración de rate limiting.
- `WEATHER_API_KEY`: clave de WeatherAPI.

## Observabilidad

- Logs enviados a CloudWatch.
- Trazabilidad con AWS X-Ray.

## Documentación OpenAPI/Swagger

Puedes documentar los endpoints usando [Swagger Editor](https://editor.swagger.io/) o herramientas como [serverless-aws-documentation](https://www.serverless.com/plugins/serverless-aws-documentation) para generar y exponer el esquema OpenAPI.

---

**Autor:** D4V1DTL
