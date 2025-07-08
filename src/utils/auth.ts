import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "supersecreto";

export function verifyToken(authHeader?: string): {
  valid: boolean;
  message?: string;
} {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      valid: false,
      message:
        "Debes consumir primero el endpoint /generate-token para obtener un token válido.",
    };
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    jwt.verify(token, SECRET);
    return { valid: true };
  } catch {
    return {
      valid: false,
      message: "Token inválido. Solicita uno nuevo en /generate-token.",
    };
  }
}
