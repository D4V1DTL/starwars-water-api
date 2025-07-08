import { APIGatewayProxyHandler } from "aws-lambda";
import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "supersecreto";

export const handler: APIGatewayProxyHandler = async (event) => {
  // Puedes pedir usuario/rol en el body si quieres, aquí es fijo
  const payload = { user: "demo" };
  const token = jwt.sign(payload, SECRET, { expiresIn: "1h" });

  return {
    statusCode: 200,
    body: JSON.stringify({ token }),
  };
};
